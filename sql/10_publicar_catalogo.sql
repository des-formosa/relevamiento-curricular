-- ============================================================================
-- 10_publicar_catalogo.sql — Publicar el catálogo con un botón
--
-- Editar el catálogo no alcanzaba: había que bajar el JSON y subirlo al
-- repositorio a mano. Si nadie lo hacía, el equipo veía sus correcciones en
-- los resultados pero los docentes seguían con el catálogo viejo.
--
-- Ahora el botón «Publicar» sube el JSON a Supabase Storage, en un bucket
-- público que se sirve por CDN. El formulario lo lee de ahí y, si no está o
-- falla, usa el datos/catalogo.json del repositorio. Esa caída es la red de
-- seguridad: el formulario nunca se queda sin catálogo.
--
-- Por qué Storage y no la base: diez mil docentes descargando el catálogo el
-- mismo día no pueden pegarle a PostgreSQL. Un archivo estático en el CDN sí
-- lo aguanta, que es exactamente lo que hace hoy GitHub Pages.
--
-- Se puede correr más de una vez.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. El bucket
--
-- Público para leer (lo necesita el formulario, que entra sin usuario) y
-- escribible solo por el equipo de Planificación.
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('catalogo', 'catalogo', true)
on conflict (id) do update set public = true;

drop policy if exists "catalogo lectura publica"  on storage.objects;
create policy "catalogo lectura publica"
  on storage.objects for select
  using (bucket_id = 'catalogo');

drop policy if exists "catalogo escribe el equipo" on storage.objects;
create policy "catalogo escribe el equipo"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'catalogo' and (select public.es_equipo()));

drop policy if exists "catalogo actualiza el equipo" on storage.objects;
create policy "catalogo actualiza el equipo"
  on storage.objects for update to authenticated
  using (bucket_id = 'catalogo' and (select public.es_equipo()))
  with check (bucket_id = 'catalogo' and (select public.es_equipo()));


-- ----------------------------------------------------------------------------
-- 2. Registro de publicaciones
--
-- Para que el panel pueda decir «publicado hace 3 días por fulano» y para
-- saber si lo editado ya llegó a los docentes.
-- ----------------------------------------------------------------------------

create table if not exists public.catalogo_publicaciones (
  id             bigserial primary key,
  momento        timestamptz not null default now(),
  usuario_id     uuid,
  usuario_email  text,
  saberes        integer not null,
  contenidos     integer not null,
  nota           text
);

create index if not exists ix_publicaciones_momento on public.catalogo_publicaciones (momento desc);

alter table public.catalogo_publicaciones enable row level security;

drop policy if exists "equipo lee publicaciones" on public.catalogo_publicaciones;
create policy "equipo lee publicaciones"
  on public.catalogo_publicaciones for select to authenticated
  using ((select public.es_equipo()));

revoke all on public.catalogo_publicaciones from anon, authenticated;
grant select on public.catalogo_publicaciones to authenticated;


create or replace function public.registrar_publicacion(
  p_saberes    integer,
  p_contenidos integer,
  p_nota       text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_id    bigint;
begin
  if not public.es_equipo() then
    raise exception 'Tu usuario no está en el equipo de Planificación.' using errcode = '42501';
  end if;
  select u.email into v_email from auth.users u where u.id = auth.uid();

  insert into public.catalogo_publicaciones (usuario_id, usuario_email, saberes, contenidos, nota)
  values (auth.uid(), v_email, p_saberes, p_contenidos, nullif(btrim(coalesce(p_nota, '')), ''))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'momento', now(), 'usuario', coalesce(v_email, 'sistema'));
end;
$$;

revoke execute on function public.registrar_publicacion(integer, integer, text) from public, anon;
grant  execute on function public.registrar_publicacion(integer, integer, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 3. Estado de la publicación
--
-- Dice cuándo se publicó por última vez y si quedaron cambios sin publicar,
-- comparando contra la última entrada de la auditoría. Es lo que le permite al
-- panel avisar: «hay 4 cambios sin publicar».
-- ----------------------------------------------------------------------------

create or replace function public.estado_publicacion()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ultima as (
    select momento, usuario_email, saberes, contenidos
      from public.catalogo_publicaciones
     order by momento desc
     limit 1
  )
  select case when not public.es_equipo() then '{}'::jsonb else
    jsonb_build_object(
      'publicado_en',   (select momento from ultima),
      'publicado_por',  (select coalesce(usuario_email, 'sistema') from ultima),
      'saberes',        (select saberes from ultima),
      'contenidos',     (select contenidos from ultima),
      -- Sin publicaciones todavía, todo cambio cuenta como pendiente
      'cambios_sin_publicar', (
        select count(*) from public.catalogo_auditoria a
         where a.momento > coalesce((select momento from ultima), '-infinity'::timestamptz)))
  end;
$$;

revoke execute on function public.estado_publicacion() from public, anon;
grant  execute on function public.estado_publicacion() to authenticated;
