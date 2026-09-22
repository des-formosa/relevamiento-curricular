-- ============================================================================
-- 05_datos_ejemplo.sql — Datos de ejemplo para la presentación
--
-- El 26 se abre la carga y el mismo día se presenta el dashboard: va a estar
-- vacío. Estas funciones inventan respuestas verosímiles, marcadas con
-- aportes.es_ejemplo = true, para mostrarlo. El dashboard las ve solo si pide
-- p_ejemplo = true; los datos reales nunca se mezclan con estos.
--
--   select public.generar_datos_ejemplo();        -- borra los anteriores y crea nuevos
--   select public.generar_datos_ejemplo(2000);    -- con más docentes
--   select public.borrar_datos_ejemplo();         -- cuando ya no hagan falta
--
-- Solo se corren desde el SQL Editor. Nadie desde la web puede ejecutarlas.
-- Requieren que el catálogo y las escuelas ya estén cargados.
-- ============================================================================


create or replace function public.borrar_datos_ejemplo()
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_n integer;
begin
  -- Los docentes de ejemplo solo tienen aportes de ejemplo: al borrarlos, se
  -- borran en cascada sus aportes, selecciones y "no trabajo".
  delete from public.docentes d
   where exists (select 1 from public.aportes a where a.docente_id = d.id and a.es_ejemplo);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;


create or replace function public.generar_datos_ejemplo(
  p_docentes integer          default 1500,
  p_semilla  double precision default 0.26
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_nombres   text[] := array[
    'María', 'Laura', 'Silvia', 'Claudia', 'Mariela', 'Andrea', 'Carolina', 'Gabriela',
    'Natalia', 'Verónica', 'Romina', 'Lorena', 'Lucía', 'Soledad', 'Noelia', 'Mirta',
    'Carlos', 'Jorge', 'Marcelo', 'Diego', 'Sergio', 'Pablo', 'Walter', 'Ramón',
    'Hugo', 'Fabián', 'Gustavo', 'Daniel', 'Oscar', 'Rubén'];
  v_apellidos text[] := array[
    'González', 'Benítez', 'Fernández', 'López', 'Gómez', 'Villalba', 'Cáceres', 'Ayala',
    'Aquino', 'Báez', 'Duarte', 'Ojeda', 'Romero', 'Sosa', 'Acosta', 'Giménez', 'Ramírez',
    'Martínez', 'Rodríguez', 'Pérez', 'Díaz', 'Ortiz', 'Ríos', 'Vera', 'Franco', 'Insfrán',
    'Galeano', 'Espínola', 'Morínigo', 'Candia'];
  -- Contenidos "escritos a mano" verosímiles para cualquier materia, con
  -- variantes de escritura para que se note el agrupamiento por texto normalizado.
  v_libres    text[] := array[
    'Trabajo por proyectos con otras áreas',
    'Trabajo por proyectos con otras areas.',
    'Salida educativa al entorno local',
    'Uso de videos y recursos TIC',
    'Análisis de casos de la comunidad',
    'Lectura y comentario de textos',
    'Resolución de situaciones problemáticas',
    'Exposiciones orales de los estudiantes',
    'Producción de afiches y maquetas',
    'Debate en clase',
    'debate en clase'];
  v_aportes     integer;
  v_selecciones integer;
  v_no          integer;
begin
  if not exists (select 1 from public.saberes) or not exists (select 1 from public.escuelas where origen = 'oficial') then
    raise exception 'Primero hay que cargar el catálogo y las escuelas.';
  end if;

  perform public.borrar_datos_ejemplo();
  perform setseed(p_semilla);

  -- De qué elige cada saber: sus contenidos sugeridos (tipo 'catalogo'). Si no
  -- tiene, cuatro contenidos de otros saberes de la misma materia, como si los
  -- hubieran escrito los docentes (tipo 'libre').
  create temp table tmp_opciones on commit drop as
  select c.saber_id, c.id as contenido_id, c.texto, 'catalogo'::text as tipo
    from public.contenidos_sugeridos c
  union all
  select s.id, null, x.texto, 'libre'
    from public.saberes s
    join public.ejes ej on ej.id = s.eje_id
    cross join lateral (
      select c.texto
        from public.contenidos_sugeridos c
        join public.saberes s2 on s2.id = c.saber_id
        join public.ejes e2    on e2.id = s2.eje_id
       where e2.espacio_id = ej.espacio_id
       order by random() + length(s.id) * 0
       limit 4
    ) x
   where not exists (select 1 from public.contenidos_sugeridos c where c.saber_id = s.id);

  -- Qué tan elegida es cada opción: en cada saber hay una o dos favoritas
  -- (consenso) y el resto reparte.
  create temp table tmp_peso_opcion on commit drop as
  select o.*,
         case row_number() over (partition by o.saber_id order by random())
           when 1 then 0.55 + 0.35 * random()
           when 2 then 0.25 + 0.30 * random()
           else        0.03 + 0.25 * random()
         end as peso
    from tmp_opciones o;

  -- Qué tanto se deja de dar cada saber: la mayoría se da casi siempre; unos
  -- pocos los da poca gente.
  create temp table tmp_peso_saber on commit drop as
  select s.id,
         case when random() < 0.12 then 0.45 + 0.40 * random()
              else 0.02 + 0.13 * random()
         end as p_no_trabaja
    from public.saberes s;

  -- Docentes
  create temp table tmp_docentes on commit drop as
  with nuevos as (
    insert into public.docentes (nombre, apellido)
    select v_nombres[1 + floor(random() * cardinality(v_nombres))::int],
           v_apellidos[1 + floor(random() * cardinality(v_apellidos))::int]
      from generate_series(1, p_docentes)
    returning id
  )
  select n.id,
         (select e.id from public.escuelas e where e.origen = 'oficial'
           order by random() + n.id * 0 limit 1) as escuela_principal
    from nuevos n;

  -- Aportes: cada docente carga 1 a 3 materias; casi siempre en su escuela.
  insert into public.aportes (docente_id, escuela_id, espacio_id, anio, enviado_en, es_ejemplo)
  select x.docente_id, x.escuela_id, x.espacio_id,
         x.anios[1 + floor(random() * cardinality(x.anios))::int],
         timestamptz '2026-09-26 08:00-03' + random() * interval '4 days',
         true
    from (
      select d.id as docente_id,
             case when random() < 0.8 then d.escuela_principal
                  else (select e.id from public.escuelas e where e.origen = 'oficial'
                         order by random() + g * 0 + d.id * 0 limit 1)
             end as escuela_id,
             ec.id as espacio_id,
             ec.anios_dictados as anios
        from tmp_docentes d
        cross join lateral generate_series(1, 1 + floor(random() * 2.4 + d.id * 0)::int) as g
        cross join lateral (
          select ec.id, ec.anios_dictados from public.espacios_curriculares ec
           order by random() + g * 0 + d.id * 0 limit 1
        ) ec
    ) x
  on conflict (docente_id, escuela_id, espacio_id, anio) do nothing;
  get diagnostics v_aportes = row_count;

  -- Saberes que vio cada aporte (los mismos que muestra el formulario:
  -- de esa materia, de ese año o de todo el ciclo, y sin los de calidad 'mala').
  create temp table tmp_aporte_saber on commit drop as
  select a.id as aporte_id, s.id as saber_id,
         random() < ps.p_no_trabaja as no_trabaja
    from public.aportes a
    join public.ejes ej    on ej.espacio_id = a.espacio_id
    join public.saberes s  on s.eje_id = ej.id
                          and (s.anio is null or s.anio = a.anio)
                          and s.calidad <> 'mala'
    join tmp_peso_saber ps on ps.id = s.id
   where a.es_ejemplo;

  insert into public.saberes_no_trabajados (aporte_id, saber_id)
  select aporte_id, saber_id from tmp_aporte_saber where no_trabaja;
  get diagnostics v_no = row_count;

  -- Opciones elegidas, según su peso. (El "+ t.aporte_id * 0" obliga a sortear
  -- de nuevo en cada aporte: sin eso Postgres sortea una sola vez por opción.)
  create temp table tmp_elegidos on commit drop as
  select t.aporte_id, o.saber_id, o.contenido_id, o.texto, o.tipo
    from tmp_aporte_saber t
    join tmp_peso_opcion o on o.saber_id = t.saber_id
   where not t.no_trabaja
     and random() + t.aporte_id * 0 < o.peso;

  -- Si a un saber trabajado no le tocó ninguna, se le da la favorita.
  insert into tmp_elegidos (aporte_id, saber_id, contenido_id, texto, tipo)
  select t.aporte_id, f.saber_id, f.contenido_id, f.texto, f.tipo
    from tmp_aporte_saber t
    join lateral (
      select o.* from tmp_peso_opcion o
       where o.saber_id = t.saber_id
       order by o.peso desc
       limit 1
    ) f on true
   where not t.no_trabaja
     and not exists (select 1 from tmp_elegidos e
                      where e.aporte_id = t.aporte_id and e.saber_id = t.saber_id);

  -- De vez en cuando, además, algo escrito a mano de uso general.
  insert into tmp_elegidos (aporte_id, saber_id, contenido_id, texto, tipo)
  select t.aporte_id, t.saber_id, null,
         v_libres[1 + floor(random() * cardinality(v_libres) + t.aporte_id * 0)::int], 'libre'
    from tmp_aporte_saber t
   where not t.no_trabaja
     and random() + t.aporte_id * 0 < 0.05;

  insert into public.selecciones
    (aporte_id, saber_id, tipo, contenido_sugerido_id, texto, texto_normalizado, orden)
  select e.aporte_id, e.saber_id, e.tipo, e.contenido_id, e.texto, public.normalizar_texto(e.texto),
         row_number() over (partition by e.aporte_id, e.saber_id order by random())
    from tmp_elegidos e
  on conflict (aporte_id, saber_id, texto_normalizado) do nothing;
  get diagnostics v_selecciones = row_count;

  select count(*) into v_aportes from public.aportes where es_ejemplo;

  return jsonb_build_object(
    'docentes',              p_docentes,
    'aportes',               v_aportes,
    'selecciones',           v_selecciones,
    'saberes_no_trabajados', v_no
  );
end;
$$;

revoke execute on function public.borrar_datos_ejemplo()                            from public, anon, authenticated;
revoke execute on function public.generar_datos_ejemplo(integer, double precision) from public, anon, authenticated;
