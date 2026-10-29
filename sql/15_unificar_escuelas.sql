-- ============================================================================
-- 15_unificar_escuelas.sql — Unir una escuela que escribió un docente con la
--                            de la nómina que en realidad es
--
-- Con «no encuentro mi escuela» algunos docentes escribieron a mano una
-- escuela que sí estaba en la nómina («epes 2 pirane»). Sus cargas quedaron
-- aparte, en una escuela agregada, y no suman a la de verdad. Desde el
-- seguimiento, el equipo elige cuál es y la unifica:
--
--   - las cargas de la agregada pasan a la elegida;
--   - si un docente cargó la misma materia y año en las dos, queda el envío
--     más nuevo, igual que cuando reenvía (el otro se borra);
--   - sus contactos pasan a la elegida;
--   - la agregada no se borra (las referencias de la base la necesitan) pero
--     deja de mostrarse, y si otro docente vuelve a escribir el mismo nombre,
--     su envío va directo a la elegida (trigger en aportes);
--   - se puede deshacer: vuelven las cargas que se movieron, salvo las que se
--     descartaron por repetidas.
--
-- Se escribe solo por unificar_escuela() y separar_escuela(); la lee el equipo.
--
-- Se puede correr más de una vez.
-- ============================================================================


-- Qué agregada se unificó con cuál
create table if not exists public.escuelas_unificadas (
  agregada_id          text primary key references public.escuelas (id),
  destino_id           text not null references public.escuelas (id),
  cargas_movidas       integer not null default 0,
  cargas_reemplazadas  integer not null default 0,
  unificada_por        uuid references auth.users (id) on delete set null,
  unificada_en         timestamptz not null default now(),
  check (destino_id <> agregada_id)
);

-- De qué escuela venía cada carga movida, para poder deshacer. Sin clave
-- foránea a aportes: el trigger anota el envío antes de que exista, y si
-- termina siendo un reenvío ese id nunca llega a la tabla (no molesta).
create table if not exists public.aportes_unificados (
  aporte_id         bigint primary key,
  escuela_original  text not null references public.escuelas (id)
);
create index if not exists aportes_unificados_original_idx on public.aportes_unificados (escuela_original);

alter table public.escuelas_unificadas enable row level security;
alter table public.aportes_unificados  enable row level security;
revoke all on public.escuelas_unificadas from anon, authenticated;
revoke all on public.aportes_unificados  from anon, authenticated;
grant select on public.escuelas_unificadas to authenticated;

drop policy if exists "equipo lee" on public.escuelas_unificadas;
create policy "equipo lee" on public.escuelas_unificadas
  for select to authenticated using ((select public.es_equipo()));


-- ----------------------------------------------------------------------------
-- Un envío nuevo a una agregada ya unificada va a la elegida
--
-- registrar_aporte() busca la escuela escrita por su nombre: encuentra la
-- agregada (sigue en la base) y el trigger la cambia por la elegida. Como
-- corre antes de chequear repetidos, un reenvío reemplaza al de la elegida.
-- ----------------------------------------------------------------------------

create or replace function public.redirigir_escuela_unificada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_destino text;
begin
  select u.destino_id into v_destino
    from public.escuelas_unificadas u
   where u.agregada_id = new.escuela_id;
  if v_destino is not null then
    insert into public.aportes_unificados (aporte_id, escuela_original)
    values (new.id, new.escuela_id)
    on conflict (aporte_id) do nothing;
    new.escuela_id := v_destino;
  end if;
  return new;
end;
$$;

drop trigger if exists redirigir_escuela_unificada on public.aportes;
create trigger redirigir_escuela_unificada
  before insert on public.aportes
  for each row execute function public.redirigir_escuela_unificada();


-- ----------------------------------------------------------------------------
-- unificar_escuela(agregada, elegida)
--
--   supabase.rpc('unificar_escuela', { p_agregada_id: 'agregada-1a2b…', p_destino_id: 'epes-2' })
--
-- Devuelve { movidas, reemplazadas, docentes }, o { error } con un mensaje
-- para mostrar tal cual.
-- ----------------------------------------------------------------------------

create or replace function public.unificar_escuela(p_agregada_id text, p_destino_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origen        text;
  v_docentes      integer;
  v_movidas       integer;
  v_reemplazadas  integer;
begin
  if not public.es_equipo() then
    return jsonb_build_object('error', 'Tu usuario no puede unificar escuelas.');
  end if;
  select e.origen into v_origen from public.escuelas e where e.id = p_agregada_id;
  if v_origen is null then
    return jsonb_build_object('error', 'No encontramos esa escuela. Volvé a abrir el seguimiento.');
  end if;
  if v_origen <> 'agregada_por_docente' then
    return jsonb_build_object('error', 'Solo se pueden unificar las escuelas que agregaron los docentes.');
  end if;
  if exists (select 1 from public.escuelas_unificadas where agregada_id = p_agregada_id) then
    return jsonb_build_object('error', 'Esa escuela ya está unificada. Volvé a abrir el seguimiento.');
  end if;
  if p_destino_id is null or p_destino_id = p_agregada_id then
    return jsonb_build_object('error', 'Elegí con qué escuela de la nómina se unifica.');
  end if;
  if not exists (select 1 from public.escuelas where id = p_destino_id) then
    return jsonb_build_object('error', 'No encontramos la escuela elegida. Volvé a abrir el seguimiento.');
  end if;
  if exists (select 1 from public.escuelas_unificadas where agregada_id = p_destino_id) then
    return jsonb_build_object('error', 'La escuela elegida ya está unificada con otra: elegí esa otra.');
  end if;

  select count(distinct a.docente_id) into v_docentes
    from public.aportes a where a.escuela_id = p_agregada_id;

  -- Un docente que cargó la misma materia y año en las dos: queda el más nuevo
  with repetidos as (
    select a.id as de_la_agregada, b.id as de_la_elegida, a.enviado_en >= b.enviado_en as gana_la_agregada
      from public.aportes a
      join public.aportes b
        on b.escuela_id = p_destino_id
       and b.docente_id = a.docente_id
       and b.espacio_id = a.espacio_id
       and b.anio       = a.anio
     where a.escuela_id = p_agregada_id
  )
  delete from public.aportes x
   using repetidos r
   where x.id = case when r.gana_la_agregada then r.de_la_elegida else r.de_la_agregada end;
  get diagnostics v_reemplazadas = row_count;

  insert into public.aportes_unificados (aporte_id, escuela_original)
  select a.id, p_agregada_id from public.aportes a where a.escuela_id = p_agregada_id
  on conflict (aporte_id) do update set escuela_original = excluded.escuela_original;

  update public.aportes set escuela_id = p_destino_id where escuela_id = p_agregada_id;
  get diagnostics v_movidas = row_count;

  update public.contactos_escuela set escuela_id = p_destino_id where escuela_id = p_agregada_id;
  delete from public.sedes_anexos where anexo_id = p_agregada_id;
  -- Las que ya estaban unificadas con esta pasan a la elegida (sus cargas ya se movieron)
  update public.escuelas_unificadas set destino_id = p_destino_id where destino_id = p_agregada_id;

  insert into public.escuelas_unificadas (agregada_id, destino_id, cargas_movidas, cargas_reemplazadas, unificada_por)
  values (p_agregada_id, p_destino_id, v_movidas, v_reemplazadas, (select auth.uid()));

  return jsonb_build_object('movidas', v_movidas, 'reemplazadas', v_reemplazadas, 'docentes', v_docentes);
end;
$$;


-- ----------------------------------------------------------------------------
-- separar_escuela(agregada) — deshace la unificación
--
-- Vuelven a la agregada las cargas que se movieron al unificar y las que
-- llegaron después por su nombre. Las descartadas por repetidas no vuelven.
-- Devuelve { vueltas }, o { error }.
-- ----------------------------------------------------------------------------

create or replace function public.separar_escuela(p_agregada_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_destino  text;
  v_vueltas  integer;
begin
  if not public.es_equipo() then
    return jsonb_build_object('error', 'Tu usuario no puede unificar escuelas.');
  end if;
  select u.destino_id into v_destino from public.escuelas_unificadas u where u.agregada_id = p_agregada_id;
  if v_destino is null then
    return jsonb_build_object('error', 'Esa escuela ya no está unificada. Volvé a abrir el seguimiento.');
  end if;

  delete from public.escuelas_unificadas where agregada_id = p_agregada_id;

  update public.aportes a
     set escuela_id = p_agregada_id
    from public.aportes_unificados u
   where u.aporte_id = a.id
     and u.escuela_original = p_agregada_id
     and a.escuela_id <> p_agregada_id
     and not exists (
       select 1 from public.aportes x
        where x.escuela_id = p_agregada_id and x.docente_id = a.docente_id
          and x.espacio_id = a.espacio_id and x.anio = a.anio);
  get diagnostics v_vueltas = row_count;

  delete from public.aportes_unificados where escuela_original = p_agregada_id;
  return jsonb_build_object('vueltas', v_vueltas);
end;
$$;

revoke execute on function public.unificar_escuela(text, text) from public, anon;
revoke execute on function public.separar_escuela(text) from public, anon;
revoke execute on function public.redirigir_escuela_unificada() from public, anon, authenticated;
grant  execute on function public.unificar_escuela(text, text) to authenticated;
grant  execute on function public.separar_escuela(text) to authenticated;

-- Que la API de Supabase vea enseguida las tablas y funciones nuevas
notify pgrst, 'reload schema';

-- Si llegó hasta acá, quedó instalado: tiene que mostrar 0 (o las ya unificadas)
select count(*) as escuelas_unificadas from public.escuelas_unificadas;
