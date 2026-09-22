-- ============================================================================
-- 02_rls.sql — Seguridad
--
-- La clave pública (anon) está en el JavaScript del sitio: hay que asumir que
-- cualquiera la tiene. Por eso:
--   1. RLS activado en todas las tablas.
--   2. El rol anon no puede escribir en ninguna tabla. Solo puede leer las
--      escuelas oficiales y ejecutar registrar_aporte() (ver 03_funciones.sql).
--   3. El dashboard lee con el rol authenticated, y solo si el usuario está
--      en equipo_planificacion.
--
-- Se puede correr más de una vez.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- ¿El usuario logueado es del equipo de Planificación?
-- security definer: lee equipo_planificacion sin pasar por su propio RLS.
-- ----------------------------------------------------------------------------

create or replace function public.es_equipo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.equipo_planificacion
    where usuario_id = (select auth.uid())
  );
$$;

revoke execute on function public.es_equipo() from public, anon;
grant  execute on function public.es_equipo() to authenticated;


-- ----------------------------------------------------------------------------
-- RLS en todas las tablas
-- ----------------------------------------------------------------------------

alter table public.areas                  enable row level security;
alter table public.espacios_curriculares  enable row level security;
alter table public.ejes                   enable row level security;
alter table public.saberes                enable row level security;
alter table public.contenidos_sugeridos   enable row level security;
alter table public.departamentos          enable row level security;
alter table public.escuelas               enable row level security;
alter table public.docentes               enable row level security;
alter table public.aportes                enable row level security;
alter table public.selecciones            enable row level security;
alter table public.saberes_no_trabajados  enable row level security;
alter table public.grupos_texto_libre     enable row level security;
alter table public.equipo_planificacion   enable row level security;


-- ----------------------------------------------------------------------------
-- Permisos de base: nadie de afuera toca nada. Después se abre lo justo.
-- (Supabase da permisos amplios por defecto a anon y authenticated.)
-- ----------------------------------------------------------------------------

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;


-- ----------------------------------------------------------------------------
-- anon: solo lee las escuelas oficiales (el buscador)
-- ----------------------------------------------------------------------------

grant select on public.escuelas to anon;

drop policy if exists "anon lee escuelas oficiales" on public.escuelas;
create policy "anon lee escuelas oficiales"
  on public.escuelas for select to anon
  using (origen = 'oficial');


-- ----------------------------------------------------------------------------
-- authenticated: el equipo lee todo
-- ----------------------------------------------------------------------------

grant select on all tables in schema public to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'areas', 'espacios_curriculares', 'ejes', 'saberes', 'contenidos_sugeridos',
    'departamentos', 'escuelas', 'docentes', 'aportes', 'selecciones',
    'saberes_no_trabajados', 'grupos_texto_libre', 'equipo_planificacion'
  ]
  loop
    execute format('drop policy if exists "equipo lee" on public.%I', t);
    execute format(
      'create policy "equipo lee" on public.%I for select to authenticated using ((select public.es_equipo()))',
      t
    );
  end loop;
end
$$;

-- Cada usuario puede ver su propia fila de equipo (para saber si tiene acceso).
drop policy if exists "usuario ve su fila" on public.equipo_planificacion;
create policy "usuario ve su fila"
  on public.equipo_planificacion for select to authenticated
  using (usuario_id = (select auth.uid()));


-- ----------------------------------------------------------------------------
-- authenticated: el equipo revisa los grupos de textos libres
-- ----------------------------------------------------------------------------

grant update (texto_representativo, contenido_sugerido_id, estado, revisado_por, revisado_en)
  on public.grupos_texto_libre to authenticated;

drop policy if exists "equipo revisa grupos" on public.grupos_texto_libre;
create policy "equipo revisa grupos"
  on public.grupos_texto_libre for update to authenticated
  using ((select public.es_equipo()))
  with check ((select public.es_equipo()));
