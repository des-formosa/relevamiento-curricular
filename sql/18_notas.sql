-- ============================================================================
-- 18_notas.sql — La base de directivos y las notas a las escuelas
--
-- Dos cosas que pidió el equipo técnico el 06/11/2026, para tener la gestión
-- en un solo lugar (Seguimiento) en vez de en otra página:
--
-- 1. La base de directivos unificada (un Excel: directores de cada E.P.E.S.,
--    coordinadores de los anexos, situación de revista, celular, correo,
--    dirección). El panel la lee, la coteja con los contactos que ya hay y,
--    cuando el equipo confirma, la carga con cargar_directivos():
--      - vale lo de la planilla, salvo en las escuelas donde el equipo agregó
--        o corrigió un contacto desde la ficha (origen 'panel'): ahí no se toca;
--      - reemplaza lo que había venido de una planilla anterior
--        ('planilla_directivos' o 'base_directivos'), nunca los correos
--        oficiales ni lo escrito desde el panel;
--      - los coordinadores quedan como contacto propio de cada anexo que
--        coordinan: el anexo deja de mostrar el contacto de su sede;
--      - completa el nombre propio de la escuela («Dr. Carlos Pellegrini») si
--        no tenía, y la dirección. El nombre queda como cambio sin publicar en
--        la sección Escuelas.
--
-- 2. Las notas a las escuelas (antes, el «Distribuidor de Notas DES», una
--    página aparte con los contactos guardados en cada computadora). Una nota
--    se redacta una vez y sale una hoja por destinatario, con su escuela y su
--    director. Las notas, el membrete y lo que ya se mandó viven acá, así dos
--    personas del equipo pueden repartirse el envío sin mandar dos veces.
--
-- Todo se escribe por funciones security definer que verifican es_equipo();
-- las tablas las lee solo el equipo.
--
-- Se puede correr más de una vez.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Contactos: situación de revista, a cargo, y el origen nuevo
-- ----------------------------------------------------------------------------

alter table public.contactos_escuela add column if not exists revista text;
alter table public.contactos_escuela add column if not exists a_cargo boolean not null default false;

alter table public.contactos_escuela drop constraint if exists contactos_escuela_origen_check;
alter table public.contactos_escuela add constraint contactos_escuela_origen_check
  check (origen in ('planilla_directivos', 'panel', 'correos_oficiales', 'base_directivos'));

-- La dirección postal de la escuela: va en la base, no en el JSON publicado
alter table public.escuelas add column if not exists direccion text;


-- ----------------------------------------------------------------------------
-- cargar_directivos(filas, escuelas)
--
--   filas:    [{ escuela_id, nombre, cargo, celular, correo, revista, a_cargo }]
--   escuelas: [{ id, denominacion, direccion }]
--
-- Devuelve { cargados, escuelas, respetadas: [ids], nombres } o { error }.
-- ----------------------------------------------------------------------------

create or replace function public.cargar_directivos(p_filas jsonb, p_escuelas jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids        text[];
  v_respetadas text[];
  v_destino    text[];
  v_cargados   integer := 0;
  v_nombres    integer := 0;
  r            record;
begin
  if not public.es_equipo() then
    return jsonb_build_object('error', 'Tu usuario no puede cargar contactos.');
  end if;
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) = 0 then
    return jsonb_build_object('error', 'La planilla no trae ningún contacto para cargar.');
  end if;

  -- Las escuelas que trae la planilla y existen en la base
  select array_agg(distinct f->>'escuela_id') into v_ids
    from jsonb_array_elements(p_filas) f
   where exists (select 1 from public.escuelas e where e.id = f->>'escuela_id');
  if v_ids is null then
    return jsonb_build_object('error', 'Ninguna fila de la planilla coincide con una escuela de la nómina.');
  end if;

  -- Donde el equipo agregó o corrigió algo desde la ficha, manda lo del equipo
  select coalesce(array_agg(distinct c.escuela_id), '{}') into v_respetadas
    from public.contactos_escuela c
   where c.escuela_id = any (v_ids) and c.origen = 'panel';
  select coalesce(array_agg(x), '{}') into v_destino from unnest(v_ids) x where not (x = any (v_respetadas));

  delete from public.contactos_escuela
   where escuela_id = any (v_destino) and origen in ('planilla_directivos', 'base_directivos');

  for r in
    select f->>'escuela_id' as escuela_id,
           nullif(btrim(coalesce(f->>'nombre', '')), '') as nombre,
           nullif(btrim(coalesce(f->>'cargo', '')), '') as cargo,
           nullif(regexp_replace(coalesce(f->>'celular', ''), '\D', '', 'g'), '') as celular,
           nullif(lower(btrim(coalesce(f->>'correo', ''))), '') as correo,
           nullif(btrim(coalesce(f->>'revista', '')), '') as revista,
           coalesce((f->>'a_cargo')::boolean, false) as a_cargo
      from jsonb_array_elements(p_filas) f
     where f->>'escuela_id' = any (v_destino)
  loop
    -- Lo que no pasaría la validación de la ficha se deja vacío, no se inventa
    if r.celular is not null and char_length(r.celular) not between 6 and 15 then r.celular := null; end if;
    if r.correo is not null and r.correo !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then r.correo := null; end if;
    -- El correo de la escuela ya está como «Correo oficial»: no se repite
    if r.correo is not null and exists (select 1 from public.contactos_escuela c
                                         where c.escuela_id = r.escuela_id and lower(c.correo) = r.correo) then
      r.correo := null;
    end if;
    if r.nombre is null and r.celular is null and r.correo is null then continue; end if;
    -- El mismo contacto dos veces en una escuela (una fila repetida en la planilla)
    if exists (select 1 from public.contactos_escuela c
                where c.escuela_id = r.escuela_id and c.origen = 'base_directivos'
                  and coalesce(c.nombre, '') = coalesce(left(r.nombre, 120), '')
                  and coalesce(c.celular, '') = coalesce(r.celular, '')) then
      continue;
    end if;
    insert into public.contactos_escuela (escuela_id, nombre, cargo, celular, correo, revista, a_cargo, origen, actualizado_por)
    values (r.escuela_id, left(r.nombre, 120), left(r.cargo, 80), r.celular, r.correo, r.revista, r.a_cargo,
            'base_directivos', (select auth.uid()));
    v_cargados := v_cargados + 1;
  end loop;

  -- El nombre propio y la dirección de cada escuela. El nombre solo si no
  -- tenía (lo que puso el equipo no se pisa) y queda en el historial de
  -- Escuelas, para publicarlo; la dirección no se publica.
  if jsonb_typeof(p_escuelas) = 'array' then
    for r in
      select e.id, e.denominacion as antes,
             nullif(btrim(coalesce(x->>'denominacion', '')), '') as denominacion,
             nullif(btrim(coalesce(x->>'direccion', '')), '') as direccion
        from jsonb_array_elements(p_escuelas) x
        join public.escuelas e on e.id = x->>'id'
       where e.origen = 'oficial'
    loop
      if r.denominacion is not null and coalesce(btrim(r.antes), '') = '' then
        update public.escuelas set denominacion = left(r.denominacion, 160) where id = r.id;
        insert into public.escuelas_cambios (escuela_id, accion, antes, despues, usuario_id)
        values (r.id, 'edicion', jsonb_build_object('denominacion', ''),
                jsonb_build_object('denominacion', left(r.denominacion, 160)), (select auth.uid()));
        v_nombres := v_nombres + 1;
      end if;
      if r.direccion is not null then
        update public.escuelas set direccion = left(r.direccion, 200) where id = r.id;
      end if;
    end loop;
  end if;

  return jsonb_build_object('cargados', v_cargados, 'escuelas', coalesce(array_length(v_destino, 1), 0),
                            'respetadas', to_jsonb(v_respetadas), 'nombres', v_nombres);
end;
$$;

revoke execute on function public.cargar_directivos(jsonb, jsonb) from public, anon;
grant  execute on function public.cargar_directivos(jsonb, jsonb) to authenticated;


-- ----------------------------------------------------------------------------
-- 2. Notas
-- ----------------------------------------------------------------------------

create table if not exists public.notas (
  id               bigint generated by default as identity primary key,
  titulo           text not null check (char_length(btrim(titulo)) between 1 and 160),
  numero           text,
  fecha            date,
  asunto           text,
  -- 'clasica': fecha y número a la derecha, destinatario en negrita y S/D.;
  -- 'multiple': leyendas del año y el cuadro «DE LA: / A:» de la nota modelo
  formato          text not null default 'clasica' check (formato in ('clasica', 'multiple')),
  -- 'planilla': suma el Anexo 2 (planilla de la escuela) como segunda hoja
  anexo            text check (anexo in ('planilla')),
  dest_extra       text,
  firma            text,
  cuerpo           text not null default '',
  mensaje          text,
  -- los destinatarios elegidos: 'dir:epes-10', 'coord:anexo-el-quemado', 'dz:<correo>'
  destinatarios    text[] not null default '{}',
  archivada        boolean not null default false,
  creada_por       uuid references auth.users (id) on delete set null,
  creada_en        timestamptz not null default now(),
  actualizada_por  uuid references auth.users (id) on delete set null,
  actualizada_en   timestamptz not null default now()
);

-- Lo que ya se mandó: una fila por destinatario; borrarla es «pendiente»
create table if not exists public.notas_envios (
  nota_id      bigint not null references public.notas (id) on delete cascade,
  destino      text not null,
  canal        text not null check (canal in ('whatsapp', 'correo', 'a_mano')),
  enviado_por  uuid references auth.users (id) on delete set null,
  enviado_en   timestamptz not null default now(),
  primary key (nota_id, destino)
);

-- El membrete y la firma: uno solo, igual para todas las notas
create table if not exists public.notas_membrete (
  id               smallint primary key default 1 check (id = 1),
  datos            jsonb not null default '{}'::jsonb,
  actualizado_por  uuid references auth.users (id) on delete set null,
  actualizado_en   timestamptz not null default now()
);

alter table public.notas          enable row level security;
alter table public.notas_envios   enable row level security;
alter table public.notas_membrete enable row level security;
revoke all on public.notas          from anon, authenticated;
revoke all on public.notas_envios   from anon, authenticated;
revoke all on public.notas_membrete from anon, authenticated;
grant select on public.notas          to authenticated;
grant select on public.notas_envios   to authenticated;
grant select on public.notas_membrete to authenticated;

drop policy if exists "equipo lee" on public.notas;
create policy "equipo lee" on public.notas for select to authenticated using ((select public.es_equipo()));
drop policy if exists "equipo lee" on public.notas_envios;
create policy "equipo lee" on public.notas_envios for select to authenticated using ((select public.es_equipo()));
drop policy if exists "equipo lee" on public.notas_membrete;
create policy "equipo lee" on public.notas_membrete for select to authenticated using ((select public.es_equipo()));


-- guardar_nota(id, datos, version): id null = nota nueva. version es el
-- actualizada_en que tenía la nota al abrirla: si otra persona la guardó en
-- el medio, no se pisa y se avisa.
create or replace function public.guardar_nota(p_id bigint, p_datos jsonb, p_version timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_titulo   text := nullif(btrim(coalesce(p_datos->>'titulo', '')), '');
  v_formato  text := coalesce(nullif(p_datos->>'formato', ''), 'clasica');
  v_anexo    text := nullif(p_datos->>'anexo', '');
  v_fecha    date;
  v_dest     text[];
  v_fila     public.notas;
begin
  if not public.es_equipo() then
    return jsonb_build_object('error', 'Tu usuario no puede guardar notas.');
  end if;
  if v_titulo is null then
    return jsonb_build_object('error', 'Ponele un nombre a la nota, para encontrarla después.');
  end if;
  if v_formato not in ('clasica', 'multiple') then v_formato := 'clasica'; end if;
  if v_anexo is not null and v_anexo <> 'planilla' then v_anexo := null; end if;
  begin
    v_fecha := nullif(p_datos->>'fecha', '')::date;
  exception when others then
    return jsonb_build_object('error', 'La fecha de la nota no se entiende. Elegila de nuevo en el calendario.');
  end;
  select coalesce(array_agg(x), '{}') into v_dest from jsonb_array_elements_text(coalesce(p_datos->'destinatarios', '[]'::jsonb)) x;

  if p_id is null then
    insert into public.notas (titulo, numero, fecha, asunto, formato, anexo, dest_extra, firma, cuerpo, mensaje,
                              destinatarios, creada_por, actualizada_por)
    values (left(v_titulo, 160), nullif(btrim(p_datos->>'numero'), ''), v_fecha, nullif(btrim(p_datos->>'asunto'), ''),
            v_formato, v_anexo, nullif(btrim(p_datos->>'dest_extra'), ''), nullif(p_datos->>'firma', ''),
            coalesce(p_datos->>'cuerpo', ''), nullif(p_datos->>'mensaje', ''), v_dest, (select auth.uid()), (select auth.uid()))
    returning * into v_fila;
  else
    select * into v_fila from public.notas where id = p_id for update;
    if not found then
      return jsonb_build_object('error', 'Esa nota ya no está. Volvé a la lista de notas.');
    end if;
    if p_version is not null and date_trunc('milliseconds', v_fila.actualizada_en) <> date_trunc('milliseconds', p_version) then
      return jsonb_build_object('error', 'Otra persona del equipo cambió esta nota mientras la tenías abierta. Volvé a abrirla para ver su versión.',
                                'conflicto', true);
    end if;
    update public.notas
       set titulo = left(v_titulo, 160), numero = nullif(btrim(p_datos->>'numero'), ''), fecha = v_fecha,
           asunto = nullif(btrim(p_datos->>'asunto'), ''), formato = v_formato, anexo = v_anexo,
           dest_extra = nullif(btrim(p_datos->>'dest_extra'), ''), firma = nullif(p_datos->>'firma', ''),
           cuerpo = coalesce(p_datos->>'cuerpo', ''), mensaje = nullif(p_datos->>'mensaje', ''),
           destinatarios = v_dest, actualizada_por = (select auth.uid()), actualizada_en = clock_timestamp()
     where id = p_id
    returning * into v_fila;
  end if;
  return to_jsonb(v_fila);
end;
$$;

-- Archivar no borra: la nota deja de estar en la lista y vuelve con «Ver las archivadas»
create or replace function public.archivar_nota(p_id bigint, p_archivada boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.es_equipo() then
    return jsonb_build_object('error', 'Tu usuario no puede cambiar notas.');
  end if;
  update public.notas set archivada = coalesce(p_archivada, true), actualizada_por = (select auth.uid()),
         actualizada_en = clock_timestamp()
   where id = p_id;
  if not found then return jsonb_build_object('error', 'Esa nota ya no está.'); end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- marcar_envio(nota, destino, canal): canal null = volver a «pendiente»
create or replace function public.marcar_envio(p_nota_id bigint, p_destino text, p_canal text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fila public.notas_envios;
begin
  if not public.es_equipo() then
    return jsonb_build_object('error', 'Tu usuario no puede marcar envíos.');
  end if;
  if not exists (select 1 from public.notas where id = p_nota_id) then
    return jsonb_build_object('error', 'Esa nota ya no está.');
  end if;
  if p_canal is null then
    delete from public.notas_envios where nota_id = p_nota_id and destino = p_destino;
    return jsonb_build_object('ok', true);
  end if;
  if p_canal not in ('whatsapp', 'correo', 'a_mano') then
    return jsonb_build_object('error', 'No conocemos esa forma de envío.');
  end if;
  insert into public.notas_envios (nota_id, destino, canal, enviado_por)
  values (p_nota_id, p_destino, p_canal, (select auth.uid()))
  on conflict (nota_id, destino) do update
     set canal = excluded.canal, enviado_por = excluded.enviado_por, enviado_en = now()
  returning * into v_fila;
  return to_jsonb(v_fila);
end;
$$;

-- El membrete: leyendas del año, remitente, firma (con su imagen, opcional),
-- tratamientos. Una imagen de firma muy pesada haría lenta cada nota.
create or replace function public.guardar_membrete(p_datos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.es_equipo() then
    return jsonb_build_object('error', 'Tu usuario no puede cambiar el membrete.');
  end if;
  if jsonb_typeof(p_datos) is distinct from 'object' then
    return jsonb_build_object('error', 'El membrete vino vacío.');
  end if;
  if octet_length(p_datos::text) > 700000 then
    return jsonb_build_object('error', 'La imagen de la firma es muy pesada. Probá con una más chica (menos de 500 KB).');
  end if;
  insert into public.notas_membrete (id, datos, actualizado_por) values (1, p_datos, (select auth.uid()))
  on conflict (id) do update set datos = excluded.datos, actualizado_por = excluded.actualizado_por, actualizado_en = now();
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.guardar_nota(bigint, jsonb, timestamptz) from public, anon;
revoke execute on function public.archivar_nota(bigint, boolean) from public, anon;
revoke execute on function public.marcar_envio(bigint, text, text) from public, anon;
revoke execute on function public.guardar_membrete(jsonb) from public, anon;
grant  execute on function public.guardar_nota(bigint, jsonb, timestamptz) to authenticated;
grant  execute on function public.archivar_nota(bigint, boolean) to authenticated;
grant  execute on function public.marcar_envio(bigint, text, text) to authenticated;
grant  execute on function public.guardar_membrete(jsonb) to authenticated;


-- La nota que venía con el Distribuidor, para no empezar de cero
insert into public.notas (titulo, asunto, formato, anexo, dest_extra, firma, cuerpo, mensaje)
select 'Solicitud de informe «INVOLUCRADOS» ESI (a Directores)',
       'Solicitud de informe consolidado – Dispositivo «INVOLUCRADOS» ESI',
       'multiple', 'planilla', 'Por su intermedio, a los/las Referentes ESI',
       E'Lic. Juan Ramón Pérez\nDirector de Educación Secundaria\nMinisterio de Cultura y Educación',
       '<p>Me dirijo a Ud. y, por su intermedio, al/a la Referente ESI de la institución a su cargo, a efectos de solicitar la presentación del informe consolidado correspondiente al primer corte del dispositivo de evidencias del material «INVOLUCRADOS», cuya fecha límite de presentación fue establecida originalmente para el día 30 de octubre del corriente año.</p>'
       || '<p>Para tal fin, se adjunta la Planilla Institucional de Seguimiento (Anexo 2), la cual deberá ser completada por el/la Referente ESI, consolidando la información consignada en las fichas de implementación recibidas. En aquellos casos en que no se registren evidencias, deberá consignarse la leyenda: “Sin registros”.</p>'
       || '<p>La información solicitada deberá remitirse a la brevedad al correo electrónico de la Dirección de Educación Secundaria: <strong>equiposecundaria.fsa@gmail.com</strong>, hasta el día miércoles 11 del corriente mes y año.</p>'
       || '<p>Sin otro particular, y agradeciendo la colaboración permanente, saludo a Ud. atentamente.</p>',
       'Buenos días {{DIRECTOR}}. Desde la Dirección de Educación Secundaria le hacemos llegar la nota para la {{ESCUELA}} con la solicitud del informe consolidado del dispositivo «INVOLUCRADOS» ESI y la Planilla Institucional de Seguimiento (Anexo 2). El plazo es hasta el miércoles 11. Por favor, confirmar recepción. Muchas gracias.'
 where not exists (select 1 from public.notas where titulo = 'Solicitud de informe «INVOLUCRADOS» ESI (a Directores)');

-- Que la API de Supabase vea enseguida las tablas y funciones nuevas
notify pgrst, 'reload schema';

-- Si llegó hasta acá, quedó instalado: tiene que mostrar al menos 1 nota
select count(*) as notas from public.notas;
