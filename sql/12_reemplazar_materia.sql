-- ============================================================================
-- 12_reemplazar_materia.sql — Reemplazar una materia desde la planilla
--
-- El importador de 11 corrige saberes que ya existen (por su id) o agrega
-- nuevos, pero no sabe reemplazar una materia. Cuando el equipo rehízo Lengua
-- en un Excel sin ids, el importador sumó los 132 saberes nuevos al lado de
-- los 106 viejos. Esto es lo que faltaba.
--
-- reemplazar_materia() recibe los saberes de la materia tal como los dejó el
-- equipo en la planilla —año, trimestre, eje, texto y contenidos— y deja la
-- materia exactamente así. Cuatro reglas:
--
-- 1. SOLO LOS AÑOS QUE VIENEN EN EL ARCHIVO. Si la planilla trae solo 1° año,
--    2° y 3° no se tocan. Un archivo parcial no puede vaciar la materia.
--
-- 2. LO QUE NO CAMBIÓ CONSERVA SU IDENTIDAD. Un saber que sigue en el archivo
--    —por su código, por el mismo texto o por un texto casi igual, que es una
--    corrección— mantiene su id y con él sus respuestas. Solo lo realmente
--    nuevo entra como nuevo. Si no, corregir un tipeo después del 26 dejaría
--    las respuestas colgadas de un saber archivado y el panel mostraría cero.
--
-- 3. LO QUE SALE SE ARCHIVA, NO SE BORRA. Conserva sus respuestas.
--
-- 4. PRIMERO SE MIRA, Y TODO O NADA, igual que el importador de 11.
--
-- Escribe con guardar_saber, guardar_contenido y archivar_catalogo: valen sus
-- validaciones y cada cambio queda en la auditoría.
--
-- Se puede correr más de una vez. Va después del 11.
-- ============================================================================


-- Qué tanto se parecen dos textos: palabras de tres letras o más en común
-- sobre el total. 1 es el mismo texto; una corrección de tipeo da más de 0,8.
create or replace function public.parecido_textos(a text, b text)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  with pa as (select distinct w from unnest(string_to_array(public.normalizar_texto(a), ' ')) as w
               where length(w) > 2),
       pb as (select distinct w from unnest(string_to_array(public.normalizar_texto(b), ' ')) as w
               where length(w) > 2),
       total as (select count(*) as n from (select w from pa union select w from pb) u)
  select case when (select n from total) = 0 then 0
         else (select count(*) from pa join pb using (w))::numeric / (select n from total) end;
$$;


-- El eje como lo escribe el equipo: su id, «EJE II», «Eje II: Lectura…», «2»
-- o el nombre completo. Devuelve null si no es de esa materia.
create or replace function public.eje_desde_texto(p_espacio_id text, p_texto text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_t     text := btrim(coalesce(p_texto, ''));
  v_n     text := public.normalizar_texto(p_texto);
  v_rom   text;
  v_orden integer;
  v_id    text;
begin
  if v_t = '' then
    return null;
  end if;

  select e.id into v_id from public.ejes e where e.espacio_id = p_espacio_id and e.id = v_t;
  if v_id is not null then
    return v_id;
  end if;

  v_rom := substring(v_n from '^(?:eje )?(i|ii|iii|iv|v|vi)(?: |$)');
  if v_rom is not null then
    v_orden := case v_rom when 'i' then 1 when 'ii' then 2 when 'iii' then 3
                          when 'iv' then 4 when 'v' then 5 when 'vi' then 6 end;
  elsif v_n ~ '^(eje )?[1-6]$' then
    v_orden := substring(v_n from '([1-6])$')::integer;
  end if;
  if v_orden is not null then
    select e.id into v_id from public.ejes e where e.espacio_id = p_espacio_id and e.orden = v_orden;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  -- El nombre completo, o sin el «EJE III:» de adelante («Literatura»)
  select e.id into v_id from public.ejes e
   where e.espacio_id = p_espacio_id
     and (public.normalizar_texto(e.nombre) = v_n
          or regexp_replace(public.normalizar_texto(e.nombre), '^eje ([ivx]+|[0-9]+) ', '') = v_n);
  return v_id;
end;
$$;


-- «1°, 2° o 3°»: la lista como se dice, no separada por comas
create or replace function public.lista_con_o(v text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select case when cardinality(v) <= 1 then coalesce(v[1], '')
              else array_to_string(v[1:cardinality(v) - 1], ', ') || ' o ' || v[cardinality(v)] end;
$$;

-- Para los ejemplos de la vista previa: corta en 120 y avisa que sigue
create or replace function public.recortar(t text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when char_length(t) > 120 then rtrim(left(t, 117)) || '…' else t end;
$$;


-- p_saberes: [{ fila, codigo?, anio, trimestre, eje, texto, contenidos: [texto, …] }]
create or replace function public.reemplazar_materia(
  p_espacio_id text,
  p_saberes    jsonb,
  p_aplicar    boolean default false,
  p_archivo    text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_espacio   record;
  v_nota      text := 'Planilla' || coalesce(' «' || nullif(btrim(p_archivo), '') || '»', '');
  f           jsonb;
  c           jsonb;
  v_fila      integer;
  v_codigo    text;
  v_anio      smallint;
  v_trim      smallint;
  v_eje       text;
  v_texto     text;
  v_norm      text;
  v_id        text;
  v_orden     integer;
  v_parecido  numeric;
  v_cont      text;
  v_cid       text;
  s           record;
  x           record;

  -- Lo que dice el archivo, ya validado: una fila por saber
  plan        jsonb := '[]'::jsonb;
  -- Saberes existentes que el archivo reclama (id → true)
  tomados     jsonb := '{}'::jsonb;
  -- Claves (texto normalizado + año + trimestre) ya vistas en el archivo
  vistas      jsonb := '{}'::jsonb;
  -- Posición de cada saber dentro de su eje y año, para el orden
  posiciones  jsonb := '{}'::jsonb;
  anios       smallint[] := '{}';

  n_mantiene   integer := 0;
  n_corrige    integer := 0;
  n_mueve      integer := 0;
  n_restaura   integer := 0;
  n_nuevo      integer := 0;
  n_archiva    integer := 0;
  c_nuevo      integer := 0;
  c_corrige    integer := 0;
  c_archiva    integer := 0;
  c_restaura   integer := 0;

  errores  jsonb := '[]'::jsonb;
  ejemplos jsonb := '[]'::jsonb;
begin
  if not public.es_equipo() then
    raise exception 'Tu usuario no está en el equipo de Planificación.' using errcode = '42501';
  end if;

  select ec.id, ec.nombre, ec.anios_dictados, ec.saberes_por_ciclo
    into v_espacio
    from public.espacios_curriculares ec where ec.id = p_espacio_id;
  if v_espacio.id is null then
    raise exception 'La materia «%» no existe.', p_espacio_id using errcode = '22023';
  end if;
  if jsonb_typeof(p_saberes) <> 'array' or jsonb_array_length(p_saberes) = 0 then
    raise exception 'El archivo no trae ningún saber.' using errcode = '22023';
  end if;

  -- ==========================================================================
  -- 1. Validar cada fila y decidir a qué saber existente corresponde
  -- ==========================================================================
  for f in select * from jsonb_array_elements(p_saberes)
  loop
    v_fila   := coalesce((f ->> 'fila')::integer, 0);
    v_codigo := nullif(btrim(coalesce(f ->> 'codigo', '')), '');
    v_texto  := regexp_replace(btrim(coalesce(f ->> 'texto', '')), '\s+', ' ', 'g');
    v_norm   := public.normalizar_texto(v_texto);

    if char_length(v_texto) < 10 then
      errores := errores || jsonb_build_object('fila', v_fila,
        'mensaje', 'El saber está vacío o es demasiado corto.');
      continue;
    end if;

    -- Año: las artísticas son por ciclo y no llevan
    if v_espacio.saberes_por_ciclo then
      v_anio := null;
    else
      begin
        v_anio := nullif(regexp_replace(coalesce(f ->> 'anio', ''), '[^0-9]', '', 'g'), '')::smallint;
      exception when others then v_anio := null;
      end;
      if v_anio is null or not (v_anio = any (v_espacio.anios_dictados)) then
        errores := errores || jsonb_build_object('fila', v_fila,
          'mensaje', format('El año tiene que ser %s.', public.lista_con_o(
            array(select a || '°' from unnest(v_espacio.anios_dictados) a order by a))));
        continue;
      end if;
    end if;

    begin
      v_trim := nullif(regexp_replace(coalesce(f ->> 'trimestre', ''), '[^0-9]', '', 'g'), '')::smallint;
    exception when others then v_trim := null;
    end;
    if v_trim is null or v_trim not between 1 and 3 then
      errores := errores || jsonb_build_object('fila', v_fila,
        'mensaje', 'El trimestre tiene que ser 1, 2 o 3.');
      continue;
    end if;

    v_eje := public.eje_desde_texto(p_espacio_id, f ->> 'eje');
    if v_eje is null then
      errores := errores || jsonb_build_object('fila', v_fila,
        'mensaje', format('El eje «%s» no es de %s. Los ejes son: %s.',
          coalesce(nullif(btrim(f ->> 'eje'), ''), '(vacío)'), v_espacio.nombre,
          (select string_agg(e.nombre, ' · ' order by e.orden) from public.ejes e where e.espacio_id = p_espacio_id)));
      continue;
    end if;

    -- El mismo texto puede estar en dos trimestres del mismo año: en
    -- Matemática 3° hay un saber que se trabaja en el 1ro y en el 2do, con
    -- contenidos distintos. Repetido es solo si coincide también el trimestre.
    if vistas ? (v_norm || '|' || coalesce(v_anio::text, 'c') || '|' || v_trim) then
      errores := errores || jsonb_build_object('fila', v_fila,
        'mensaje', 'Este saber está repetido en el archivo, en el mismo año y trimestre.');
      continue;
    end if;
    vistas := vistas || jsonb_build_object(v_norm || '|' || coalesce(v_anio::text, 'c') || '|' || v_trim, true);

    if not (coalesce(v_anio, 0::smallint) = any (anios)) then
      anios := anios || coalesce(v_anio, 0::smallint);
    end if;

    -- ¿A qué saber existente corresponde? Por código, por texto igual o casi
    v_id := null;
    if v_codigo is not null then
      select sa.id into v_id from public.saberes sa join public.ejes e on e.id = sa.eje_id
       where sa.id = v_codigo and e.espacio_id = p_espacio_id;
      if v_id is null then
        errores := errores || jsonb_build_object('fila', v_fila,
          'mensaje', format('El código «%s» no es de un saber de %s. Si el saber es nuevo, dejá el código vacío.',
                            v_codigo, v_espacio.nombre));
        continue;
      end if;
      if tomados ? v_id then
        errores := errores || jsonb_build_object('fila', v_fila,
          'mensaje', 'Este código está repetido en otra fila. Cada saber va una sola vez.');
        continue;
      end if;
    end if;

    if v_id is null then
      -- Mismo texto y mismo año. Primero el del mismo trimestre (el mismo
      -- texto puede estar en dos), después los activos, después los archivados.
      select sa.id into v_id
        from public.saberes sa join public.ejes e on e.id = sa.eje_id
       where e.espacio_id = p_espacio_id
         and public.normalizar_texto(sa.texto) = v_norm
         and sa.anio is not distinct from v_anio
         and not (tomados ? sa.id)
       order by (sa.trimestre = v_trim) desc, (sa.estado = 'activo') desc
       limit 1;
    end if;

    if v_id is null then
      -- Texto casi igual en el mismo eje y año: es una corrección
      select sa.id, public.parecido_textos(sa.texto, v_texto) as p into x
        from public.saberes sa
       where sa.eje_id = v_eje and sa.anio is not distinct from v_anio
         and sa.estado = 'activo' and not (tomados ? sa.id)
       order by 2 desc
       limit 1;
      if x.id is not null and x.p >= 0.8 then
        v_id := x.id;
      end if;
    end if;

    if v_id is not null then
      tomados := tomados || jsonb_build_object(v_id, true);
    end if;

    -- Orden: la posición dentro del eje y el año, tal como viene en el archivo
    v_orden := coalesce((posiciones ->> (v_eje || '|' || coalesce(v_anio::text, 'c')))::integer, 0) + 1;
    posiciones := posiciones || jsonb_build_object(v_eje || '|' || coalesce(v_anio::text, 'c'), v_orden);

    plan := plan || jsonb_build_object(
      'fila', v_fila, 'id', v_id, 'anio', v_anio, 'trimestre', v_trim, 'eje', v_eje,
      'texto', v_texto, 'orden', coalesce(v_anio, 0) * 1000 + v_orden,
      'contenidos', coalesce(f -> 'contenidos', '[]'::jsonb));
  end loop;

  if jsonb_array_length(errores) > 0 then
    if p_aplicar then
      raise exception 'El archivo tiene % % con problemas. No se aplicó ningún cambio.',
        jsonb_array_length(errores), case when jsonb_array_length(errores) = 1 then 'fila' else 'filas' end
        using errcode = '22023';
    end if;
    return jsonb_build_object('aplicado', false, 'materia', v_espacio.nombre,
      'errores', errores, 'filas', jsonb_array_length(p_saberes));
  end if;

  -- ==========================================================================
  -- 2. Aplicar (o contar) saber por saber
  -- ==========================================================================
  for f in select * from jsonb_array_elements(plan)
  loop
    v_id := f ->> 'id';

    if v_id is null then
      -- Saber nuevo
      n_nuevo := n_nuevo + 1;
      if jsonb_array_length(ejemplos) < 12 then
        ejemplos := ejemplos || jsonb_build_object('que', 'saber nuevo', 'antes', null, 'despues', public.recortar(f ->> 'texto'));
      end if;
      if p_aplicar then
        v_id := (public.guardar_saber(jsonb_build_object(
          'eje_id', f ->> 'eje', 'anio', (f ->> 'anio')::smallint, 'trimestre', (f ->> 'trimestre')::smallint,
          'texto', f ->> 'texto', 'orden', (f ->> 'orden')::integer, 'nota', v_nota)) ->> 'id');
        -- Recién creado, cuenta como reclamado: si no, el paso 3 lo vería
        -- activo y sin dueño y lo archivaría en el mismo momento.
        tomados := tomados || jsonb_build_object(v_id, true);
      end if;
    else
      select sa.* into s from public.saberes sa where sa.id = v_id;

      if s.estado = 'archivado' then
        n_restaura := n_restaura + 1;
        if jsonb_array_length(ejemplos) < 12 then
          ejemplos := ejemplos || jsonb_build_object('que', 'saber que vuelve', 'antes', null, 'despues', public.recortar(s.texto));
        end if;
        if p_aplicar then
          perform public.archivar_catalogo('saberes', v_id, false, v_nota);
        end if;
      end if;

      if s.texto <> f ->> 'texto' then
        n_corrige := n_corrige + 1;
        if jsonb_array_length(ejemplos) < 12 then
          ejemplos := ejemplos || jsonb_build_object('que', 'saber corregido',
            'antes', public.recortar(s.texto), 'despues', public.recortar(f ->> 'texto'));
        end if;
      elsif s.trimestre <> (f ->> 'trimestre')::smallint or s.eje_id <> f ->> 'eje'
            or s.anio is distinct from (f ->> 'anio')::smallint then
        n_mueve := n_mueve + 1;
        if jsonb_array_length(ejemplos) < 12 then
          ejemplos := ejemplos || jsonb_build_object('que', 'saber que cambia de lugar',
            'antes', public.recortar(s.texto), 'despues', null);
        end if;
      elsif s.estado = 'activo' then
        n_mantiene := n_mantiene + 1;
      end if;

      if p_aplicar and (s.texto <> f ->> 'texto' or s.trimestre <> (f ->> 'trimestre')::smallint
                        or s.eje_id <> f ->> 'eje' or s.anio is distinct from (f ->> 'anio')::smallint
                        or s.orden <> (f ->> 'orden')::integer) then
        perform public.guardar_saber(jsonb_build_object(
          'id', v_id, 'eje_id', f ->> 'eje', 'anio', (f ->> 'anio')::smallint,
          'trimestre', (f ->> 'trimestre')::smallint, 'texto', f ->> 'texto',
          'orden', (f ->> 'orden')::integer, 'nota', v_nota));
      end if;
    end if;

    -- Contenidos del saber: los mismos se quedan, los casi iguales son
    -- correcciones, los que faltan se archivan y los nuevos entran.
    declare
      propios  jsonb := '{}'::jsonb;   -- contenidos existentes ya reclamados
      vistos_c jsonb := '{}'::jsonb;   -- textos del archivo ya procesados
    begin
      for c in select * from jsonb_array_elements(f -> 'contenidos')
      loop
        v_cont := regexp_replace(btrim(coalesce(c #>> '{}', '')), '\s+', ' ', 'g');
        v_norm := public.normalizar_texto(v_cont);
        continue when v_norm = '' or vistos_c ? v_norm;
        vistos_c := vistos_c || jsonb_build_object(v_norm, true);

        v_cid := null;
        if f ->> 'id' is not null then
          select co.id, co.estado, co.texto into x from public.contenidos_sugeridos co
           where co.saber_id = f ->> 'id' and co.texto_normalizado = v_norm and not (propios ? co.id)
           order by (co.estado = 'activo') desc limit 1;
          v_cid := x.id;
          if v_cid is not null and x.estado = 'archivado' then
            c_restaura := c_restaura + 1;
            if p_aplicar then
              perform public.archivar_catalogo('contenidos_sugeridos', v_cid, false, v_nota);
            end if;
          end if;
          -- Normalizados son iguales, pero el equipo pudo corregir un acento
          -- o una mayúscula: eso también se guarda.
          if v_cid is not null and x.texto <> v_cont then
            c_corrige := c_corrige + 1;
            if p_aplicar then
              perform public.guardar_contenido(jsonb_build_object('id', v_cid, 'texto', v_cont, 'nota', v_nota));
            end if;
          end if;

          if v_cid is null then
            select co.id, public.parecido_textos(co.texto, v_cont) as p into x
              from public.contenidos_sugeridos co
             where co.saber_id = f ->> 'id' and co.estado = 'activo' and not (propios ? co.id)
             order by 2 desc limit 1;
            if x.id is not null and x.p >= 0.6 then
              v_cid := x.id;
              c_corrige := c_corrige + 1;
              if p_aplicar then
                perform public.guardar_contenido(jsonb_build_object('id', v_cid, 'texto', v_cont, 'nota', v_nota));
              end if;
            end if;
          end if;
        end if;

        if v_cid is null then
          c_nuevo := c_nuevo + 1;
          if p_aplicar then
            v_cid := (public.guardar_contenido(jsonb_build_object(
              'saber_id', v_id, 'texto', v_cont, 'nota', v_nota)) ->> 'id');
          end if;
        end if;
        if v_cid is not null then
          propios := propios || jsonb_build_object(v_cid, true);
        end if;
      end loop;

      -- Los contenidos activos del saber que el archivo ya no menciona
      if f ->> 'id' is not null then
        for x in select co.id from public.contenidos_sugeridos co
                  where co.saber_id = f ->> 'id' and co.estado = 'activo' and not (propios ? co.id)
        loop
          c_archiva := c_archiva + 1;
          if p_aplicar then
            perform public.archivar_catalogo('contenidos_sugeridos', x.id, true, v_nota);
          end if;
        end loop;
      end if;
    end;
  end loop;

  -- ==========================================================================
  -- 3. Los saberes activos de los años del archivo que nadie reclamó
  -- ==========================================================================
  for x in select sa.id, sa.texto
             from public.saberes sa join public.ejes e on e.id = sa.eje_id
            where e.espacio_id = p_espacio_id and sa.estado = 'activo'
              and coalesce(sa.anio, 0::smallint) = any (anios)
              and not (tomados ? sa.id)
            order by sa.anio, sa.trimestre, e.orden, sa.orden
  loop
    n_archiva := n_archiva + 1;
    if jsonb_array_length(ejemplos) < 12 and n_archiva <= 4 then
      ejemplos := ejemplos || jsonb_build_object('que', 'saber que sale', 'antes', public.recortar(x.texto), 'despues', null);
    end if;
    if p_aplicar then
      perform public.archivar_catalogo('saberes', x.id, true, v_nota);
    end if;
  end loop;

  return jsonb_build_object(
    'aplicado',              p_aplicar,
    'materia',               v_espacio.nombre,
    'anios',                 (select jsonb_agg(a order by a) from unnest(anios) a),
    'por_ciclo',             v_espacio.saberes_por_ciclo,
    'filas',                 jsonb_array_length(plan),
    'saberes_se_mantienen',  n_mantiene,
    'saberes_corregidos',    n_corrige,
    'saberes_se_mueven',     n_mueve,
    'saberes_vuelven',       n_restaura,
    'saberes_nuevos',        n_nuevo,
    'saberes_salen',         n_archiva,
    'contenidos_nuevos',     c_nuevo,
    'contenidos_corregidos', c_corrige,
    'contenidos_vuelven',    c_restaura,
    'contenidos_salen',      c_archiva,
    'errores',               errores,
    'ejemplos',              ejemplos);
end;
$$;

revoke execute on function public.reemplazar_materia(text, jsonb, boolean, text) from public, anon;
grant  execute on function public.reemplazar_materia(text, jsonb, boolean, text) to authenticated;
revoke execute on function public.eje_desde_texto(text, text) from public, anon;
grant  execute on function public.eje_desde_texto(text, text) to authenticated;
