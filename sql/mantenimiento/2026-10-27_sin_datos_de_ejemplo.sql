-- ============================================================================
-- Sin datos de ejemplo
--
-- Se corre UNA VEZ en el SQL Editor. Se puede repetir sin problema: la segunda
-- vez no encuentra nada que borrar.
--
-- Los datos de ejemplo (aportes.es_ejemplo = true) se inventaron para mostrar
-- el panel en la presentación del 26/09, antes de que llegaran cargas. Con la
-- carga real avanzada ya no tienen sentido, y el panel dejó de ofrecerlos el
-- 27/10/2026. Esto borra los docentes inventados (y en cascada sus aportes,
-- selecciones y «no trabajo») y las dos funciones que los generaban, que
-- estaban en sql/05_datos_ejemplo.sql (sacado de la instalación ese día).
--
-- Un docente real nunca tiene aportes de ejemplo: el formulario no pone
-- es_ejemplo. Igual, por las dudas, solo se borra el docente cuyos aportes son
-- todos de ejemplo.
--
-- La columna aportes.es_ejemplo queda (siempre en false): la usan las vistas,
-- panel_resultados() y los filtros del panel, y sacarla no gana nada.
-- ============================================================================

do $$
declare
  v_docentes integer;
  v_aportes  integer;
begin
  delete from public.docentes d
   where exists (select 1 from public.aportes a where a.docente_id = d.id and a.es_ejemplo)
     and not exists (select 1 from public.aportes a where a.docente_id = d.id and not a.es_ejemplo);
  get diagnostics v_docentes = row_count;

  -- Si quedara algún aporte de ejemplo suelto (de un docente que también tiene
  -- reales, cosa que no debería pasar), se borra solo el aporte
  delete from public.aportes where es_ejemplo;
  get diagnostics v_aportes = row_count;

  raise notice 'Borrados: % docentes de ejemplo (con sus aportes) y % aportes de ejemplo sueltos.', v_docentes, v_aportes;
end $$;

drop function if exists public.generar_datos_ejemplo(integer, double precision);
drop function if exists public.borrar_datos_ejemplo();

-- Tiene que dar cero
select count(*) as aportes_de_ejemplo_que_quedan from public.aportes where es_ejemplo;
