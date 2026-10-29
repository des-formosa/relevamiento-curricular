-- ============================================================================
-- 14_sedes_anexos.sql — De qué E.P.E.S. depende cada anexo
--
-- Para el seguimiento de la carga: un anexo sin contacto propio muestra el de
-- su sede. El panel la deduce de la nómina (la E.P.E.S. que lo precede), y
-- casi siempre acierta; cuando no, el equipo la corrige desde la ficha de la
-- escuela y queda anotada acá.
--
-- Una fila es una corrección: si un anexo no tiene fila, vale la de la nómina.
-- sede_id en null quiere decir «no depende de ninguna» (tiene dirección
-- propia). Volver a la de la nómina es borrar la fila.
--
-- Se escribe solo por guardar_sede() y restaurar_sede(); la lee el equipo.
-- No son datos personales, pero se protege igual que los contactos: el
-- formulario del docente no la necesita.
--
-- Se puede correr más de una vez.
-- ============================================================================


create table if not exists public.sedes_anexos (
  anexo_id         text primary key references public.escuelas (id),
  sede_id          text references public.escuelas (id),
  actualizado_por  uuid references auth.users (id) on delete set null,
  actualizado_en   timestamptz not null default now(),
  check (sede_id is distinct from anexo_id)
);

alter table public.sedes_anexos enable row level security;
revoke all on public.sedes_anexos from anon, authenticated;
grant select on public.sedes_anexos to authenticated;

drop policy if exists "equipo lee" on public.sedes_anexos;
create policy "equipo lee" on public.sedes_anexos
  for select to authenticated using ((select public.es_equipo()));


-- ----------------------------------------------------------------------------
-- guardar_sede(anexo, sede) — anota de quién depende el anexo
--
--   supabase.rpc('guardar_sede', { p_anexo_id: 'anexo-pozo-molina', p_sede_id: 'epes-39' })
--   supabase.rpc('guardar_sede', { p_anexo_id: 'anexo-pozo-molina', p_sede_id: null })   -- ninguna
--
-- Devuelve { anexo_id, sede_id } como quedó, o { error } con un mensaje para
-- mostrar tal cual.
-- ----------------------------------------------------------------------------

create or replace function public.guardar_sede(p_anexo_id text, p_sede_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Sin variables del tipo de la tabla (public.sedes_anexos): el SQL Editor
  -- de Supabase rechazaba la función con «type does not exist» al crearla
  v_sede text := nullif(btrim(coalesce(p_sede_id, '')), '');
begin
  if not public.es_equipo() then
    return jsonb_build_object('error', 'Tu usuario no puede cambiar de quién depende una escuela.');
  end if;
  if not exists (select 1 from public.escuelas where id = p_anexo_id) then
    return jsonb_build_object('error', 'No encontramos esa escuela.');
  end if;
  if v_sede = p_anexo_id then
    return jsonb_build_object('error', 'Una escuela no puede depender de sí misma.');
  end if;
  if v_sede is not null and not exists (select 1 from public.escuelas where id = v_sede) then
    return jsonb_build_object('error', 'No encontramos la E.P.E.S. elegida. Volvé a abrir la escuela.');
  end if;

  insert into public.sedes_anexos (anexo_id, sede_id, actualizado_por)
  values (p_anexo_id, v_sede, (select auth.uid()))
  on conflict (anexo_id) do update
     set sede_id = excluded.sede_id, actualizado_por = excluded.actualizado_por, actualizado_en = now();
  return jsonb_build_object('anexo_id', p_anexo_id, 'sede_id', v_sede);
end;
$$;

-- restaurar_sede(anexo) — vuelve a la que dice la nómina
create or replace function public.restaurar_sede(p_anexo_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.es_equipo() then
    return jsonb_build_object('error', 'Tu usuario no puede cambiar de quién depende una escuela.');
  end if;
  delete from public.sedes_anexos where anexo_id = p_anexo_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.guardar_sede(text, text) from public, anon;
revoke execute on function public.restaurar_sede(text) from public, anon;
grant  execute on function public.guardar_sede(text, text) to authenticated;
grant  execute on function public.restaurar_sede(text) to authenticated;

-- Si llegó hasta acá, quedó instalado: tiene que mostrar 0 (o las sedes ya corregidas)
select count(*) as sedes_corregidas from public.sedes_anexos;
