-- ============================================================================
-- 09_edicion_catalogo.sql — Editar el catálogo desde el dashboard, con auditoría
--
-- Hasta acá el catálogo se cargaba desde datos/catalogo.json y nadie lo tocaba
-- desde la web. El equipo de Planificación necesita corregir un saber mal
-- transcripto, agregar un contenido que falta o sacar uno que no va, sin
-- esperar a que alguien edite el repositorio.
--
-- Dos decisiones que ordenan todo esto:
--
-- 1. NADA SE BORRA: se archiva. Un docente que abrió el formulario tiene el
--    catálogo descargado en su navegador. Si el equipo borra un contenido
--    mientras esa persona está cargando, su envío fallaría al confirmar. Un
--    contenido archivado sigue existiendo en la base —el envío entra igual—
--    pero sale del catálogo que se publica y deja de ofrecerse.
--
-- 2. TODO QUEDA REGISTRADO. Un trigger anota cada alta, edición y archivado
--    con el texto anterior, el nuevo, quién lo hizo y cuándo. No depende de
--    que el dashboard se acuerde de registrarlo: si alguien edita desde el
--    SQL Editor, también queda.
--
-- El formulario del docente no cambia: sigue leyendo datos/catalogo.json. Para
-- publicar lo editado se usa exportar_catalogo(), que devuelve el JSON listo
-- para reemplazar ese archivo en el repositorio.
--
-- Se puede correr más de una vez.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Estado: activo o archivado
-- ----------------------------------------------------------------------------

alter table public.saberes
  add column if not exists estado text not null default 'activo';
alter table public.contenidos_sugeridos
  add column if not exists estado text not null default 'activo';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'saberes_estado_check') then
    alter table public.saberes
      add constraint saberes_estado_check check (estado in ('activo', 'archivado'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contenidos_estado_check') then
    alter table public.contenidos_sugeridos
      add constraint contenidos_estado_check check (estado in ('activo', 'archivado'));
  end if;
end $$;

create index if not exists ix_saberes_estado     on public.saberes (estado);
create index if not exists ix_contenidos_estado  on public.contenidos_sugeridos (estado);


-- ----------------------------------------------------------------------------
-- 2. Auditoría
--
-- Una fila por cambio. "antes" y "despues" guardan la fila entera, así que se
-- puede reconstruir qué decía exactamente un saber antes de una corrección.
-- ----------------------------------------------------------------------------

create table if not exists public.catalogo_auditoria (
  id             bigserial primary key,
  momento        timestamptz not null default now(),
  usuario_id     uuid,
  usuario_email  text,
  tabla          text not null,
  registro_id    text not null,
  accion         text not null check (accion in ('alta', 'edicion', 'archivado', 'restaurado', 'baja')),
  antes          jsonb,
  despues        jsonb,
  nota           text
);

create index if not exists ix_auditoria_momento  on public.catalogo_auditoria (momento desc);
create index if not exists ix_auditoria_registro on public.catalogo_auditoria (tabla, registro_id);

alter table public.catalogo_auditoria enable row level security;

drop policy if exists "equipo lee auditoria" on public.catalogo_auditoria;
create policy "equipo lee auditoria"
  on public.catalogo_auditoria for select to authenticated
  using ((select public.es_equipo()));

revoke all on public.catalogo_auditoria from anon, authenticated;
grant select on public.catalogo_auditoria to authenticated;


-- ----------------------------------------------------------------------------
-- auditar_catalogo() — el trigger que registra los cambios
--
-- Las cargas masivas (cargar_catalogo, cargar_contenidos) marcan la sesión con
-- app.carga_masiva = 'on' para no llenar la auditoría con miles de filas por
-- una carga del JSON. Esas cargas ya quedan registradas en el repositorio.
-- ----------------------------------------------------------------------------

create or replace function public.auditar_catalogo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_accion text;
  v_email  text;
begin
  if coalesce(current_setting('app.carga_masiva', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    v_accion := 'alta';
  elsif tg_op = 'DELETE' then
    v_accion := 'baja';
  elsif old.estado is distinct from new.estado then
    v_accion := case when new.estado = 'archivado' then 'archivado' else 'restaurado' end;
  else
    if to_jsonb(old) = to_jsonb(new) then
      return new;                      -- update que no cambió nada
    end if;
    v_accion := 'edicion';
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();

  insert into public.catalogo_auditoria
    (usuario_id, usuario_email, tabla, registro_id, accion, antes, despues, nota)
  values (
    auth.uid(),
    v_email,
    tg_table_name,
    coalesce(new.id, old.id),
    v_accion,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    nullif(current_setting('app.nota_cambio', true), '')
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists tr_auditar_saberes on public.saberes;
create trigger tr_auditar_saberes
  after insert or update or delete on public.saberes
  for each row execute function public.auditar_catalogo();

drop trigger if exists tr_auditar_contenidos on public.contenidos_sugeridos;
create trigger tr_auditar_contenidos
  after insert or update or delete on public.contenidos_sugeridos
  for each row execute function public.auditar_catalogo();


-- ----------------------------------------------------------------------------
-- 3. Lectura para la pantalla de edición
--
-- catalogo_editar(espacio, anio) devuelve los saberes de esa materia y año
-- —incluidos los archivados— con sus contenidos y con cuántas respuestas tiene
-- cada uno. Eso último es lo que le permite al dashboard avisar antes de
-- archivar: "18 docentes ya eligieron este contenido".
-- ----------------------------------------------------------------------------

create or replace function public.catalogo_editar(
  p_espacio_id text,
  p_anio       smallint default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with permiso as (select public.es_equipo() as ok),
  sab as (
    select s.*, ej.nombre as eje, ej.orden as eje_orden
      from public.saberes s
      join public.ejes ej on ej.id = s.eje_id
     where ej.espacio_id = p_espacio_id
       and (p_anio is null or s.anio is null or s.anio = p_anio)
       and (select ok from permiso)
  ),
  respuestas_saber as (
    select x.saber_id, count(*)::integer as n
      from (
        select saber_id from public.selecciones
        union all
        select saber_id from public.saberes_no_trabajados
      ) x
     where x.saber_id in (select id from sab)
     group by x.saber_id
  ),
  respuestas_contenido as (
    select se.contenido_sugerido_id as id, count(*)::integer as n
      from public.selecciones se
     where se.contenido_sugerido_id is not null
     group by se.contenido_sugerido_id
  ),
  contenidos as (
    select c.saber_id,
           jsonb_agg(
             jsonb_build_object(
               'id', c.id, 'texto', c.texto, 'origen', c.origen,
               'estado', c.estado, 'respuestas', coalesce(rc.n, 0))
             order by c.estado, c.id
           ) as lista
      from public.contenidos_sugeridos c
      left join respuestas_contenido rc on rc.id = c.id
     where c.saber_id in (select id from sab)
     group by c.saber_id
  )
  select case when not (select ok from permiso) then
           jsonb_build_object('error', 'Tu usuario no está en el equipo de Planificación.')
         else
           jsonb_build_object(
             'espacio_id', p_espacio_id,
             'anio', p_anio,
             'saberes', coalesce((
               select jsonb_agg(
                        jsonb_build_object(
                          'id', s.id, 'eje_id', s.eje_id, 'eje', s.eje, 'eje_orden', s.eje_orden,
                          'anio', s.anio, 'trimestre', s.trimestre, 'texto', s.texto,
                          'calidad', s.calidad, 'orden', s.orden, 'estado', s.estado,
                          'respuestas', coalesce(rs.n, 0),
                          'contenidos', coalesce(c.lista, '[]'::jsonb))
                        order by s.eje_orden, s.orden)
                 from sab s
                 left join respuestas_saber rs on rs.saber_id = s.id
                 left join contenidos c        on c.saber_id = s.id
             ), '[]'::jsonb))
         end;
$$;

revoke execute on function public.catalogo_editar(text, smallint) from public, anon;
grant  execute on function public.catalogo_editar(text, smallint) to authenticated;


-- ----------------------------------------------------------------------------
-- 4. Escritura
--
-- Una sola puerta por tipo de registro, igual que registrar_aporte para el
-- formulario: el dashboard no escribe en las tablas, llama a estas funciones.
-- Todas verifican que quien llama esté en equipo_planificacion.
-- ----------------------------------------------------------------------------

-- Deja anotada la razón del cambio para que el trigger la guarde
create or replace function public.anotar_cambio(p_nota text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select set_config('app.nota_cambio', coalesce(left(p_nota, 500), ''), true);
$$;

revoke execute on function public.anotar_cambio(text) from public, anon;
grant  execute on function public.anotar_cambio(text) to authenticated;


-- guardar_saber(payload): alta si no viene id, edición si viene.
--   { id?, eje_id, anio, trimestre, texto, calidad?, orden?, nota? }
create or replace function public.guardar_saber(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id        text := nullif(payload ->> 'id', '');
  v_eje_id    text := payload ->> 'eje_id';
  v_texto     text := regexp_replace(btrim(coalesce(payload ->> 'texto', '')), '\s+', ' ', 'g');
  v_anio      smallint;
  v_trimestre smallint;
  v_calidad   text := coalesce(nullif(payload ->> 'calidad', ''), 'buena');
  v_orden     smallint;
  v_espacio   text;
  v_por_ciclo boolean;
  v_n         integer;
begin
  if not public.es_equipo() then
    raise exception 'Tu usuario no está en el equipo de Planificación.' using errcode = '42501';
  end if;
  if char_length(v_texto) < 10 then
    raise exception 'El texto del saber es demasiado corto.' using errcode = '22023';
  end if;
  if char_length(v_texto) > 1500 then
    raise exception 'El texto del saber supera los 1500 caracteres.' using errcode = '22023';
  end if;

  perform public.anotar_cambio(payload ->> 'nota');

  -- El eje manda: de él salen la materia y si la materia diferencia por año
  select ec.id, ec.saberes_por_ciclo into v_espacio, v_por_ciclo
    from public.ejes e
    join public.espacios_curriculares ec on ec.id = e.espacio_id
   where e.id = v_eje_id;
  if v_espacio is null then
    raise exception 'El eje indicado no existe.' using errcode = '22023';
  end if;

  v_anio := case when v_por_ciclo then null else (payload ->> 'anio')::smallint end;
  if not v_por_ciclo and (v_anio is null or v_anio not between 1 and 3) then
    raise exception 'Elegí el año del saber (1, 2 o 3).' using errcode = '22023';
  end if;

  v_trimestre := (payload ->> 'trimestre')::smallint;
  if v_trimestre is null or v_trimestre not between 1 and 3 then
    raise exception 'Elegí el trimestre del saber (1, 2 o 3).' using errcode = '22023';
  end if;
  if v_calidad not in ('buena', 'revisar', 'mala') then
    raise exception 'La calidad tiene que ser buena, revisar o mala.' using errcode = '22023';
  end if;

  if v_id is null then
    -- Alta: id estable, con el mismo patrón que el catálogo original
    select coalesce(max(substring(s.id from '--n([0-9]+)$')::integer), 0) + 1
      into v_n
      from public.saberes s
     where s.eje_id = v_eje_id and s.id like v_eje_id || '--n%';
    v_id := v_eje_id || '--n' || v_n;

    select coalesce(max(s.orden), 0) + 1 into v_orden
      from public.saberes s where s.eje_id = v_eje_id;
    v_orden := coalesce((payload ->> 'orden')::smallint, v_orden);

    insert into public.saberes (id, eje_id, anio, trimestre, texto, calidad, orden, estado)
    values (v_id, v_eje_id, v_anio, v_trimestre, v_texto, v_calidad, v_orden, 'activo');
  else
    update public.saberes s
       set eje_id    = v_eje_id,
           anio      = v_anio,
           trimestre = v_trimestre,
           texto     = v_texto,
           calidad   = v_calidad,
           orden     = coalesce((payload ->> 'orden')::smallint, s.orden)
     where s.id = v_id;
    if not found then
      raise exception 'El saber que querés editar no existe.' using errcode = '22023';
    end if;
  end if;

  return jsonb_build_object('id', v_id, 'accion', case when payload ->> 'id' is null then 'alta' else 'edicion' end);
end;
$$;

revoke execute on function public.guardar_saber(jsonb) from public, anon;
grant  execute on function public.guardar_saber(jsonb) to authenticated;


-- guardar_contenido(payload): alta si no viene id, edición si viene.
--   { id?, saber_id, texto, nota? }
create or replace function public.guardar_contenido(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id       text := nullif(payload ->> 'id', '');
  v_saber_id text := payload ->> 'saber_id';
  v_texto    text := regexp_replace(btrim(coalesce(payload ->> 'texto', '')), '\s+', ' ', 'g');
  v_norm     text;
  v_n        integer;
  v_choca    text;
begin
  if not public.es_equipo() then
    raise exception 'Tu usuario no está en el equipo de Planificación.' using errcode = '42501';
  end if;

  v_norm := public.normalizar_texto(v_texto);
  if v_norm = '' then
    raise exception 'Escribí el texto del contenido.' using errcode = '22023';
  end if;
  if char_length(v_texto) > 500 then
    raise exception 'El contenido supera los 500 caracteres.' using errcode = '22023';
  end if;

  perform public.anotar_cambio(payload ->> 'nota');

  if v_id is null then
    if not exists (select 1 from public.saberes s where s.id = v_saber_id) then
      raise exception 'El saber indicado no existe.' using errcode = '22023';
    end if;
  else
    select c.saber_id into v_saber_id from public.contenidos_sugeridos c where c.id = v_id;
    if v_saber_id is null then
      raise exception 'El contenido que querés editar no existe.' using errcode = '22023';
    end if;
  end if;

  -- Dos contenidos con el mismo texto en un saber romperían el recuento del panel
  select c.texto into v_choca
    from public.contenidos_sugeridos c
   where c.saber_id = v_saber_id
     and c.texto_normalizado = v_norm
     and (v_id is null or c.id <> v_id)
   limit 1;
  if v_choca is not null then
    raise exception 'Ese saber ya tiene un contenido igual: "%".', v_choca using errcode = '22023';
  end if;

  if v_id is null then
    select coalesce(max(substring(c.id from '--n([0-9]+)$')::integer), 0) + 1
      into v_n
      from public.contenidos_sugeridos c
     where c.saber_id = v_saber_id and c.id like v_saber_id || '--n%';
    v_id := v_saber_id || '--n' || v_n;

    insert into public.contenidos_sugeridos (id, saber_id, texto, texto_normalizado, origen, estado)
    values (v_id, v_saber_id, v_texto, v_norm, 'agregado_equipo', 'activo');
  else
    update public.contenidos_sugeridos c
       set texto = v_texto, texto_normalizado = v_norm
     where c.id = v_id;
  end if;

  return jsonb_build_object('id', v_id, 'saber_id', v_saber_id);
end;
$$;

revoke execute on function public.guardar_contenido(jsonb) from public, anon;
grant  execute on function public.guardar_contenido(jsonb) to authenticated;


-- archivar(tabla, id, archivar, nota): saca de circulación o restaura.
-- No borra: las respuestas que ya existen se conservan y los formularios que
-- están abiertos con el catálogo viejo siguen pudiendo enviar.
create or replace function public.archivar_catalogo(
  p_tabla    text,
  p_id       text,
  p_archivar boolean default true,
  p_nota     text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_estado text := case when p_archivar then 'archivado' else 'activo' end;
  v_n      integer;
begin
  if not public.es_equipo() then
    raise exception 'Tu usuario no está en el equipo de Planificación.' using errcode = '42501';
  end if;
  if p_tabla not in ('saberes', 'contenidos_sugeridos') then
    raise exception 'Solo se pueden archivar saberes o contenidos.' using errcode = '22023';
  end if;

  perform public.anotar_cambio(p_nota);

  if p_tabla = 'saberes' then
    update public.saberes set estado = v_estado where id = p_id;
    get diagnostics v_n = row_count;
    -- Archivar un saber archiva sus contenidos: no tiene sentido ofrecerlos sueltos
    if p_archivar and v_n = 1 then
      update public.contenidos_sugeridos set estado = 'archivado'
       where saber_id = p_id and estado = 'activo';
    end if;
  else
    update public.contenidos_sugeridos set estado = v_estado where id = p_id;
    get diagnostics v_n = row_count;
  end if;

  if v_n = 0 then
    raise exception 'No encontramos ese registro.' using errcode = '22023';
  end if;
  return jsonb_build_object('id', p_id, 'estado', v_estado);
end;
$$;

revoke execute on function public.archivar_catalogo(text, text, boolean, text) from public, anon;
grant  execute on function public.archivar_catalogo(text, text, boolean, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 5. Historial para la pantalla de auditoría
-- ----------------------------------------------------------------------------

create or replace function public.historial_catalogo(
  p_limite      integer default 100,
  p_registro_id text default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.es_equipo() then '[]'::jsonb else
    coalesce((
      select jsonb_agg(x order by x ->> 'momento' desc)
        from (
          select jsonb_build_object(
                   'id', a.id,
                   'momento', a.momento,
                   'usuario', coalesce(a.usuario_email, 'sistema'),
                   'tabla', a.tabla,
                   'registro_id', a.registro_id,
                   'accion', a.accion,
                   'texto_antes', a.antes ->> 'texto',
                   'texto_despues', a.despues ->> 'texto',
                   'nota', a.nota) as x
            from public.catalogo_auditoria a
           where (p_registro_id is null or a.registro_id = p_registro_id)
           order by a.momento desc
           limit greatest(1, least(coalesce(p_limite, 100), 500))
        ) t
    ), '[]'::jsonb)
  end;
$$;

revoke execute on function public.historial_catalogo(integer, text) from public, anon;
grant  execute on function public.historial_catalogo(integer, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 6. Publicar: exportar_catalogo() devuelve el JSON para datos/catalogo.json
--
-- El formulario del docente sigue leyendo ese archivo del repositorio: es lo
-- que permite que diez mil personas entren el mismo día sin tocar la base. Por
-- eso editar no alcanza: hay que publicar. Solo salen los activos.
-- ----------------------------------------------------------------------------

create or replace function public.exportar_catalogo()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.es_equipo() then
    jsonb_build_object('error', 'Tu usuario no está en el equipo de Planificación.')
  else
    jsonb_build_object(
      'version', 4,
      'fuente', 'Resolución 672 — Diseño Curricular del Ciclo Básico, Provincia de Formosa',
      'nota_anio', 'saberes.anio en null significa que el saber vale para todo el Ciclo Básico',
      'exportado_en', to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD"T"HH24:MI:SS'),
      'areas', coalesce((
        select jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.nombre, 'orden', a.orden) order by a.orden)
          from public.areas a), '[]'::jsonb),
      'espacios', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', ec.id, 'nombre', ec.nombre, 'area_id', ec.area_id,
                 'anios_dictados', to_jsonb(ec.anios_dictados),
                 'saberes_por_ciclo', ec.saberes_por_ciclo,
                 'origen', ec.origen, 'orden', ec.orden) order by ec.orden)
          from public.espacios_curriculares ec), '[]'::jsonb),
      'ejes', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', e.id, 'espacio_id', e.espacio_id, 'nombre', e.nombre, 'orden', e.orden)
                 order by e.espacio_id, e.orden)
          from public.ejes e), '[]'::jsonb),
      'saberes', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', s.id, 'eje_id', s.eje_id, 'anio', s.anio, 'trimestre', s.trimestre,
                 'texto', s.texto, 'calidad', s.calidad, 'orden', s.orden)
                 order by s.eje_id, s.orden)
          from public.saberes s where s.estado = 'activo'), '[]'::jsonb),
      'contenidos', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', c.id, 'saber_id', c.saber_id, 'texto', c.texto,
                 'texto_normalizado', c.texto_normalizado, 'origen', c.origen)
                 order by c.saber_id, c.id)
          from public.contenidos_sugeridos c
          join public.saberes s on s.id = c.saber_id
         where c.estado = 'activo' and s.estado = 'activo'), '[]'::jsonb))
  end;
$$;

revoke execute on function public.exportar_catalogo() from public, anon;
grant  execute on function public.exportar_catalogo() to authenticated;


-- ----------------------------------------------------------------------------
-- 7. Ajustes en lo que ya existía
-- ----------------------------------------------------------------------------

-- cargar_catalogo() y cargar_contenidos() (03_funciones.sql) marcan la sesión
-- con app.carga_masiva para no llenar la auditoría, y archivan lo que ya no
-- está en el JSON pero tiene respuestas.

-- panel_resultados: no ofrece los saberes archivados, salvo que ya tengan
-- respuestas (ahí se siguen mostrando, para no perder lo que informaron).
-- Se redefine entera porque hay que tocar el filtro de saberes.
create or replace function public.panel_resultados(
  p_espacio_id      text,
  p_anio            smallint,
  p_trimestre       smallint default null,
  p_departamento_id text     default null,
  p_escuela_id      text     default null,
  p_ejemplo         boolean  default false
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with ap as (
    select a.id, a.docente_id, a.escuela_id
      from public.aportes a
      join public.escuelas e on e.id = a.escuela_id
     where a.espacio_id = p_espacio_id
       and a.anio = p_anio
       and a.es_ejemplo = p_ejemplo
       and (p_departamento_id is null or e.departamento_id = p_departamento_id)
       and (p_escuela_id is null or a.escuela_id = p_escuela_id)
  ),
  sab as (
    select s.id, s.texto, s.anio, s.trimestre, s.calidad, s.orden, s.estado,
           ej.nombre as eje, ej.orden as eje_orden
      from public.saberes s
      join public.ejes ej on ej.id = s.eje_id
     where ej.espacio_id = p_espacio_id
       and (s.anio is null or s.anio = p_anio)
       and (p_trimestre is null or s.trimestre = p_trimestre)
       and s.calidad <> 'mala'
       and (s.estado = 'activo'
            or exists (select 1 from public.selecciones x where x.saber_id = s.id)
            or exists (select 1 from public.saberes_no_trabajados n where n.saber_id = s.id))
  ),
  sel as (
    select se.aporte_id, se.saber_id, se.tipo, se.contenido_sugerido_id,
           se.texto, se.texto_normalizado
      from public.selecciones se
      join ap on ap.id = se.aporte_id
     where se.saber_id in (select id from sab)
  ),
  trabajan as (
    select saber_id, count(distinct aporte_id) as n from sel group by saber_id
  ),
  no_trabajan as (
    select n.saber_id, count(*) as n
      from public.saberes_no_trabajados n
      join ap on ap.id = n.aporte_id
     where n.saber_id in (select id from sab)
     group by n.saber_id
  ),
  conteo as (
    select saber_id,
           texto_normalizado,
           mode() within group (order by texto)  as texto,
           bool_or(tipo = 'catalogo')            as es_catalogo,
           max(contenido_sugerido_id)            as contenido_sugerido_id,
           count(distinct aporte_id)             as n
      from sel
     group by saber_id, texto_normalizado
  ),
  contenidos as (
    select c.saber_id,
           jsonb_agg(
             jsonb_build_object(
               'texto',                 c.texto,
               'tipo',                  case when c.es_catalogo then 'catalogo' else 'libre' end,
               'contenido_sugerido_id', c.contenido_sugerido_id,
               'docentes',              c.n,
               'porcentaje',            round(100.0 * c.n / t.n)
             )
             order by c.n desc, c.es_catalogo desc, c.texto
           ) as lista
      from conteo c
      join trabajan t on t.saber_id = c.saber_id
     group by c.saber_id
  )
  select jsonb_build_object(
    'contexto', (
      select jsonb_build_object(
               'docentes',   count(distinct docente_id),
               'escuelas',   count(distinct escuela_id),
               'respuestas', count(*))
        from ap
    ),
    'saberes', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id',          s.id,
                 'eje',         s.eje,
                 'eje_orden',   s.eje_orden,
                 'orden',       s.orden,
                 'texto',       s.texto,
                 'anio',        s.anio,
                 'trimestre',   s.trimestre,
                 'calidad',     s.calidad,
                 'estado',      s.estado,
                 'informan',    coalesce(t.n, 0) + coalesce(nt.n, 0),
                 'trabajan',    coalesce(t.n, 0),
                 'no_trabajan', coalesce(nt.n, 0),
                 'contenidos',  coalesce(c.lista, '[]'::jsonb)
               )
               order by s.eje_orden, s.orden
             )
        from sab s
        left join trabajan t     on t.saber_id = s.id
        left join no_trabajan nt on nt.saber_id = s.id
        left join contenidos c   on c.saber_id = s.id
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.panel_resultados(text, smallint, smallint, text, text, boolean) from public, anon;
grant  execute on function public.panel_resultados(text, smallint, smallint, text, text, boolean) to authenticated;
