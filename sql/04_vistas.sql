-- ============================================================================
-- 04_vistas.sql — Lecturas para el dashboard y la exportación
--
-- Todas las vistas son security_invoker: respetan el RLS de quien consulta.
-- Solo el equipo (authenticated + equipo_planificacion) ve filas.
--
-- Se puede correr más de una vez.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- v_aportes: un envío por fila, con los nombres ya resueltos
-- ----------------------------------------------------------------------------

create or replace view public.v_aportes
with (security_invoker = true) as
select a.id               as aporte_id,
       a.enviado_en,
       a.es_ejemplo,
       d.id               as docente_id,
       d.apellido,
       d.nombre,
       dep.id             as departamento_id,
       dep.nombre         as departamento,
       e.id               as escuela_id,
       e.nombre           as escuela,
       e.localidad,
       e.origen           as escuela_origen,
       ar.id              as area_id,
       ar.nombre          as area,
       ec.id              as espacio_id,
       ec.nombre          as espacio,
       a.anio
  from public.aportes a
  join public.docentes d               on d.id = a.docente_id
  join public.escuelas e               on e.id = a.escuela_id
  join public.departamentos dep        on dep.id = e.departamento_id
  join public.espacios_curriculares ec on ec.id = a.espacio_id
  join public.areas ar                 on ar.id = ec.area_id;


-- ----------------------------------------------------------------------------
-- v_respuestas_por_saber: qué respondió cada aporte sobre cada saber
--   estado = 'trabaja' (eligió al menos un contenido) | 'no_trabaja'
-- Un saber que el docente no informó no aparece.
-- ----------------------------------------------------------------------------

create or replace view public.v_respuestas_por_saber
with (security_invoker = true) as
select r.aporte_id,
       r.saber_id,
       r.estado,
       r.contenidos,
       a.es_ejemplo,
       a.escuela_id,
       e.departamento_id,
       a.espacio_id,
       a.anio,
       s.trimestre,
       s.eje_id
  from (
        select s.aporte_id, s.saber_id, 'trabaja'::text as estado, count(*)::integer as contenidos
          from public.selecciones s
         group by s.aporte_id, s.saber_id
        union all
        select n.aporte_id, n.saber_id, 'no_trabaja', 0
          from public.saberes_no_trabajados n
       ) r
  join public.aportes a  on a.id = r.aporte_id
  join public.escuelas e on e.id = a.escuela_id
  join public.saberes s  on s.id = r.saber_id;


-- ----------------------------------------------------------------------------
-- v_relevamiento: todo el relevamiento en una tabla plana, para "Exportar
-- todo el relevamiento provincial". Una fila por contenido elegido, más una
-- fila por cada "no trabajo este saber" (con contenido vacío).
-- ----------------------------------------------------------------------------

create or replace view public.v_relevamiento
with (security_invoker = true) as
select va.aporte_id,
       va.enviado_en,
       va.es_ejemplo,
       va.departamento,
       va.escuela,
       va.localidad,
       va.apellido,
       va.nombre,
       va.area,
       va.espacio,
       va.anio,
       s.trimestre,
       ej.orden    as eje_orden,
       ej.nombre   as eje,
       s.orden     as saber_orden,
       s.id        as saber_id,
       s.texto     as saber,
       x.estado,
       x.tipo,
       x.contenido_sugerido_id,
       x.contenido,
       x.orden     as contenido_orden
  from (
        select se.aporte_id, se.saber_id, 'trabaja'::text as estado, se.tipo,
               se.contenido_sugerido_id, se.texto as contenido, se.orden
          from public.selecciones se
        union all
        select n.aporte_id, n.saber_id, 'no_trabaja', null, null, null, null
          from public.saberes_no_trabajados n
       ) x
  join public.v_aportes va on va.aporte_id = x.aporte_id
  join public.saberes s    on s.id = x.saber_id
  join public.ejes ej      on ej.id = s.eje_id;


revoke all on public.v_aportes, public.v_respuestas_por_saber, public.v_relevamiento from anon;
grant select on public.v_aportes, public.v_respuestas_por_saber, public.v_relevamiento to authenticated;


-- ----------------------------------------------------------------------------
-- panel_resultados(...) — el cuerpo del dashboard en una sola llamada
--
--   supabase.rpc('panel_resultados', {
--     p_espacio_id: 'matematica', p_anio: 2,
--     p_trimestre: null,            -- null = los tres
--     p_departamento_id: null,      -- alcance: null = toda la provincia
--     p_escuela_id: null,
--     p_ejemplo: false              -- true = solo datos de ejemplo
--   })
--
-- Devuelve:
-- {
--   contexto: { docentes, escuelas, respuestas },   "Basado en 147 docentes de 62 escuelas."
--   saberes: [{
--     id, eje, eje_orden, orden, texto, anio, trimestre, calidad,
--     informan,       cuántos respondieron algo sobre este saber
--     trabajan,       cuántos eligieron al menos un contenido  ← denominador de los %
--     no_trabajan,    cuántos marcaron "no trabajo este saber"
--     contenidos: [{ texto, tipo, contenido_sugerido_id, docentes, porcentaje }]
--                     todos, de más a menos elegido; el front muestra 3 y "ver los demás"
--   }]
-- }
-- Incluye los saberes sin respuestas (para ver qué no está trabajando nadie),
-- salvo los de calidad 'mala', que el formulario no muestra.
-- Lo de "muestra insuficiente" lo decide el front mirando "trabajan".
-- ----------------------------------------------------------------------------

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
    select s.id, s.texto, s.anio, s.trimestre, s.calidad, s.orden,
           ej.nombre as eje, ej.orden as eje_orden
      from public.saberes s
      join public.ejes ej on ej.id = s.eje_id
     where ej.espacio_id = p_espacio_id
       and (s.anio is null or s.anio = p_anio)
       and (p_trimestre is null or s.trimestre = p_trimestre)
       and s.calidad <> 'mala'      -- el docente no los ve: no tienen respuestas
  ),
  sel as (
    select se.aporte_id, se.saber_id, se.tipo, se.contenido_sugerido_id,
           se.texto, se.texto_normalizado
      from public.selecciones se
      join ap on ap.id = se.aporte_id
     where se.saber_id in (select id from sab)
  ),
  trabajan as (
    select saber_id, count(distinct aporte_id) as n
      from sel group by saber_id
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
                 'informan',    coalesce(t.n, 0) + coalesce(nt.n, 0),
                 'trabajan',    coalesce(t.n, 0),
                 'no_trabajan', coalesce(nt.n, 0),
                 'contenidos',  coalesce(c.lista, '[]'::jsonb)
               )
               order by s.trimestre, s.orden, s.id
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
