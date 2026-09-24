-- ============================================================================
-- 11_importar_catalogo.sql — Traer correcciones hechas fuera del panel
--
-- El equipo revisa el catálogo en Excel, no en la pantalla: es más cómodo para
-- leer 942 saberes de corrido y repartir el trabajo entre varias personas.
-- Hasta ahora esas correcciones había que pasarlas a mano, una por una.
--
-- importar_catalogo() recibe las filas del archivo (da igual si vino de un
-- Excel o de un JSON: el navegador las deja en la misma forma) y las aplica
-- cruzando por id. Cuatro reglas la ordenan:
--
-- 1. LO QUE NO ESTÁ EN EL ARCHIVO NO SE TOCA. Ausencia no es baja. El Excel
--    que está revisando el equipo tiene menos saberes que el catálogo, y un
--    importador que archivara lo que falta sería una catástrofe silenciosa.
--    Para archivar algo hay que decirlo en la columna «estado».
--
-- 2. UN SABER SE RESUELVE UNA SOLA VEZ, aunque venga en muchas filas. El
--    archivo trae una fila por contenido, así que un saber con cinco
--    contenidos aparece cinco veces con su texto repetido. Si se tomara fila
--    por fila, corregir el texto en una sola de ellas dejaría el saber yendo y
--    viniendo entre el texto nuevo y el viejo. Por eso primero se junta lo que
--    el archivo dice de cada saber y recién después se compara contra la base.
--    Si dos filas del mismo saber se contradicen, se avisa y no se aplica.
--
-- 3. PRIMERO SE MIRA, DESPUÉS SE APLICA. Con p_aplicar en false devuelve el
--    resumen de lo que haría sin escribir nada. La pantalla lo muestra y
--    recién entonces ofrece confirmar.
--
-- 4. TODO O NADA. Si alguna fila tiene un problema, no se aplica ninguna y se
--    informa cuáles son. Media importación aplicada es peor que ninguna.
--
-- Escribe llamando a guardar_saber, guardar_contenido y archivar_catalogo, las
-- mismas del panel: valen sus validaciones y queda todo en la auditoría.
--
-- Se puede correr más de una vez.
-- ============================================================================


-- Cada fila del archivo, ya limpia por el navegador:
--   { fila, saber_id, eje_id, anio, trimestre, saber,
--     contenido_id, contenido, saber_estado, contenido_estado }
--
-- Las columnas vacías significan «no opino sobre esto», no «borralo».
create or replace function public.importar_catalogo(
  p_filas   jsonb,
  p_aplicar boolean default false,
  p_archivo text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  f            jsonb;
  v_fila       integer;
  v_saber_id   text;
  v_eje_id     text;
  v_saber      text;
  v_trimestre  text;
  v_anio       text;
  v_cont_id    text;
  v_cont       text;
  v_est_saber  text;
  v_est_cont   text;
  v_clave      text;
  v_norm       text;
  v_dato       jsonb;
  v_lista      jsonb;
  v_texto      text;
  v_nuevo_id   text;
  v_sid        text;

  s record;
  c record;

  -- Lo que el archivo dice de cada saber, junto: clave → lo declarado
  agrupado  jsonb := '{}'::jsonb;
  -- Las filas que pasaron la primera revisión, para recorrer los contenidos
  filas_ok  jsonb := '[]'::jsonb;
  -- clave → id real del saber (null si su saber quedó con error)
  resueltos jsonb := '{}'::jsonb;
  -- claves cuyo saber cambió, para no contar la fila como «sin cambios»
  tocados   jsonb := '{}'::jsonb;
  -- contenidos nuevos ya vistos en este archivo, para no contarlos dos veces
  agregados jsonb := '{}'::jsonb;

  n_saber_nuevo      integer := 0;
  n_saber_editado    integer := 0;
  n_saber_archivado  integer := 0;
  n_saber_restaurado integer := 0;
  n_cont_nuevo       integer := 0;
  n_cont_editado     integer := 0;
  n_cont_archivado   integer := 0;
  n_cont_restaurado  integer := 0;
  n_sin_cambios      integer := 0;
  n_filas            integer := 0;

  errores  jsonb := '[]'::jsonb;
  ejemplos jsonb := '[]'::jsonb;

  v_nota text := 'Importado' || coalesce(' de ' || nullif(btrim(p_archivo), ''), '');
begin
  if not public.es_equipo() then
    raise exception 'Tu usuario no está en el equipo de Planificación.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_filas) <> 'array' then
    raise exception 'El archivo no trajo filas para importar.' using errcode = '22023';
  end if;

  -- ==========================================================================
  -- Paso 1. Leer las filas y juntar lo que dicen de cada saber
  -- ==========================================================================
  for f in select * from jsonb_array_elements(p_filas)
  loop
    v_fila      := coalesce((f ->> 'fila')::integer, 0);
    v_saber_id  := nullif(btrim(coalesce(f ->> 'saber_id', '')), '');
    v_eje_id    := nullif(btrim(coalesce(f ->> 'eje_id', '')), '');
    v_saber     := regexp_replace(btrim(coalesce(f ->> 'saber', '')), '\s+', ' ', 'g');
    v_cont_id   := nullif(btrim(coalesce(f ->> 'contenido_id', '')), '');
    v_cont      := regexp_replace(btrim(coalesce(f ->> 'contenido', '')), '\s+', ' ', 'g');
    v_est_saber := lower(nullif(btrim(coalesce(f ->> 'saber_estado', '')), ''));
    v_est_cont  := lower(nullif(btrim(coalesce(f ->> 'contenido_estado', '')), ''));
    v_trimestre := nullif(btrim(coalesce(f ->> 'trimestre', '')), '');
    v_anio      := nullif(btrim(coalesce(f ->> 'anio', '')), '');

    -- Fila en blanco: el Excel suele traer varias al final
    continue when v_saber_id is null and v_saber = '' and v_cont_id is null and v_cont = '';
    n_filas := n_filas + 1;

    if v_est_saber is not null and v_est_saber not in ('activo', 'archivado') then
      errores := errores || jsonb_build_object('fila', v_fila,
        'mensaje', 'La columna «estado del saber» dice «' || v_est_saber || '». Tiene que decir activo o archivado.');
      continue;
    end if;
    if v_est_cont is not null and v_est_cont not in ('activo', 'archivado') then
      errores := errores || jsonb_build_object('fila', v_fila,
        'mensaje', 'La columna «estado del contenido» dice «' || v_est_cont || '». Tiene que decir activo o archivado.');
      continue;
    end if;

    -- De qué saber habla la fila
    if v_saber_id is not null then
      v_clave := 'id:' || v_saber_id;
    else
      if v_saber = '' then
        errores := errores || jsonb_build_object('fila', v_fila,
          'mensaje', 'La fila trae un contenido pero no dice a qué saber pertenece.');
        continue;
      end if;
      if v_eje_id is null then
        errores := errores || jsonb_build_object('fila', v_fila,
          'mensaje', 'Para dar de alta un saber hace falta la columna «eje_id».');
        continue;
      end if;
      v_clave := 'nuevo:' || v_eje_id || '|' || public.normalizar_texto(v_saber);
    end if;

    -- Acumular lo declarado, sin repetir
    v_dato := coalesce(agrupado -> v_clave, jsonb_build_object(
      'fila', v_fila, 'saber_id', v_saber_id, 'eje_id', v_eje_id,
      'textos', '[]'::jsonb, 'trimestres', '[]'::jsonb, 'anios', '[]'::jsonb, 'estados', '[]'::jsonb));
    if v_saber <> '' and not (v_dato -> 'textos' ? v_saber) then
      v_dato := jsonb_set(v_dato, '{textos}', (v_dato -> 'textos') || to_jsonb(v_saber));
    end if;
    if v_trimestre is not null and not (v_dato -> 'trimestres' ? v_trimestre) then
      v_dato := jsonb_set(v_dato, '{trimestres}', (v_dato -> 'trimestres') || to_jsonb(v_trimestre));
    end if;
    if v_anio is not null and not (v_dato -> 'anios' ? v_anio) then
      v_dato := jsonb_set(v_dato, '{anios}', (v_dato -> 'anios') || to_jsonb(v_anio));
    end if;
    if v_est_saber is not null and not (v_dato -> 'estados' ? v_est_saber) then
      v_dato := jsonb_set(v_dato, '{estados}', (v_dato -> 'estados') || to_jsonb(v_est_saber));
    end if;
    agrupado := agrupado || jsonb_build_object(v_clave, v_dato);

    filas_ok := filas_ok || jsonb_build_object(
      'fila', v_fila, 'clave', v_clave,
      'contenido_id', v_cont_id, 'contenido', v_cont, 'contenido_estado', v_est_cont);
  end loop;

  -- ==========================================================================
  -- Paso 2. Un saber, una decisión
  -- ==========================================================================
  for v_clave, v_dato in
    select clave, dato from jsonb_each(agrupado) as t(clave, dato)
     order by (dato ->> 'fila')::integer
  loop
    v_fila     := (v_dato ->> 'fila')::integer;
    v_saber_id := v_dato ->> 'saber_id';
    v_eje_id   := v_dato ->> 'eje_id';

    -- Dos filas del mismo saber que se contradicen: mejor frenar y avisar
    v_lista := v_dato -> 'textos';
    if jsonb_array_length(v_lista) > 1 then
      errores := errores || jsonb_build_object('fila', v_fila,
        'mensaje', 'El saber aparece en varias filas con textos distintos. Dejá el mismo texto en todas '
                || 'las filas de ese saber: «' || left(v_lista ->> 0, 60) || '…» contra «' || left(v_lista ->> 1, 60) || '…».');
      resueltos := resueltos || jsonb_build_object(v_clave, 'null'::jsonb);
      continue;
    end if;
    if jsonb_array_length(v_dato -> 'trimestres') > 1 then
      errores := errores || jsonb_build_object('fila', v_fila,
        'mensaje', 'El saber aparece con más de un trimestre en el archivo.');
      resueltos := resueltos || jsonb_build_object(v_clave, 'null'::jsonb);
      continue;
    end if;
    if jsonb_array_length(v_dato -> 'estados') > 1 then
      errores := errores || jsonb_build_object('fila', v_fila,
        'mensaje', 'El saber aparece como activo en una fila y archivado en otra.');
      resueltos := resueltos || jsonb_build_object(v_clave, 'null'::jsonb);
      continue;
    end if;

    v_texto     := v_lista ->> 0;                       -- null si el archivo no lo trae
    v_trimestre := v_dato -> 'trimestres' ->> 0;
    v_anio      := v_dato -> 'anios' ->> 0;
    v_est_saber := v_dato -> 'estados' ->> 0;

    -- ------------------------------------------------------------ alta
    if v_saber_id is null then
      if not exists (select 1 from public.ejes e where e.id = v_eje_id) then
        errores := errores || jsonb_build_object('fila', v_fila,
          'mensaje', 'El eje «' || v_eje_id || '» no existe.');
        resueltos := resueltos || jsonb_build_object(v_clave, 'null'::jsonb);
        continue;
      end if;
      if v_trimestre is null or v_trimestre !~ '^[123]$' then
        errores := errores || jsonb_build_object('fila', v_fila,
          'mensaje', 'El saber nuevo necesita trimestre (1, 2 o 3).');
        resueltos := resueltos || jsonb_build_object(v_clave, 'null'::jsonb);
        continue;
      end if;

      if p_aplicar then
        v_nuevo_id := (public.guardar_saber(jsonb_build_object(
          'eje_id', v_eje_id, 'anio', v_anio::smallint, 'trimestre', v_trimestre::smallint,
          'texto', v_texto, 'nota', v_nota)) ->> 'id');
      else
        v_nuevo_id := v_clave;
      end if;

      resueltos := resueltos || jsonb_build_object(v_clave, to_jsonb(v_nuevo_id));
      tocados   := tocados   || jsonb_build_object(v_clave, to_jsonb(true));
      n_saber_nuevo := n_saber_nuevo + 1;
      if jsonb_array_length(ejemplos) < 12 then
        ejemplos := ejemplos || jsonb_build_object('fila', v_fila, 'que', 'saber nuevo',
          'antes', null, 'despues', left(v_texto, 120));
      end if;
      continue;
    end if;

    -- -------------------------------------------------------- corrección
    select sa.id, sa.eje_id, sa.anio, sa.trimestre, sa.texto, sa.estado
      into s
      from public.saberes sa where sa.id = v_saber_id;
    if s.id is null then
      errores := errores || jsonb_build_object('fila', v_fila,
        'mensaje', 'El saber «' || v_saber_id || '» no existe. Si querés darlo de alta, dejá la columna del id vacía.');
      resueltos := resueltos || jsonb_build_object(v_clave, 'null'::jsonb);
      continue;
    end if;
    resueltos := resueltos || jsonb_build_object(v_clave, to_jsonb(v_saber_id));

    if (v_texto is not null and v_texto <> s.texto)
       or (v_trimestre is not null and v_trimestre::smallint <> s.trimestre) then
      if p_aplicar then
        perform public.guardar_saber(jsonb_build_object(
          'id', s.id, 'eje_id', s.eje_id, 'anio', s.anio,
          'trimestre', coalesce(v_trimestre::smallint, s.trimestre),
          'texto', coalesce(v_texto, s.texto), 'nota', v_nota));
      end if;
      tocados := tocados || jsonb_build_object(v_clave, to_jsonb(true));
      n_saber_editado := n_saber_editado + 1;
      if jsonb_array_length(ejemplos) < 12 then
        ejemplos := ejemplos || jsonb_build_object('fila', v_fila, 'que', 'saber corregido',
          'antes', left(s.texto, 120), 'despues', left(coalesce(v_texto, s.texto), 120));
      end if;
    end if;

    if v_est_saber is not null and v_est_saber <> s.estado then
      if p_aplicar then
        perform public.archivar_catalogo('saberes', s.id, v_est_saber = 'archivado', v_nota);
      end if;
      tocados := tocados || jsonb_build_object(v_clave, to_jsonb(true));
      if v_est_saber = 'archivado' then
        n_saber_archivado := n_saber_archivado + 1;
      else
        n_saber_restaurado := n_saber_restaurado + 1;
      end if;
      if jsonb_array_length(ejemplos) < 12 then
        ejemplos := ejemplos || jsonb_build_object('fila', v_fila,
          'que', case when v_est_saber = 'archivado' then 'saber archivado' else 'saber restaurado' end,
          'antes', left(s.texto, 120), 'despues', null);
      end if;
    end if;
  end loop;

  -- ==========================================================================
  -- Paso 3. Los contenidos, ahora sí fila por fila
  -- ==========================================================================
  for f in select * from jsonb_array_elements(filas_ok)
  loop
    v_fila     := (f ->> 'fila')::integer;
    v_clave    := f ->> 'clave';
    v_cont_id  := f ->> 'contenido_id';
    v_cont     := coalesce(f ->> 'contenido', '');
    v_est_cont := f ->> 'contenido_estado';

    -- Su saber quedó con error: la fila entera se descarta
    continue when (resueltos -> v_clave) is null or jsonb_typeof(resueltos -> v_clave) = 'null';
    v_sid := resueltos ->> v_clave;

    if v_cont_id is null and v_cont = '' then
      if not (tocados ? v_clave) then n_sin_cambios := n_sin_cambios + 1; end if;
      continue;
    end if;

    -- ----------------------------------------------------- contenido con id
    if v_cont_id is not null then
      select co.id, co.saber_id, co.texto, co.estado
        into c
        from public.contenidos_sugeridos co where co.id = v_cont_id;
      if c.id is null then
        errores := errores || jsonb_build_object('fila', v_fila,
          'mensaje', 'El contenido «' || v_cont_id || '» no existe. Si es nuevo, dejá la columna del id vacía.');
        continue;
      end if;

      if v_cont <> '' and v_cont <> c.texto then
        if p_aplicar then
          perform public.guardar_contenido(jsonb_build_object('id', c.id, 'texto', v_cont, 'nota', v_nota));
        end if;
        n_cont_editado := n_cont_editado + 1;
        if jsonb_array_length(ejemplos) < 12 then
          ejemplos := ejemplos || jsonb_build_object('fila', v_fila, 'que', 'contenido corregido',
            'antes', left(c.texto, 120), 'despues', left(v_cont, 120));
        end if;
      elsif v_est_cont is null or v_est_cont = c.estado then
        n_sin_cambios := n_sin_cambios + 1;
      end if;

      if v_est_cont is not null and v_est_cont <> c.estado then
        if p_aplicar then
          perform public.archivar_catalogo('contenidos_sugeridos', c.id, v_est_cont = 'archivado', v_nota);
        end if;
        if v_est_cont = 'archivado' then
          n_cont_archivado := n_cont_archivado + 1;
        else
          n_cont_restaurado := n_cont_restaurado + 1;
        end if;
        if jsonb_array_length(ejemplos) < 12 then
          ejemplos := ejemplos || jsonb_build_object('fila', v_fila,
            'que', case when v_est_cont = 'archivado' then 'contenido archivado' else 'contenido restaurado' end,
            'antes', left(c.texto, 120), 'despues', null);
        end if;
      end if;
      continue;
    end if;

    -- -------------------------------------------------- contenido sin id: alta
    v_norm := public.normalizar_texto(v_cont);
    if v_norm = '' then
      n_sin_cambios := n_sin_cambios + 1;
      continue;
    end if;

    -- Ya lo tiene el saber, o ya vino en otra fila de este mismo archivo
    if (agregados ? (v_sid || '|' || v_norm))
       or exists (select 1 from public.contenidos_sugeridos co
                   where co.saber_id = v_sid and co.texto_normalizado = v_norm) then
      n_sin_cambios := n_sin_cambios + 1;
      continue;
    end if;
    agregados := agregados || jsonb_build_object(v_sid || '|' || v_norm, to_jsonb(true));

    if p_aplicar then
      perform public.guardar_contenido(jsonb_build_object(
        'saber_id', v_sid, 'texto', v_cont, 'nota', v_nota));
    end if;
    n_cont_nuevo := n_cont_nuevo + 1;
    if jsonb_array_length(ejemplos) < 12 then
      ejemplos := ejemplos || jsonb_build_object('fila', v_fila, 'que', 'contenido nuevo',
        'antes', null, 'despues', left(v_cont, 120));
    end if;
  end loop;

  -- Todo o nada: con una sola fila mal, no se aplica ninguna
  if p_aplicar and jsonb_array_length(errores) > 0 then
    raise exception 'El archivo tiene % % con problemas. No se aplicó ningún cambio.',
      jsonb_array_length(errores),
      case when jsonb_array_length(errores) = 1 then 'fila' else 'filas' end
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'aplicado',               p_aplicar,
    'filas',                  n_filas,
    'saberes_nuevos',         n_saber_nuevo,
    'saberes_editados',       n_saber_editado,
    'saberes_archivados',     n_saber_archivado,
    'saberes_restaurados',    n_saber_restaurado,
    'contenidos_nuevos',      n_cont_nuevo,
    'contenidos_editados',    n_cont_editado,
    'contenidos_archivados',  n_cont_archivado,
    'contenidos_restaurados', n_cont_restaurado,
    'sin_cambios',            n_sin_cambios,
    'errores',                errores,
    'ejemplos',               ejemplos);
end;
$$;

revoke execute on function public.importar_catalogo(jsonb, boolean, text) from public, anon;
grant  execute on function public.importar_catalogo(jsonb, boolean, text) to authenticated;


-- ----------------------------------------------------------------------------
-- El catálogo en filas, que es la forma que tiene el Excel
--
-- Una fila por contenido; los saberes sin contenidos traen una fila igual. Es
-- lo que baja el botón «Exportar» y lo mismo que espera «Importar»: el archivo
-- que el equipo corrige se puede volver a subir tal cual.
--
-- A diferencia de exportar_catalogo(), acá vienen también los archivados, con
-- su estado en una columna. Si no estuvieran, no habría forma de restaurar uno
-- desde el Excel.
-- ----------------------------------------------------------------------------

create or replace function public.catalogo_filas(
  p_espacio_id text     default null,
  p_anio       smallint default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.es_equipo() then
    jsonb_build_object('error', 'Tu usuario no está en el equipo de Planificación.')
  else
    coalesce((
      select jsonb_agg(fila order by espacio_orden, anio_orden, trimestre, saber_orden, saber_id_orden, contenido_id)
        from (
          select ec.orden as espacio_orden, coalesce(s.anio, 0) as anio_orden, s.trimestre,
                 s.orden as saber_orden, s.id as saber_id_orden,
                 c.id as contenido_id,
                 jsonb_build_object(
                   'materia',            ec.nombre,
                   'eje_id',             e.id,
                   'eje',                e.nombre,
                   'eje_orden',          e.orden,
                   'saber_id',           s.id,
                   'anio',               s.anio,
                   'trimestre',          s.trimestre,
                   'saber',              s.texto,
                   'saber_estado',       s.estado,
                   'contenido_id',       c.id,
                   'contenido',          c.texto,
                   'contenido_estado',   c.estado) as fila
            from public.saberes s
            join public.ejes e  on e.id = s.eje_id
            join public.espacios_curriculares ec on ec.id = e.espacio_id
            left join public.contenidos_sugeridos c on c.saber_id = s.id
           where (p_espacio_id is null or ec.id = p_espacio_id)
             and (p_anio is null or s.anio is null or s.anio = p_anio)
        ) t), '[]'::jsonb)
  end;
$$;

revoke execute on function public.catalogo_filas(text, smallint) from public, anon;
grant  execute on function public.catalogo_filas(text, smallint) to authenticated;
