-- ============================================================================
-- 03_funciones.sql — Funciones
--
--   normalizar_texto(t)          igual que normalizarTexto() de assets/normalizar.js
--   registrar_aporte(payload)    la única puerta de entrada del formulario
--   cargar_catalogo(datos)       sincroniza el catálogo con datos/catalogo.json
--   cargar_escuelas(datos)       sincroniza escuelas con datos/escuelas.json
--   actualizar_grupos_texto_libre()   recalcula los grupos de textos libres
--
-- Se puede correr más de una vez.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- normalizar_texto(t)
--
-- Baja a minúsculas, quita acentos (ñ → n, ü → u), reemplaza todo lo que no
-- sea letra o número por un espacio y recorta.
--
-- TIENE que dar exactamente lo mismo que normalizarTexto() en
-- assets/normalizar.js. Si se cambia una, se cambia la otra.
--
-- Se quitan las marcas diacríticas ANTES de pasar a minúsculas, y el paso a
-- minúsculas es solo A-Z: así el resultado no depende del idioma configurado
-- en el servidor. Da lo mismo que JS porque todo lo que no es a-z o 0-9
-- termina convertido en espacio de todas formas.
--
--   'Retoman los saberes de 1° año'  → 'retoman los saberes de 1 ano'
--   'E.P.E.S. N° 41 "Dr. Pereyra"'   → 'e p e s n 41 dr pereyra'
-- ----------------------------------------------------------------------------

create or replace function public.normalizar_texto(t text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      translate(
        -- quita las marcas diacríticas U+0300 a U+036F (chr(768) a chr(879))
        regexp_replace(normalize(coalesce(t, ''), NFD), '[' || chr(768) || '-' || chr(879) || ']', '', 'g'),
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        'abcdefghijklmnopqrstuvwxyz'
      ),
      '[^a-z0-9]+', ' ', 'g'
    )
  );
$$;


-- ----------------------------------------------------------------------------
-- registrar_aporte(payload jsonb)
--
-- La llama el formulario al confirmar, una sola vez por materia:
--   supabase.rpc('registrar_aporte', { payload })
--
-- payload = {
--   docente: { nombre, apellido, clave? },      clave: uuid opcional (ver abajo)
--   escuela: { id } | { nombre, departamento_id, localidad },
--   espacio_id, anio,
--   selecciones: [{ saber_id, tipo: 'catalogo'|'libre', contenido_sugerido_id, texto, ... }],
--   saberes_no_trabajados: [saber_id, ...]
-- }
--
-- Todo pasa en una transacción: si algo falla, no queda nada a medias.
--
-- No confía en el navegador:
--   · verifica que cada saber sea de esa materia y ese año;
--   · para los contenidos del catálogo usa el texto del catálogo, no el que llega;
--   · recalcula texto_normalizado acá;
--   · si un texto "libre" coincide con un contenido sugerido de ese saber, lo
--     guarda como 'catalogo';
--   · descarta repetidos dentro del mismo saber.
--
-- docente.clave: si el navegador genera un uuid (crypto.randomUUID()) al
-- empezar y lo manda en cada envío, todas las materias de esa persona quedan
-- bajo un mismo docente. Y si el mismo docente reenvía la misma materia, año
-- y escuela, el envío nuevo reemplaza al anterior (sirve para reintentos y
-- correcciones). Si no se manda, cada envío crea un docente nuevo.
--
-- Devuelve { aporte_id, docente_clave, escuela_id, selecciones, saberes_no_trabajados }.
-- ----------------------------------------------------------------------------

create or replace function public.registrar_aporte(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_nombre          text;
  v_apellido        text;
  v_clave           uuid;
  v_docente_id      bigint;
  v_escuela         jsonb;
  v_escuela_id      text;
  v_esc_nombre      text;
  v_esc_norm        text;
  v_esc_depto       text;
  v_esc_localidad   text;
  v_espacio_id      text;
  v_espacio_nombre  text;
  v_anios           smallint[];
  v_anio_texto      text;
  v_anio            smallint;
  v_selecciones     jsonb;
  v_no_trabajados   jsonb;
  v_aporte_id       bigint;
  v_n_sel           integer;
  v_n_no            integer;
  v_problema        text;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'El envío llegó vacío o con un formato inesperado.'
      using errcode = '22023';
  end if;

  -- --- Docente ---------------------------------------------------------------
  v_nombre   := regexp_replace(btrim(coalesce(payload #>> '{docente,nombre}', '')), '\s+', ' ', 'g');
  v_apellido := regexp_replace(btrim(coalesce(payload #>> '{docente,apellido}', '')), '\s+', ' ', 'g');

  if v_nombre = '' or v_apellido = '' then
    raise exception 'Falta el nombre o el apellido.' using errcode = '22023';
  end if;
  if char_length(v_nombre) > 100 or char_length(v_apellido) > 100 then
    raise exception 'El nombre o el apellido son demasiado largos (máximo 100 letras cada uno).'
      using errcode = '22023';
  end if;

  if coalesce(payload #>> '{docente,clave}', '') <> '' then
    begin
      v_clave := (payload #>> '{docente,clave}')::uuid;
    exception when invalid_text_representation then
      raise exception 'La clave del docente no tiene un formato válido.' using errcode = '22023';
    end;
  end if;

  -- --- Escuela ---------------------------------------------------------------
  v_escuela := payload -> 'escuela';
  if v_escuela is null or jsonb_typeof(v_escuela) <> 'object' then
    raise exception 'Falta la escuela.' using errcode = '22023';
  end if;

  if coalesce(v_escuela ->> 'id', '') <> '' then
    select e.id into v_escuela_id
      from public.escuelas e
     where e.id = v_escuela ->> 'id';
    if v_escuela_id is null then
      raise exception 'La escuela elegida no está en el listado. Volvé a buscarla o escribila con "no encuentro mi escuela".'
        using errcode = '22023';
    end if;
  else
    -- "No encuentro mi escuela": la escribió el docente.
    v_esc_nombre    := regexp_replace(btrim(coalesce(v_escuela ->> 'nombre', '')), '\s+', ' ', 'g');
    v_esc_depto     := v_escuela ->> 'departamento_id';
    v_esc_localidad := nullif(regexp_replace(btrim(coalesce(v_escuela ->> 'localidad', '')), '\s+', ' ', 'g'), '');
    v_esc_norm      := public.normalizar_texto(v_esc_nombre);

    if v_esc_norm = '' then
      raise exception 'Falta el nombre de la escuela.' using errcode = '22023';
    end if;
    if char_length(v_esc_nombre) > 200 or char_length(coalesce(v_esc_localidad, '')) > 100 then
      raise exception 'El nombre de la escuela o la localidad son demasiado largos.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.departamentos d where d.id = v_esc_depto) then
      raise exception 'Elegí el departamento de la escuela.' using errcode = '22023';
    end if;

    -- Si ya hay una escuela con ese nombre en ese departamento (oficial o
    -- escrita por otro docente), se usa esa.
    select e.id into v_escuela_id
      from public.escuelas e
     where e.departamento_id = v_esc_depto
       and e.nombre_normalizado = v_esc_norm
     order by (e.origen = 'oficial') desc
     limit 1;

    if v_escuela_id is null then
      -- id determinístico: dos docentes que escriben lo mismo a la vez
      -- terminan en la misma escuela.
      v_escuela_id := 'agregada-' || left(md5(v_esc_depto || '|' || v_esc_norm), 12);
      insert into public.escuelas (id, departamento_id, nombre, localidad, nombre_normalizado, origen)
      values (v_escuela_id, v_esc_depto, v_esc_nombre, v_esc_localidad, v_esc_norm, 'agregada_por_docente')
      on conflict (id) do nothing;
    end if;
  end if;

  -- --- Materia y año ---------------------------------------------------------
  v_espacio_id := payload ->> 'espacio_id';
  select ec.nombre, ec.anios_dictados
    into v_espacio_nombre, v_anios
    from public.espacios_curriculares ec
   where ec.id = v_espacio_id;
  if v_espacio_nombre is null then
    raise exception 'La materia elegida no está en el diseño curricular.' using errcode = '22023';
  end if;

  v_anio_texto := payload ->> 'anio';
  if v_anio_texto is null or v_anio_texto !~ '^[123]$' then
    raise exception 'El año tiene que ser 1°, 2° o 3°.' using errcode = '22023';
  end if;
  v_anio := v_anio_texto::smallint;

  if not (v_anio = any (v_anios)) then
    raise exception '% no se dicta en %° año.', v_espacio_nombre, v_anio using errcode = '22023';
  end if;

  -- --- Contenidos ------------------------------------------------------------
  v_selecciones   := coalesce(payload -> 'selecciones', '[]'::jsonb);
  v_no_trabajados := coalesce(payload -> 'saberes_no_trabajados', '[]'::jsonb);

  if jsonb_typeof(v_selecciones) <> 'array' or jsonb_typeof(v_no_trabajados) <> 'array' then
    raise exception 'Los contenidos llegaron con un formato inesperado.' using errcode = '22023';
  end if;
  if jsonb_array_length(v_selecciones) = 0 and jsonb_array_length(v_no_trabajados) = 0 then
    raise exception 'No hay contenidos cargados para enviar.' using errcode = '22023';
  end if;
  if jsonb_array_length(v_selecciones) > 3000 or jsonb_array_length(v_no_trabajados) > 500 then
    raise exception 'El envío es demasiado grande.' using errcode = '22023';
  end if;

  -- Cada saber tiene que ser de esta materia y de este año
  -- (los saberes con anio null valen para todo el ciclo).
  with pedidos as (
    select e ->> 'saber_id' as saber_id from jsonb_array_elements(v_selecciones) as e
    union
    select e #>> '{}' from jsonb_array_elements(v_no_trabajados) as e
  )
  select string_agg(coalesce(p.saber_id, '(vacío)'), ', ')
    into v_problema
    from pedidos p
    left join public.saberes s on s.id = p.saber_id
    left join public.ejes ej   on ej.id = s.eje_id
   where s.id is null
      or ej.espacio_id <> v_espacio_id
      or (s.anio is not null and s.anio <> v_anio);
  if v_problema is not null then
    raise exception 'Algunos saberes no corresponden a % de %° año.', v_espacio_nombre, v_anio
      using errcode = '22023', detail = v_problema;
  end if;

  -- Tipo válido
  if exists (
    select 1 from jsonb_array_elements(v_selecciones) as e
     where coalesce(e ->> 'tipo', '') not in ('catalogo', 'libre')
  ) then
    raise exception 'Algunos contenidos llegaron sin tipo.' using errcode = '22023';
  end if;

  -- Los del catálogo tienen que existir y ser de su saber
  select string_agg(coalesce(e ->> 'contenido_sugerido_id', '(vacío)'), ', ')
    into v_problema
    from jsonb_array_elements(v_selecciones) as e
    left join public.contenidos_sugeridos c
           on c.id = e ->> 'contenido_sugerido_id'
          and c.saber_id = e ->> 'saber_id'
   where e ->> 'tipo' = 'catalogo'
     and c.id is null;
  if v_problema is not null then
    raise exception 'Algunos contenidos no están en el catálogo de su saber.'
      using errcode = '22023', detail = v_problema;
  end if;

  -- Los libres no pueden ser larguísimos
  if exists (
    select 1 from jsonb_array_elements(v_selecciones) as e
     where e ->> 'tipo' = 'libre'
       and char_length(btrim(coalesce(e ->> 'texto', ''))) > 500
  ) then
    raise exception 'Un contenido escrito supera los 500 caracteres. Acortalo o dividilo en dos.'
      using errcode = '22023';
  end if;

  -- --- Escritura -------------------------------------------------------------
  if v_clave is null then
    insert into public.docentes (nombre, apellido)
    values (v_nombre, v_apellido)
    returning id, clave into v_docente_id, v_clave;
  else
    insert into public.docentes (clave, nombre, apellido)
    values (v_clave, v_nombre, v_apellido)
    on conflict (clave) do update
      set nombre = excluded.nombre, apellido = excluded.apellido
    returning id into v_docente_id;
  end if;

  insert into public.aportes (docente_id, escuela_id, espacio_id, anio)
  values (v_docente_id, v_escuela_id, v_espacio_id, v_anio)
  on conflict (docente_id, escuela_id, espacio_id, anio)
    do update set enviado_en = now()
  returning id into v_aporte_id;

  -- Si es un reenvío de la misma materia, el nuevo reemplaza al anterior.
  delete from public.selecciones           where aporte_id = v_aporte_id;
  delete from public.saberes_no_trabajados where aporte_id = v_aporte_id;

  with entrada as (
    select e ->> 'saber_id' as saber_id,
           e ->> 'tipo'     as tipo,
           c.id             as contenido_id,
           case when e ->> 'tipo' = 'catalogo'
                then c.texto
                else regexp_replace(btrim(coalesce(e ->> 'texto', '')), '\s+', ' ', 'g')
           end              as texto,
           t.pos
      from jsonb_array_elements(v_selecciones) with ordinality as t(e, pos)
      left join public.contenidos_sugeridos c
             on e ->> 'tipo' = 'catalogo'
            and c.id = e ->> 'contenido_sugerido_id'
  ),
  normalizada as (
    select en.*, public.normalizar_texto(en.texto) as texto_normalizado
      from entrada en
  ),
  -- Un texto libre idéntico a un contenido sugerido de ese saber cuenta como catálogo.
  resuelta as (
    select n.saber_id,
           case when cs.id is not null then 'catalogo' else n.tipo end            as tipo,
           coalesce(n.contenido_id, cs.id)                                         as contenido_id,
           case when cs.id is not null then cs.texto else n.texto end              as texto,
           n.texto_normalizado,
           n.pos
      from normalizada n
      left join lateral (
        select c2.id, c2.texto
          from public.contenidos_sugeridos c2
         where n.tipo = 'libre'
           and c2.saber_id = n.saber_id
           and c2.texto_normalizado = n.texto_normalizado
         limit 1
      ) cs on true
     where n.texto_normalizado <> ''
  ),
  unica as (
    select distinct on (r.saber_id, r.texto_normalizado) r.*
      from resuelta r
     order by r.saber_id, r.texto_normalizado, (r.tipo = 'catalogo') desc, r.pos
  )
  insert into public.selecciones
    (aporte_id, saber_id, tipo, contenido_sugerido_id, texto, texto_normalizado, orden)
  select v_aporte_id, u.saber_id, u.tipo, u.contenido_id, u.texto, u.texto_normalizado,
         row_number() over (partition by u.saber_id order by u.pos)
    from unica u;
  get diagnostics v_n_sel = row_count;

  -- "No trabajo este saber" (si por error también trae contenidos, ganan los contenidos)
  insert into public.saberes_no_trabajados (aporte_id, saber_id)
  select distinct v_aporte_id, e #>> '{}'
    from jsonb_array_elements(v_no_trabajados) as e
   where not exists (
     select 1 from public.selecciones s
      where s.aporte_id = v_aporte_id and s.saber_id = e #>> '{}'
   );
  get diagnostics v_n_no = row_count;

  if v_n_sel = 0 and v_n_no = 0 then
    raise exception 'No hay contenidos cargados para enviar.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'aporte_id',             v_aporte_id,
    'docente_clave',         v_clave,
    'escuela_id',            v_escuela_id,
    'selecciones',           v_n_sel,
    'saberes_no_trabajados', v_n_no
  );
end;
$$;

-- El visitante anónimo solo puede hacer esto.
revoke execute on function public.registrar_aporte(jsonb) from public;
grant  execute on function public.registrar_aporte(jsonb) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- cargar_catalogo(datos jsonb)
--
-- Recibe el contenido de datos/catalogo.json y deja la base igual:
--   · agrega lo nuevo y actualiza lo que cambió (por id);
--   · borra lo que ya no está en el JSON, SALVO que algún docente ya lo haya
--     usado: eso se conserva para no perder respuestas.
-- texto_normalizado se recalcula acá con normalizar_texto().
--
-- Los contenidos sugeridos pueden venir vacíos: en ese caso no se toca ninguno
-- y se cargan aparte, en lotes, con cargar_contenidos(). Es lo que hace
-- generar_cargas.py, porque el catálogo entero no entra en una sola consulta
-- del SQL Editor de Supabase.
--
-- Se usa desde el SQL Editor (archivo 07_cargar_catalogo.sql). No es pública.
-- ----------------------------------------------------------------------------

create or replace function public.cargar_catalogo(datos jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_resultado       jsonb := '{}'::jsonb;
  v_n               integer;
  v_ids_areas       text[] := array(select j ->> 'id' from jsonb_array_elements(datos -> 'areas') j);
  v_ids_espacios    text[] := array(select j ->> 'id' from jsonb_array_elements(datos -> 'espacios') j);
  v_ids_ejes        text[] := array(select j ->> 'id' from jsonb_array_elements(datos -> 'ejes') j);
  v_ids_saberes     text[] := array(select j ->> 'id' from jsonb_array_elements(datos -> 'saberes') j);
  v_ids_contenidos  text[] := array(select j ->> 'id' from jsonb_array_elements(datos -> 'contenidos') j);
begin
  if cardinality(v_ids_saberes) = 0 then
    raise exception 'El JSON no tiene saberes: no se carga nada.';
  end if;

  -- La auditoría del catálogo registra los cambios que hace el equipo desde el
  -- dashboard; una carga del JSON no tiene que dejar miles de filas (queda
  -- registrada en el repositorio). Ver 09_edicion_catalogo.sql.
  perform set_config('app.carga_masiva', 'on', true);

  -- Áreas
  insert into public.areas (id, nombre, orden)
  select x.id, x.nombre, x.orden
    from jsonb_to_recordset(datos -> 'areas') as x(id text, nombre text, orden smallint)
  on conflict (id) do update
    set nombre = excluded.nombre, orden = excluded.orden;
  get diagnostics v_n = row_count;
  v_resultado := v_resultado || jsonb_build_object('areas', v_n);

  -- Espacios curriculares
  insert into public.espacios_curriculares
    (id, area_id, nombre, anios_dictados, saberes_por_ciclo, origen, orden)
  select x.id, x.area_id, x.nombre,
         array(select a::smallint from jsonb_array_elements_text(x.anios_dictados) as a order by 1),
         coalesce(x.saberes_por_ciclo, false), x.origen, x.orden
    from jsonb_to_recordset(datos -> 'espacios')
         as x(id text, area_id text, nombre text, anios_dictados jsonb,
              saberes_por_ciclo boolean, origen text, orden smallint)
  on conflict (id) do update
    set area_id = excluded.area_id, nombre = excluded.nombre,
        anios_dictados = excluded.anios_dictados,
        saberes_por_ciclo = excluded.saberes_por_ciclo,
        origen = excluded.origen, orden = excluded.orden;
  get diagnostics v_n = row_count;
  v_resultado := v_resultado || jsonb_build_object('espacios', v_n);

  -- Ejes
  insert into public.ejes (id, espacio_id, nombre, orden)
  select x.id, x.espacio_id, x.nombre, x.orden
    from jsonb_to_recordset(datos -> 'ejes') as x(id text, espacio_id text, nombre text, orden smallint)
  on conflict (id) do update
    set espacio_id = excluded.espacio_id, nombre = excluded.nombre, orden = excluded.orden;
  get diagnostics v_n = row_count;
  v_resultado := v_resultado || jsonb_build_object('ejes', v_n);

  -- Saberes
  insert into public.saberes (id, eje_id, anio, trimestre, texto, calidad, orden)
  select x.id, x.eje_id, x.anio, x.trimestre, x.texto, x.calidad, x.orden
    from jsonb_to_recordset(datos -> 'saberes')
         as x(id text, eje_id text, anio smallint, trimestre smallint,
              texto text, calidad text, orden smallint)
  on conflict (id) do update
    set eje_id = excluded.eje_id, anio = excluded.anio, trimestre = excluded.trimestre,
        texto = excluded.texto, calidad = excluded.calidad, orden = excluded.orden;
  get diagnostics v_n = row_count;
  v_resultado := v_resultado || jsonb_build_object('saberes', v_n);

  -- Contenidos sugeridos
  insert into public.contenidos_sugeridos (id, saber_id, texto, texto_normalizado, origen)
  select x.id, x.saber_id, x.texto, public.normalizar_texto(x.texto),
         coalesce(x.origen, 'resolucion_672')
    from jsonb_to_recordset(datos -> 'contenidos')
         as x(id text, saber_id text, texto text, origen text)
  on conflict (id) do update
    set saber_id = excluded.saber_id, texto = excluded.texto,
        texto_normalizado = excluded.texto_normalizado, origen = excluded.origen;
  get diagnostics v_n = row_count;
  v_resultado := v_resultado || jsonb_build_object('contenidos', v_n);

  -- Lo que salió del JSON y nadie usó, se borra (de abajo hacia arriba).
  -- Si el JSON viene sin contenidos, no se toca ninguno: los contenidos se
  -- cargan aparte con cargar_contenidos() porque no entran en una sola
  -- consulta del SQL Editor.
  if cardinality(v_ids_contenidos) > 0 then
    delete from public.contenidos_sugeridos c
     where not (c.id = any (v_ids_contenidos))
       and not exists (select 1 from public.selecciones s        where s.contenido_sugerido_id = c.id)
       and not exists (select 1 from public.grupos_texto_libre g where g.contenido_sugerido_id = c.id);
    get diagnostics v_n = row_count;
    v_resultado := v_resultado || jsonb_build_object('contenidos_borrados', v_n);

    -- Los que no se pudieron borrar porque ya tienen respuestas se archivan:
    -- dejan de ofrecerse, pero las respuestas siguen ahí.
    update public.contenidos_sugeridos c
       set estado = 'archivado'
     where not (c.id = any (v_ids_contenidos)) and c.estado = 'activo';
    get diagnostics v_n = row_count;
    v_resultado := v_resultado || jsonb_build_object('contenidos_archivados', v_n);
  end if;

  delete from public.saberes s
   where not (s.id = any (v_ids_saberes))
     and not exists (select 1 from public.contenidos_sugeridos c  where c.saber_id = s.id)
     and not exists (select 1 from public.selecciones x           where x.saber_id = s.id)
     and not exists (select 1 from public.saberes_no_trabajados n where n.saber_id = s.id)
     and not exists (select 1 from public.grupos_texto_libre g    where g.saber_id = s.id);
  get diagnostics v_n = row_count;
  v_resultado := v_resultado || jsonb_build_object('saberes_borrados', v_n);

  update public.saberes s
     set estado = 'archivado'
   where not (s.id = any (v_ids_saberes)) and s.estado = 'activo';
  get diagnostics v_n = row_count;
  v_resultado := v_resultado || jsonb_build_object('saberes_archivados', v_n);

  delete from public.ejes e
   where not (e.id = any (v_ids_ejes))
     and not exists (select 1 from public.saberes s where s.eje_id = e.id);

  delete from public.espacios_curriculares ec
   where not (ec.id = any (v_ids_espacios))
     and not exists (select 1 from public.ejes e    where e.espacio_id = ec.id)
     and not exists (select 1 from public.aportes a where a.espacio_id = ec.id);

  delete from public.areas a
   where not (a.id = any (v_ids_areas))
     and not exists (select 1 from public.espacios_curriculares ec where ec.area_id = a.id);

  -- Aviso: saberes que ya no están en el JSON pero quedaron porque tienen respuestas.
  select count(*) into v_n
    from public.saberes s
   where not (s.id = any (v_ids_saberes));
  v_resultado := v_resultado || jsonb_build_object('saberes_conservados_por_tener_respuestas', v_n);

  return v_resultado;
end;
$$;

revoke execute on function public.cargar_catalogo(jsonb) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- cargar_contenidos(datos jsonb)
--
-- Carga SOLO los contenidos sugeridos, en lotes. Existe porque el catálogo
-- completo no entra en una sola consulta del SQL Editor de Supabase: da
-- "Query is too large to be run via the SQL Editor".
--
-- Cada lote trae saberes enteros con todos sus contenidos, así que para los
-- saberes que vienen en el lote se borra lo que ya no está y se agrega o
-- actualiza el resto. Los saberes que no vienen en el lote no se tocan: se
-- pueden correr los lotes en cualquier orden y repetir los que haga falta.
--
--   select public.cargar_contenidos($datos${"contenidos":[...]}$datos$::jsonb);
--
-- Un contenido que algún docente ya eligió no se borra: se conserva la
-- respuesta y el resultado lo informa en "conservados".
-- ----------------------------------------------------------------------------

create or replace function public.cargar_contenidos(datos jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_ids      text[] := array(select j ->> 'id'       from jsonb_array_elements(datos -> 'contenidos') j);
  v_saberes  text[] := array(select distinct j ->> 'saber_id' from jsonb_array_elements(datos -> 'contenidos') j);
  v_faltan   text;
  v_nuevos   integer;
  v_borrados integer;
  v_quedan   integer;
begin
  if cardinality(v_ids) = 0 then
    raise exception 'El lote no trae contenidos.';
  end if;

  perform set_config('app.carga_masiva', 'on', true);   -- ver 09_edicion_catalogo.sql

  select string_agg(distinct x.saber_id, ', ')
    into v_faltan
    from unnest(v_saberes) as x(saber_id)
    left join public.saberes s on s.id = x.saber_id
   where s.id is null;
  if v_faltan is not null then
    raise exception 'Hay contenidos de saberes que no existen en la base: %', left(v_faltan, 300);
  end if;

  insert into public.contenidos_sugeridos (id, saber_id, texto, texto_normalizado, origen)
  select x.id, x.saber_id, x.texto, public.normalizar_texto(x.texto),
         coalesce(x.origen, 'propuesto_equipo')
    from jsonb_to_recordset(datos -> 'contenidos')
         as x(id text, saber_id text, texto text, origen text)
  on conflict (id) do update
    set saber_id = excluded.saber_id, texto = excluded.texto,
        texto_normalizado = excluded.texto_normalizado, origen = excluded.origen;
  get diagnostics v_nuevos = row_count;

  -- Dentro de los saberes de este lote, lo que ya no está se borra.
  delete from public.contenidos_sugeridos c
   where c.saber_id = any (v_saberes)
     and not (c.id = any (v_ids))
     and not exists (select 1 from public.selecciones s        where s.contenido_sugerido_id = c.id)
     and not exists (select 1 from public.grupos_texto_libre g where g.contenido_sugerido_id = c.id);
  get diagnostics v_borrados = row_count;

  -- Lo que no se pudo borrar porque ya tiene respuestas se archiva
  update public.contenidos_sugeridos c
     set estado = 'archivado'
   where c.saber_id = any (v_saberes)
     and not (c.id = any (v_ids))
     and c.estado = 'activo';

  select count(*) into v_quedan
    from public.contenidos_sugeridos c
   where c.saber_id = any (v_saberes)
     and not (c.id = any (v_ids));

  return jsonb_build_object(
    'saberes', cardinality(v_saberes),
    'contenidos', v_nuevos,
    'borrados', v_borrados,
    'conservados', v_quedan);   -- viejos que no se pudieron borrar: ya tienen respuestas
end;
$$;

revoke execute on function public.cargar_contenidos(jsonb) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- cargar_escuelas(datos jsonb)
--
-- Recibe el contenido de datos/escuelas.json. Agrega y actualiza por id.
-- No toca las escuelas que escribieron los docentes.
-- ----------------------------------------------------------------------------

create or replace function public.cargar_escuelas(datos jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_deptos   integer;
  v_escuelas integer;
begin
  insert into public.departamentos (id, nombre)
  select x.id, x.nombre
    from jsonb_to_recordset(datos -> 'departamentos') as x(id text, nombre text)
  on conflict (id) do update set nombre = excluded.nombre;
  get diagnostics v_deptos = row_count;

  insert into public.escuelas
    (id, departamento_id, numero, denominacion, nombre, localidad, nombre_normalizado, origen)
  select x.id, x.departamento_id, x.numero, x.denominacion, x.nombre, x.localidad,
         public.normalizar_texto(x.nombre), 'oficial'
    from jsonb_to_recordset(datos -> 'escuelas')
         as x(id text, departamento_id text, numero text, denominacion text,
              nombre text, localidad text)
  on conflict (id) do update
    set departamento_id = excluded.departamento_id, numero = excluded.numero,
        denominacion = excluded.denominacion, nombre = excluded.nombre,
        localidad = excluded.localidad, nombre_normalizado = excluded.nombre_normalizado,
        origen = 'oficial';
  get diagnostics v_escuelas = row_count;

  -- Las oficiales que ya no vienen en la nómina quedan no vigentes. No se
  -- borran: pueden tener aportes.
  update public.escuelas e
     set vigente = (e.id in (select x ->> 'id' from jsonb_array_elements(datos -> 'escuelas') x))
   where e.origen = 'oficial';

  return jsonb_build_object('departamentos', v_deptos, 'escuelas', v_escuelas,
    'no_vigentes', (select count(*) from public.escuelas where origen = 'oficial' and not vigente));
end;
$$;

revoke execute on function public.cargar_escuelas(jsonb) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- actualizar_grupos_texto_libre()
--
-- Agrupa los contenidos escritos a mano ('libre') por saber y texto
-- normalizado, y actualiza la frecuencia. No pisa lo que el equipo ya revisó
-- (texto_representativo, contenido_sugerido_id, estado).
-- No cuenta los datos de ejemplo.
-- ----------------------------------------------------------------------------

create or replace function public.actualizar_grupos_texto_libre()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  -- Desde la API solo el equipo; desde el SQL Editor (sin usuario) siempre.
  if (select auth.uid()) is not null and not public.es_equipo() then
    raise exception 'Solo el equipo de Planificación puede actualizar los grupos.'
      using errcode = '42501';
  end if;

  insert into public.grupos_texto_libre (saber_id, texto_normalizado, texto_representativo, frecuencia)
  select s.saber_id,
         s.texto_normalizado,
         mode() within group (order by s.texto),
         count(distinct s.aporte_id)
    from public.selecciones s
    join public.aportes a on a.id = s.aporte_id
   where s.tipo = 'libre'
     and not a.es_ejemplo
   group by s.saber_id, s.texto_normalizado
  on conflict (saber_id, texto_normalizado) do update
    set frecuencia = excluded.frecuencia;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.actualizar_grupos_texto_libre() from public, anon;
grant  execute on function public.actualizar_grupos_texto_libre() to authenticated;
