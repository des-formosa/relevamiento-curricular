-- ============================================================================
-- Lengua y Matemática: quedan solo los saberes priorizados
--
-- Se corre UNA VEZ en el SQL Editor. Se puede repetir sin problema: la segunda
-- vez no encuentra nada que archivar.
--
-- El 23/09/2026 Lengua y Matemática se rehicieron con los saberes priorizados
-- (los que tienen «--pr-» en el id). Todo lo demás de esas dos materias —los
-- saberes de la Resolución y los que haya sumado el importador por duplicado—
-- se ARCHIVA: deja de ofrecerse y de contarse en el panel, pero no se borra.
-- Conserva sus respuestas y se puede recuperar.
--
-- Va todo en un solo bloque para que la nota llegue al historial de cambios.
-- ============================================================================

do $$
declare
  v_saberes    integer;
  v_contenidos integer;
begin
  perform set_config('app.nota_cambio',
    'Lengua y Matemática: quedan solo los saberes priorizados', true);

  update public.saberes s
     set estado = 'archivado'
    from public.ejes e
   where e.id = s.eje_id
     and e.espacio_id in ('lengua', 'matematica')
     and s.id not like '%--pr-%'
     and s.estado = 'activo';
  get diagnostics v_saberes = row_count;

  -- Sus contenidos también: no tiene sentido que queden sueltos y activos
  update public.contenidos_sugeridos c
     set estado = 'archivado'
    from public.saberes s
    join public.ejes e on e.id = s.eje_id
   where s.id = c.saber_id
     and e.espacio_id in ('lengua', 'matematica')
     and s.estado = 'archivado'
     and c.estado = 'activo';
  get diagnostics v_contenidos = row_count;

  raise notice 'Se archivaron ahora % saberes y % contenidos.', v_saberes, v_contenidos;
end $$;


-- Cómo quedó. Tiene que dar: Lengua 132 activos, Matemática 52 activos, y en
-- las dos, todos los activos priorizados.
select e.espacio_id                                                            as materia,
       count(*) filter (where s.estado = 'activo')                             as activos,
       count(*) filter (where s.estado = 'activo' and s.id like '%--pr-%')     as activos_priorizados,
       count(*) filter (where s.estado = 'archivado')                          as archivados
  from public.saberes s
  join public.ejes e on e.id = s.eje_id
 where e.espacio_id in ('lengua', 'matematica')
 group by e.espacio_id
 order by e.espacio_id;
