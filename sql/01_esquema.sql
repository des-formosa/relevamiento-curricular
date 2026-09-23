-- ============================================================================
-- 01_esquema.sql — Tablas del relevamiento curricular
--
-- Tres bloques:
--   1. Catálogo curricular: espejo de datos/catalogo.json, para que el
--      dashboard pueda cruzar en SQL. El formulario NO lo lee de acá.
--   2. Institucional: departamentos y escuelas (datos/escuelas.json).
--   3. Relevamiento: lo que envían los docentes.
--
-- Se puede correr más de una vez: todo usa "if not exists".
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Catálogo curricular
--    Área → Espacio curricular → Eje → Saber → Contenidos sugeridos
-- ----------------------------------------------------------------------------

create table if not exists public.areas (
  id      text primary key,
  nombre  text not null,
  orden   smallint not null
);

create table if not exists public.espacios_curriculares (
  id                 text primary key,
  area_id            text not null references public.areas (id),
  nombre             text not null,
  -- No siempre es {1,2,3}: Educación Tecnológica solo se dicta en 1° y 2°.
  anios_dictados     smallint[] not null default '{1,2,3}'
                     check (cardinality(anios_dictados) > 0 and anios_dictados <@ '{1,2,3}'::smallint[]),
  -- true en las cuatro artísticas: los saberes valen para todo el ciclo.
  saberes_por_ciclo  boolean not null default false,
  origen             text check (origen in ('ocr_automatico', 'transcripcion_manual')),
  orden              smallint not null
);

create table if not exists public.ejes (
  id          text primary key,
  espacio_id  text not null references public.espacios_curriculares (id),
  nombre      text not null,
  orden       smallint not null
);

create table if not exists public.saberes (
  id         text primary key,
  eje_id     text not null references public.ejes (id),
  -- null = el saber vale para todo el Ciclo Básico (artísticas).
  anio       smallint check (anio between 1 and 3),
  -- Lo asigna el Ministerio. El docente no lo elige ni lo ve.
  trimestre  smallint not null check (trimestre between 1 and 3),
  texto      text not null,
  -- 'mala' = texto de OCR todavía sin corregir: el formulario no lo muestra.
  calidad    text not null check (calidad in ('buena', 'revisar', 'mala')),
  orden      smallint not null
);

create table if not exists public.contenidos_sugeridos (
  id                 text primary key,
  saber_id           text not null references public.saberes (id),
  texto              text not null,
  texto_normalizado  text not null,
  origen             text not null default 'resolucion_672',
  -- Permite que selecciones verifique que el contenido es de ese saber.
  unique (id, saber_id)
);

-- Activo o archivado. Nada del catálogo se borra: lo que sale se archiva y
-- conserva sus respuestas (ver 09_edicion_catalogo.sql).
--
-- Va acá y no solo en el 09 porque cargar_catalogo(), en el 03, ya lo usa: en
-- una instalación nueva, corriendo los archivos en orden, el 07 fallaba por no
-- encontrar la columna. El 09 lo repite y no pasa nada: todo es «si no existe».
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


-- ----------------------------------------------------------------------------
-- 2. Institucional
-- ----------------------------------------------------------------------------

create table if not exists public.departamentos (
  id      text primary key,
  nombre  text not null
);

create table if not exists public.escuelas (
  id                  text primary key,
  departamento_id     text not null references public.departamentos (id),
  numero              text,
  denominacion        text,
  nombre              text not null,
  localidad           text,
  nombre_normalizado  text not null,
  -- 'agregada_por_docente' = la escribió un docente con "no encuentro mi escuela".
  origen              text not null default 'oficial'
                      check (origen in ('oficial', 'agregada_por_docente')),
  creado_en           timestamptz not null default now()
);

-- Si la escuela sigue en la nómina oficial. Una que sale no se borra —puede
-- tener aportes— pero deja de usarse: por ejemplo, los datos de ejemplo no
-- inventan docentes en ella. La mantiene al día cargar_escuelas().
alter table public.escuelas
  add column if not exists vigente boolean not null default true;


-- ----------------------------------------------------------------------------
-- 3. Relevamiento
-- ----------------------------------------------------------------------------

create table if not exists public.docentes (
  id         bigint generated by default as identity primary key,
  -- Identificador que puede generar el navegador (crypto.randomUUID) y mandar
  -- en cada envío, para que las varias materias de un mismo docente queden
  -- bajo un solo registro. Si no lo manda, se genera uno por envío.
  clave      uuid not null unique default gen_random_uuid(),
  nombre     text not null check (char_length(btrim(nombre)) between 1 and 100),
  apellido   text not null check (char_length(btrim(apellido)) between 1 and 100),
  creado_en  timestamptz not null default now()
);

create table if not exists public.aportes (
  id          bigint generated by default as identity primary key,
  docente_id  bigint not null references public.docentes (id) on delete cascade,
  escuela_id  text not null references public.escuelas (id),
  espacio_id  text not null references public.espacios_curriculares (id),
  anio        smallint not null check (anio between 1 and 3),
  enviado_en  timestamptz not null default now(),
  -- true = dato inventado para la demo. Nunca lo pone el formulario.
  es_ejemplo  boolean not null default false,
  unique (docente_id, escuela_id, espacio_id, anio)
);

-- Contenido del catálogo y contenido libre viven en la misma tabla, con "tipo".
-- El dashboard la consulta muchísimo: sin JOIN a otra tabla es más rápida.
create table if not exists public.selecciones (
  id                     bigint generated by default as identity primary key,
  aporte_id              bigint not null references public.aportes (id) on delete cascade,
  saber_id               text not null references public.saberes (id),
  tipo                   text not null check (tipo in ('catalogo', 'libre')),
  contenido_sugerido_id  text,
  texto                  text not null check (char_length(btrim(texto)) between 1 and 500),
  texto_normalizado      text not null check (texto_normalizado <> ''),
  orden                  smallint not null,
  unique (aporte_id, saber_id, texto_normalizado),
  -- Obligatorio si es del catálogo, vacío si es libre.
  check ((tipo = 'catalogo') = (contenido_sugerido_id is not null)),
  -- El contenido sugerido tiene que pertenecer a ese mismo saber.
  foreign key (contenido_sugerido_id, saber_id)
    references public.contenidos_sugeridos (id, saber_id)
);

-- "No trabajo este saber". No es lo mismo que no contestar: es el dato que
-- corrige el denominador de los porcentajes del dashboard.
create table if not exists public.saberes_no_trabajados (
  aporte_id  bigint not null references public.aportes (id) on delete cascade,
  saber_id   text not null references public.saberes (id),
  primary key (aporte_id, saber_id)
);


-- ----------------------------------------------------------------------------
-- Normalización posterior de textos libres (la usa el equipo)
-- ----------------------------------------------------------------------------

create table if not exists public.grupos_texto_libre (
  id                     bigint generated by default as identity primary key,
  saber_id               text not null references public.saberes (id),
  texto_normalizado      text not null,
  texto_representativo   text not null,
  frecuencia             integer not null default 0,
  -- Si el grupo equivale a un contenido del catálogo, cuál.
  contenido_sugerido_id  text references public.contenidos_sugeridos (id),
  estado                 text not null default 'pendiente'
                         check (estado in ('pendiente', 'revisado', 'descartado')),
  revisado_por           uuid references auth.users (id) on delete set null,
  revisado_en            timestamptz,
  unique (saber_id, texto_normalizado)
);


-- ----------------------------------------------------------------------------
-- Equipo de Planificación: quién puede ver el dashboard
--
-- Los usuarios se crean en Supabase Auth, pero además tienen que estar en
-- esta tabla. Así, si alguien lograra registrarse por su cuenta, igual no ve
-- nada: los nombres de los docentes son datos personales.
-- ----------------------------------------------------------------------------

create table if not exists public.equipo_planificacion (
  usuario_id  uuid primary key references auth.users (id) on delete cascade,
  nombre      text,
  creado_en   timestamptz not null default now()
);


-- ----------------------------------------------------------------------------
-- Índices para el dashboard
-- ----------------------------------------------------------------------------

create index if not exists espacios_area_idx        on public.espacios_curriculares (area_id);
create index if not exists ejes_espacio_idx         on public.ejes (espacio_id);
create index if not exists saberes_eje_idx          on public.saberes (eje_id);
create index if not exists contenidos_saber_idx     on public.contenidos_sugeridos (saber_id);
create index if not exists escuelas_depto_idx       on public.escuelas (departamento_id);
create index if not exists escuelas_nombre_idx      on public.escuelas (departamento_id, nombre_normalizado);
create index if not exists aportes_espacio_anio_idx on public.aportes (espacio_id, anio, es_ejemplo);
create index if not exists aportes_escuela_idx      on public.aportes (escuela_id);
create index if not exists selecciones_saber_idx    on public.selecciones (saber_id, texto_normalizado);
create index if not exists selecciones_contenido_idx on public.selecciones (contenido_sugerido_id) where contenido_sugerido_id is not null;
create index if not exists no_trabajados_saber_idx  on public.saberes_no_trabajados (saber_id);
create index if not exists grupos_saber_idx         on public.grupos_texto_libre (saber_id);
