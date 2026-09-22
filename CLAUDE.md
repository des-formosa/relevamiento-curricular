# Relevamiento Curricular — Ciclo Básico, Provincia de Formosa

Plataforma para que los docentes de secundaria de Formosa declaren qué contenidos priorizan
de cada saber del diseño curricular, y para que el área de Planificación Curricular del
Ministerio vea los resultados consolidados.

El objetivo no es juntar planificaciones: es **poder comparar**. Que dos profesores de
Matemática de 2° año, de escuelas distintas, elijan contenidos escritos de la misma forma es
lo que después permite ver dónde hay acuerdo, dónde hay dispersión y qué saberes no está
trabajando nadie.

---

## Fecha límite y alcance

**Viernes 26 de septiembre de 2026.** Ese día pasan dos cosas: se abre la carga para los
docentes y se presenta el dashboard a las autoridades.

Como la carga arranca ese mismo día, el dashboard va a estar vacío en la presentación.
**Debe poder mostrarse con datos de ejemplo verosímiles**, claramente marcados como tales.

Volumen esperado: entre 5.000 y 10.000 docentes, unas 81 escuelas, carga distribuida a lo
largo de varios días a partir del 26.

---

## Arquitectura

Sitio **estático** en GitHub Pages + **Supabase** (PostgreSQL) para las respuestas.

La decisión que ordena todo el diseño: **el catálogo curricular no vive en la base de datos**.
Es información que no cambia durante el operativo y es idéntica para los diez mil docentes,
así que viaja como JSON dentro del repositorio. Se descarga una vez con la página y todas las
pantallas del docente funcionan sin consultar el servidor.

La única vez que el navegador habla con Supabase durante la carga es al confirmar, y es **una
sola escritura**. Con diez mil personas entrando el mismo día, esa diferencia decide si el
sistema aguanta.

| Capa | Dónde vive | Quién la escribe |
|---|---|---|
| Catálogo curricular (áreas, espacios, ejes, saberes, contenidos sugeridos) | `datos/catalogo.json` en el repo | el equipo, desde el panel: edita en la base y publica el JSON |
| Escuelas y departamentos | `datos/escuelas.json` en el repo | nadie desde la app |
| Aportes de los docentes | Supabase | el formulario, vía una función RPC |
| Usuarios del dashboard | Supabase Auth | administrador |

**Sin build, sin framework, sin npm.** HTML + CSS + JavaScript vanilla. GitHub Pages sirve los
archivos tal cual. Si en algún momento hace falta una librería, se carga por CDN con versión
fijada, nunca por bundler.

---

## Estructura del repositorio

```
/
├── CLAUDE.md
├── index.html              formulario del docente (con «?demo» no escribe en la base)
├── dashboard.html          panel del equipo (requiere login)
├── assets/
│   ├── estilos.css         sistema visual (tokens, componentes, móvil y escritorio)
│   ├── normalizar.js       normalizarTexto(), espejo exacto de normalizar_texto() en SQL
│   ├── catalogo.js         carga los JSON y arma los índices en memoria
│   ├── supabase.js         configuración del proyecto y enviarAporte()
│   ├── formulario.js       estado, navegación y pantallas del flujo del docente
│   ├── dashboard.js        panel: sesión, selectores, Detalle, Mapa de calor, exportar
│   ├── editor.js           edición del catálogo desde el panel, con historial
│   ├── tour.js             recorrido guiado del panel y del editor
│   ├── tablero.css         estilos propios del panel (usa los tokens de estilos.css)
│   ├── fuentes/            Kumbh Sans, Didact Gothic y Noto Serif Ahom en woff2, embebidas
│   └── img/                logos oficiales, más los símbolos recortados que se usan en pantalla
├── datos/
│   ├── catalogo.json       942 saberes, 4.716 contenidos sugeridos
│   ├── contenidos/         contenidos propuestos por materia + aplicar.py
│   └── contenidos_672_originales.json   los recortes que traía la transcripción
│   └── escuelas.json       81 escuelas E.P.E.S., 9 departamentos
└── sql/                    se corren en orden en el SQL Editor; todos se pueden re-ejecutar
    ├── 01_esquema.sql      tablas e índices
    ├── 02_rls.sql          RLS, permisos, es_equipo()
    ├── 03_funciones.sql    normalizar_texto, registrar_aporte, cargar_catalogo, cargar_contenidos, cargar_escuelas
    ├── 04_vistas.sql       vistas para exportar y panel_resultados() para el dashboard
    ├── 05_datos_ejemplo.sql  generar_datos_ejemplo() / borrar_datos_ejemplo()
    ├── 06_cargar_escuelas.sql  generado: datos/escuelas.json → base
    ├── 07_cargar_catalogo.sql  generado: el catálogo sin los contenidos
    ├── 08_cargar_contenidos_N.sql  generado: los contenidos, en lotes
    ├── 09_edicion_catalogo.sql  editar el catálogo desde el panel, con auditoría
    └── generar_cargas.py   regenera 06, 07 y 08 cuando cambian los JSON
```

---

## El catálogo curricular

Sale de la **Resolución 672**, el diseño curricular del Ciclo Básico de Formosa. El PDF
original es un escaneo sin capa de texto. Se empezó con OCR, pero la calidad del escaneo no
alcanzó, así que **las 16 materias terminaron transcritas a mano contra el PDF**. Los saberes
tienen `origen: "transcripcion_manual"` y `calidad: "buena"`.

### Los contenidos sugeridos no salen de la Resolución

La Resolución enuncia saberes, no contenidos. La transcripción había dejado como "contenidos"
recortes del propio texto del saber, muchos cortados a la mitad: «Mcd en situaciones
planteadas», «Noción energía», «Entendida en su complejidad». El 77 % era subcadena literal
del saber y 193 saberes tenían una sola opción. Eso rompía el objetivo del relevamiento: si el
docente no reconoce la opción, no la elige, escribe texto libre y se pierde la comparabilidad.

Por eso los **4.716 contenidos sugeridos los escribió el equipo** (22/09/2026), cinco por
saber, con criterio de la materia y del año. Llevan `origen: "propuesto_equipo"` para
distinguirlos de lo que está textualmente en la Resolución, y la pantalla del docente los
titula «Sugerencias para este saber», nunca «del diseño curricular».

Se editan en `datos/contenidos/<espacio_id>.json` (saber_id → lista de textos) y se vuelcan al
catálogo con `python datos/contenidos/aplicar.py`, que reemplaza los contenidos del saber,
recalcula `texto_normalizado` y asigna ids `<saber_id>--p<n>`. `--revisar` informa la cobertura
sin escribir. Los contenidos originales quedaron guardados en
`datos/contenidos_672_originales.json` por si el equipo quiere consultarlos.

Jerarquía: **Área → Espacio Curricular → Eje → Saber → Contenidos sugeridos**

`datos/catalogo.json` usa arrays planos con ids, para que el navegador arme sus índices:

```js
{
  areas:      [{ id, nombre, orden }],
  espacios:   [{ id, nombre, area_id, anios_dictados, saberes_por_ciclo, origen, orden }],
  ejes:       [{ id, espacio_id, nombre, orden }],
  saberes:    [{ id, eje_id, anio, trimestre, texto, calidad, orden }],
  contenidos: [{ id, saber_id, texto, texto_normalizado, origen }]
}
```

Las seis áreas son: Lenguaje y Comunicación · Matemática · Ciencias Naturales y Tecnología ·
Ciencias Sociales · Desarrollo personal y proyecto de vida · Lengua y Cultura Originarias.

### Particularidades del diseño que el código debe respetar

**1. `anios_dictados` no siempre es `[1,2,3]`.**
Dos materias no se dictan los tres años:

| Materia | Años | Qué falta en el diseño |
|---|---|---|
| Educación Tecnológica | `[1, 2]` | no tiene columna TERCERO |
| Formación Ética y Compromiso Comunitario | `[2, 3]` | no tiene columna PRIMERO |

El año se elige en la pantalla 4 y la materia recién en la 6, así que al llegar al año todavía
no se sabe qué materia va a ser. La validación va en la pantalla 6: el espacio que no se dicta
en el año elegido aparece como tarjeta apagada que **dice por qué** («Se dicta solo en 2° y 3°
año, y elegiste 1° año») con un enlace «Cambiar el año». Nunca un botón apagado sin
explicación, y nunca dejar avanzar una combinación materia/año que el diseño no contempla.

**2. `saberes_por_ciclo: true` en las cuatro artísticas.**
Música, Danza, Teatro y Artes Visuales no diferencian saberes por año: el diseño los presenta
para todo el Ciclo Básico. En esos casos `saberes.anio` viene en `null` y el docente ve los
mismos saberes sin importar el año que eligió. El año igual se guarda en el aporte, porque
importa para los reportes.

**3. El trimestre lo asigna el Ministerio, no el docente.**
Cada saber ya trae su `trimestre` (1, 2 o 3). El docente **no lo elige**: la carga se recorre
en tres tramos, uno por trimestre, con una pantalla corta antes de cada uno («Primer
trimestre · 7 saberes para revisar») y el progreso contado sobre el tramo («Saber 3 de 7»).
Un tramo sin saberes visibles se salta solo.

La distribución se hizo respetando el orden de los ejes del diseño, de forma lineal, con un
reparto aproximado de 40 % / 35 % / 25 %.

**4. `calidad` marca qué tan confiable es el texto.**
Vale `buena`, `revisar` o `mala`. Hoy los 942 saberes son `buena`, porque todo se transcribió a
mano, así que el filtro no descarta nada. **Se mantiene igual en el formulario, el dashboard y
`panel_resultados()`**: si en una corrección futura entra un saber ilegible, no tiene que
llegarle al docente. Un saber que no reconoce no lo selecciona, y se pierde la comparabilidad.

**5. La cantidad de saberes por año es muy despareja, y está bien.**
Va de 7 (Físico-Química 1°) a 65 (Matemática 1°). Por eso la carga se recorre en tres tramos y el
progreso cuenta sobre el tramo: «Saber 3 de 27» en Matemática y «Saber 1 de 4» en Historia 1°
usan exactamente la misma pantalla.

### Regenerar el catálogo

El equipo de Planificación está revisando un Excel con los 831 saberes y sus contenidos. Cuando
devuelvan las correcciones hay que regenerar `datos/catalogo.json` a partir de ese archivo. El
`id` de cada saber es estable, así que las correcciones se aplican por id sin romper nada.

---

## Flujo del docente

Nueve pantallas, una decisión por pantalla. **Sin login, sin registro, sin contraseñas.**

Se usa desde el celular tanto como desde la computadora: diseñar mobile-first.

| # | Pantalla | Notas |
|---|---|---|
| 1 | Bienvenida | qué es, para qué sirve, cuánto tarda (~10 min) |
| 2 | Nombre y apellido | dos campos |
| 3 | Escuela | buscador sobre lista cerrada, agrupada por departamento; enlace discreto "no encuentro mi escuela" que permite escribirla |
| 4 | Año | 1°, 2° o 3°; respetar `anios_dictados` |
| 5 | Área | seis opciones |
| 6 | Espacio curricular | filtrado por área |
| 7 | Carga de contenidos | **la pantalla crítica**, ver abajo; antes de cada trimestre hay una pantalla de tramo |
| 8 | Resumen y chequeo | todo lo cargado, agrupado por trimestre, editable; si quedan saberes sin revisar no deja enviar |
| 9 | Confirmación | "¿cargás otra materia?" → [misma escuela] [otra escuela] [terminé] |

Cuando un área tiene un solo espacio (Matemática) la pantalla 6 se salta; Educación Artística
muestra sus cuatro lenguajes agrupados en una tarjeta. Las dos cosas salen del catálogo, no
están escritas a mano. Si una materia y año no tienen saberes visibles (hoy: Educación Física
1°, entre otros), se muestra un aviso y se ofrece elegir otra materia u otro año.

### Pantalla 7 — carga de contenidos

Se recorre **un saber por vez**, con barra de progreso ("Saber 3 de 9").

Arriba, el eje y el texto completo del saber, bien legible. Abajo, un campo donde el docente
empieza a escribir y se despliegan sugerencias del catálogo **de ese saber**. Toca una y queda
agregada como ficha.

Si lo que escribe no aparece, puede agregarlo igual con un botón "Agregar como está". Esos
contenidos se guardan con `tipo = 'libre'` y se marcan visualmente distinto.

Sin límite de contenidos por saber.

Un botón secundario: **"No trabajo este saber"**. No es lo mismo que saltearlo, y el sistema
necesita distinguirlo: sin ese dato, el denominador de todos los porcentajes del dashboard
queda mal. La diferencia es entre decir "18 de 163 docentes priorizan este saber (11 %)",
que suena a saber huérfano, y "18 de 22 docentes que efectivamente lo dictan lo priorizan
(82 %)", que es alto consenso.

### Persistencia durante la carga

El borrador vive en el navegador (`localStorage`, clave `relevamiento.borrador.v1`): sobrevive
al cierre de la pestaña, que en celulares viejos pasa seguido. Al volver a entrar, la bienvenida
ofrece «Seguir con lo que había cargado»; «Terminé» lo borra. **Nada se escribe en Supabase
hasta que el docente confirma en la pantalla 9.** Eso simplifica mucho: no hace falta estado
`borrador` en la base, ni permisos de UPDATE para el visitante anónimo, ni recuperar sesiones
a medias.

Al empezar se genera una `clave` (uuid) que viaja en `payload.docente.clave`: agrupa todas las
materias de esa persona bajo un mismo docente y hace que reenviar la misma materia reemplace
el envío anterior.

Al "cargar otra materia" se conservan nombre y apellido, y según la respuesta también la
escuela. Muchos docentes dan varias materias en varias escuelas: esto es lo que evita que
abandonen.

---

## Dashboard

Lo usan unas 20 personas del área de Planificación Curricular, desde la computadora. **No son
perfiles técnicos y no van a explorar datos**: necesitan abrirlo y entender en cinco segundos
qué está pasando. Además se proyecta en reuniones con autoridades.

Principio rector: la respuesta ya está calculada y escrita. Si algo necesita explicación,
está mal.

**Es prácticamente una sola pantalla:**

1. **Barra de selección** siempre visible: Materia · Año · Alcance (toda la provincia / un
   departamento / una escuela). No hay filtro de trimestre: se ve el año entero, con los tres
   trimestres en columnas. Arranca con una selección puesta y datos a la vista, nunca vacío;
   si la selección real todavía está vacía, lo dice y ofrece ver los datos de ejemplo.
2. **Línea de contexto**: "Basado en 147 docentes de 62 escuelas." Nada más.
3. **Cuerpo**: los saberes de esa combinación, uno debajo del otro. Para cada saber, su texto
   completo y debajo los contenidos más elegidos, ordenados de mayor a menor, con barra
   horizontal y porcentaje. Mostrar 3 por saber y un enlace "ver los demás" que expande.
4. **Exportar**: un botón que abre un panel chico con dos opciones — lo que estoy viendo, o
   todo el relevamiento provincial — y elección de formato (Excel para trabajar, PDF para
   presentar). Excel se arma con SheetJS por CDN; PDF abre la impresión del navegador con
   una hoja de estilos de impresión. «Todo el relevamiento» baja `v_relevamiento` paginada.

Dos vistas de la misma información, no dos reportes: **Detalle** (contenidos con su barra)
y **Mapa de calor** (los ejes del diseño por trimestre, con los contenidos más elegidos). La
barra de 18 px es el único elemento gráfico: se lee proyectada desde el fondo de una sala.

Es de escritorio y se proyecta, pero se abre igual desde el teléfono. Hasta 899 px todo se
apila —selectores, trimestres, celdas del mapa de calor, que pasan a un bloque por eje con el
trimestre rotulado— y el panel de exportar sube desde abajo. Entre 900 y 1279 px los
selectores dejan de tener ancho fijo. Ningún ancho produce scroll horizontal.

Cuando un saber tiene pocas respuestas (menos de 5 docentes lo trabajan), en vez de
porcentajes engañosos mostrar "Solo 3 docentes informaron este saber. Muestra insuficiente."

Los datos de ejemplo (`es_ejemplo = true`) se activan con un interruptor en la cabecera o con
`#ejemplo=1` en la URL, y aparecen con una banda que dice que son inventados. La selección
completa vive en el hash de la URL, así una vista se puede marcar y compartir.

**Lo que NO va:** índices de divergencia, comparación entre escuelas lado a lado, pantalla de
normalización de textos libres, gráficos de torta, tarjetas de métricas grandes, pestañas ni
menú lateral.

### Editar el catálogo (assets/editor.js + sql/09_edicion_catalogo.sql)

El botón «Editar catálogo» de la cabecera cambia el panel de leer a escribir: los saberes de
la materia y el año elegidos, con sus contenidos, y en cada uno editar, archivar o agregar.
Dos reglas sostienen todo:

**Nada se borra: se archiva.** Un docente puede tener el formulario abierto con el catálogo
viejo descargado. Si el equipo borrara un contenido mientras esa persona carga, su envío
fallaría al confirmar. Archivado significa que sigue en la base —el envío entra— pero sale
del catálogo publicado y deja de ofrecerse. Antes de archivar, la pantalla dice cuántas
respuestas tiene y aclara que se conservan.

**Todo queda registrado.** Un trigger (`auditar_catalogo`) anota alta, edición, archivado y
restauración con el texto anterior, el nuevo, quién y cuándo, más una nota opcional. No
depende de que el front se acuerde: si alguien edita desde el SQL Editor, también queda. Las
cargas masivas del JSON se saltean la auditoría (`app.carga_masiva`), porque ya quedan
registradas en el repositorio.

**Editar no publica.** El formulario del docente sigue leyendo `datos/catalogo.json`, que es
lo que permite que diez mil personas entren el mismo día sin tocar la base. El botón
«Publicar» llama a `exportar_catalogo()` y descarga el JSON con lo que hay en la base (solo
los activos), para reemplazar ese archivo en el repositorio. La pantalla lo dice con todas
las letras, para que nadie crea que editar alcanza.

Las funciones del panel (`catalogo_editar`, `guardar_saber`, `guardar_contenido`,
`archivar_catalogo`, `historial_catalogo`, `exportar_catalogo`) son `security definer` y
verifican `es_equipo()`: el dashboard nunca escribe en las tablas directamente, igual que el
formulario solo entra por `registrar_aporte`.

### El recorrido guiado (assets/tour.js)

Son veinte personas que entran cada tanto, no todos los días. En vez de un instructivo que
nadie lee, el panel se explica solo: ilumina una parte de la pantalla y dice qué mira, con
«Saltar», «Anterior» y «Siguiente». Diez pasos para leer los resultados y ocho para editar el
catálogo.

Arranca solo la primera vez que se entra a cada pantalla (queda anotado en `localStorage`,
claves `relevamiento.tour.*`) y se vuelve a ver desde «¿Cómo se usa?» en la cabecera. Los
pasos marcados `opcional` se saltean si su elemento no está en pantalla, así el recorrido no
señala un vacío cuando todavía no hay datos. Vive fuera de `#app` porque el panel se redibuja
entero en cada acción.

El acceso requiere login (Supabase Auth). Los usuarios los crea el administrador; no hay
registro público.

---

## Base de datos

### Esquema

Catálogo (espejo del JSON, para que el dashboard pueda cruzar en SQL):

```sql
areas(id text pk, nombre, orden)
espacios_curriculares(id text pk, area_id fk, nombre, anios_dictados int[], saberes_por_ciclo bool, orden)
ejes(id text pk, espacio_id fk, nombre, orden)
saberes(id text pk, eje_id fk, anio smallint null, trimestre smallint, texto, calidad, orden)
contenidos_sugeridos(id text pk, saber_id fk, texto, texto_normalizado, origen)
```

Institucional:

```sql
departamentos(id text pk, nombre)
escuelas(id text pk, departamento_id fk, numero, denominacion, nombre, localidad,
         nombre_normalizado, origen)   -- origen: 'oficial' | 'agregada_por_docente'
```

Relevamiento:

```sql
docentes(id bigserial pk, nombre, apellido, creado_en)

aportes(id bigserial pk, docente_id fk cascade, escuela_id fk, espacio_id fk,
        anio smallint check 1..3, enviado_en,
        unique(docente_id, escuela_id, espacio_id, anio))

selecciones(id bigserial pk, aporte_id fk cascade, saber_id fk,
            tipo text check in ('catalogo','libre'),
            contenido_sugerido_id fk null,      -- obligatorio si tipo='catalogo', null si 'libre'
            texto, texto_normalizado, orden,
            unique(aporte_id, saber_id, texto_normalizado))

saberes_no_trabajados(aporte_id fk cascade, saber_id fk, pk(aporte_id, saber_id))
```

Normalización posterior (la usa el equipo para agrupar los textos libres):

```sql
grupos_texto_libre(id, saber_id fk, texto_normalizado, texto_representativo, frecuencia,
                   contenido_sugerido_id fk null, estado, revisado_por, revisado_en)
```

Agregados al implementar (sql/01_esquema.sql):

- `docentes.clave uuid`: si el navegador genera un `crypto.randomUUID()` al empezar y lo manda
  en `payload.docente.clave`, todas las materias de esa persona quedan bajo un solo docente, y
  reenviar la misma materia/año/escuela reemplaza el envío anterior. Es opcional.
- `aportes.es_ejemplo`: marca los datos inventados para la demo. El formulario nunca lo pone.
- `equipo_planificacion(usuario_id)`: además de existir en Supabase Auth, el usuario del
  dashboard tiene que estar en esta tabla para ver algo.

**No existe tabla de trimestres.** El trimestre es un atributo de `saberes`, no algo que el
docente elija.

La herencia de "contenido del catálogo" versus "contenido libre" se resuelve con una sola
tabla `selecciones` y una columna `tipo`. Esa tabla se consulta cientos de miles de veces desde
el dashboard: sin JOIN es sensiblemente más rápida.

### Seguridad

La clave pública de Supabase queda visible en el JavaScript. Es inevitable en un sitio
estático, así que hay que diseñar asumiendo que es pública.

1. **RLS activado en todas las tablas.** Ninguna acepta escrituras directas del rol `anon`.
2. **`escuelas` es la única lectura pública** (la necesita el buscador).
3. **El envío pasa por una única función** `registrar_aporte(payload jsonb)`, declarada
   `security definer`, que escribe todo en una transacción. Si algo falla, no queda nada a
   medias. El rol `anon` tiene `execute` sobre esa función y nada más.
4. **El dashboard lee con rol `authenticated`.**

Desde el navegador todo el envío es una línea:

```js
const { data, error } = await supabase.rpc('registrar_aporte', { payload });
```

Es el mismo principio que hace que una `Seleccion` solo se toque a través de su `Aporte`:
hay una sola puerta de entrada y está controlada.

### Normalizar texto

Función `normalizar_texto(t)` en SQL, y su equivalente en JavaScript. Baja a minúsculas, quita
acentos y puntuación, colapsa espacios. Se usa en tres lugares: el autocompletado, el
anti-duplicado dentro de un mismo aporte, y el agrupamiento de textos libres en el dashboard.

Las dos implementaciones **tienen que dar exactamente el mismo resultado**.

### Volúmenes

Unos 15.000 aportes y 600.000 selecciones. Para PostgreSQL es poco; el punto de atención es la
concurrencia del primer día, no el tamaño. Conviene el plan Pro durante el mes del
relevamiento: el gratuito pausa proyectos por inactividad y limita conexiones simultáneas.

---

## Convenciones

- **Todo en español**: nombres de tablas, columnas, variables, funciones, comentarios y
  mensajes. Sin mezclar inglés.
- **Sin framework ni build.** HTML, CSS y JavaScript vanilla. Librerías solo por CDN con
  versión fijada, y solo si hacen falta de verdad.
- **Mobile-first** en el formulario. El dashboard es de escritorio.
- Accesible: contraste alto, tipografía grande, objetivos táctiles amplios. Se va a usar con
  sol, en pantallas viejas y con conexión inestable.
- **Escribir para el docente, no para el sistema.** Los mensajes de error dicen qué pasó y
  cómo resolverlo.

---

## Estado

**Hecho**
- Formulario del docente completo (`index.html` + `assets/`), fiel al canvas de diseño en
  móvil y escritorio. Probado de punta a punta en Chrome: todas las materias particulares
  (Matemática salta el espacio, artísticas por ciclo, Tecnológica solo 1° y 2°, materias sin
  saberes), autocompletado, contenidos libres, «no trabajo este saber», resumen, reanudar
  el borrador y envío real a Supabase
- SQL completo en `sql/` (esquema, RLS, `registrar_aporte`, vistas, `panel_resultados`, datos
  de ejemplo, carga de catálogo y escuelas), probado en PostgreSQL local: `normalizar_texto`
  da idéntico a `normalizarTexto()` de JS en los 2.597 textos del catálogo y escuelas
- Proyecto de Supabase "Relevamiento Curricular" (región sa-east-1, São Paulo) con todo el SQL
  aplicado, escuelas y catálogo cargados, y 1.500 docentes de ejemplo (`es_ejemplo = true`);
  el catálogo que tiene la base es el viejo, ver Pendiente.
  `assets/supabase.js` ya apunta al proyecto: lo que se envíe desde el formulario se guarda de verdad
- **Catálogo curricular terminado** (22/09/2026): las 16 materias transcritas a mano contra el
  PDF. 942 saberes con trimestre asignado y 45 ejes reales, en `datos/catalogo.json`. Todos
  `calidad: buena`, ninguna combinación materia/año vacía
- **Contenidos sugeridos reescritos** (22/09/2026): 4.716, cinco por saber, escritos por el
  equipo porque los de la transcripción eran recortes del texto del saber. `origen:
  "propuesto_equipo"`. Fuente editable en `datos/contenidos/`
- **Edición del catálogo desde el panel** (22/09/2026): `sql/09_edicion_catalogo.sql` y
  `assets/editor.js`. Editar, agregar y archivar saberes y contenidos, con historial de
  cambios y botón para publicar el JSON. Probado con un cliente simulado; falta correr el
  SQL en Supabase y probarlo con un usuario del equipo
- **Recorrido guiado del panel** (`assets/tour.js`): diez pasos para leer los resultados y
  ocho para editar el catálogo. Arranca solo la primera vez y se repite desde «¿Cómo se usa?»
- Dashboard completo (`dashboard.html` + `assets/dashboard.js` + `assets/tablero.css`):
  ingreso con Supabase Auth, chequeo de `equipo_planificacion`, Detalle, Mapa de calor,
  datos de ejemplo, exportar a Excel y PDF. Probado con un cliente simulado y el ingreso
  contra el proyecto real; falta probarlo con un usuario del equipo
- Listado de escuelas: 81 E.P.E.S. en 9 departamentos, en `datos/escuelas.json`
- Modelo de datos definido
- Diseño de pantallas (en Claude Design, en paralelo)
- Publicado en GitHub Pages bajo la organización `des-formosa`:
  https://des-formosa.github.io/relevamiento-curricular/ (formulario) y
  https://des-formosa.github.io/relevamiento-curricular/dashboard.html (panel)

**Pendiente**
- **Subir el catálogo nuevo a Supabase** (incluye los contenidos reescritos). En el SQL Editor,
  en este orden:
  1. `select public.borrar_datos_ejemplo();` y borrar los envíos de prueba reales
     (`delete from public.aportes where es_ejemplo = false;`), porque un saber con respuestas
     no se puede borrar y quedaría colgado del catálogo viejo
  2. ejecutar `sql/03_funciones.sql` (trae `cargar_contenidos`), después
     `sql/07_cargar_catalogo.sql` y después cada `sql/08_cargar_contenidos_N.sql`.
     Van separados porque el SQL Editor rechaza las consultas de más o menos un
     mega: "Query is too large to be run via the SQL Editor". Cada archivo se
     puede repetir sin problema
  3. `select public.generar_datos_ejemplo();` para rehacer la demo sobre el catálogo nuevo
- **Ejecutar `sql/09_edicion_catalogo.sql`** en el SQL Editor para habilitar la edición del
  catálogo desde el panel (agrega `estado`, la auditoría y las funciones; se puede repetir)
- Crear los usuarios del dashboard en Supabase Auth y agregarlos a `equipo_planificacion`
- Prueba real con 5 o 6 docentes cargando desde sus celulares antes del 26

**Orden sugerido**: subir el catálogo nuevo a Supabase, probar el formulario en celulares
reales y crear los usuarios del panel. El sitio ya está publicado y las dos pantallas andan.
