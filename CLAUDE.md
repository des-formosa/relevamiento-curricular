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
| Catálogo curricular (áreas, espacios, ejes, saberes, contenidos sugeridos) | Supabase Storage (bucket `catalogo`), con `datos/catalogo.json` del repo como respaldo | el equipo, desde el panel: edita en la base y publica con un botón |
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
│   ├── archivo.js          exportar el catálogo a Excel/JSON e importarlo corregido
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
    ├── 10_publicar_catalogo.sql  bucket `catalogo`, registro de publicaciones
    ├── 11_importar_catalogo.sql  exportar a filas e importar correcciones
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

A diferencia del resto de la selección, **el modo no viaja en el hash**: siempre se entra por
los resultados, aunque la última vez hayas quedado editando. Se sale del editor al recargar,
al volver a entrar y al compartir un link. Editar el catálogo es algo que se elige, no un
lugar donde amanecer.

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

**Editar no publica, pero publicar es un botón.** El formulario del docente nunca lee el
catálogo de la base: eso es lo que permite que diez mil personas entren el mismo día sin
tocarla. Lee un archivo estático. «Publicar» llama a `exportar_catalogo()` (solo los activos)
y sube el JSON al bucket `catalogo` de Supabase Storage, que se sirve por CDN igual que
GitHub Pages; después anota la publicación con `registrar_publicacion()`.

El formulario pide primero `…/storage/v1/object/public/catalogo/catalogo.json` y, si no está,
falla o viene incompleto, usa `datos/catalogo.json` del repositorio. Esa caída es la red de
seguridad: el formulario nunca se queda sin catálogo. `Catalogo.origen()` dice cuál cargó.
El `cacheControl` es de cinco minutos, así que una corrección tarda eso en verse; quien ya
estaba cargando termina con el catálogo que bajó al entrar.

La barra del editor dice en qué estado está —«hay 4 cambios sin publicar», «todo publicado
desde hace 2 horas, lo publicó fulano»— usando `estado_publicacion()`, que compara la última
publicación contra la auditoría.

### Exportar e importar (assets/archivo.js + sql/11_importar_catalogo.sql)

Corregir de a un saber en la pantalla sirve para un arreglo suelto. Una revisión completa se
hace en Excel: se lee de corrido y se reparte entre varias personas. El botón «Exportar e
importar» de la barra del editor cubre las dos direcciones del mismo archivo.

**Exportar** baja el catálogo como Excel (`catalogo_filas()`), de esta materia y año o
completo: una fila por contenido, con `eje_id`, `saber_id` y `contenido_id` en columnas y el
estado de cada uno. También baja el JSON (`exportar_catalogo()`), que es el respaldo para
`datos/catalogo.json` y no se corrige a mano.

**Importar** acepta ese mismo Excel corregido o un `catalogo.json`; el navegador deja las dos
cosas en la misma forma de filas y `importar_catalogo()` hace el resto. Cuatro reglas:

1. **Ausencia no es baja.** Lo que el archivo no menciona no se toca. El Excel que revisa el
   equipo tiene menos saberes que el catálogo, así que un importador que archivara lo que
   falta borraría media Resolución sin que nadie se entere. Para archivar hay que escribirlo
   en la columna «estado».
2. **Un saber se resuelve una sola vez**, aunque venga en muchas filas. Como el archivo trae
   una fila por contenido, un saber con cinco contenidos aparece cinco veces con su texto
   repetido. Si se tomara fila por fila, corregirlo en una sola dejaría el texto yendo y
   viniendo. Primero se junta lo que el archivo dice de cada saber; si dos filas se
   contradicen, se avisa y no se aplica nada.
3. **Primero se mira.** Con `p_aplicar` en false devuelve el resumen sin escribir: «1 saber
   corregido, 1 contenido nuevo». La pantalla lo muestra con ejemplos del antes y el después,
   y recién ahí ofrece confirmar.
4. **Todo o nada.** Una fila con problemas cancela la importación entera, y el panel dice
   cuáles son y por qué.

Escribe llamando a `guardar_saber`, `guardar_contenido` y `archivar_catalogo`, las mismas del
panel: valen sus validaciones y cada cambio queda en la auditoría con la nota «Importado de
\<archivo\>». Importar tampoco publica: después hay que tocar «Publicar».

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
- Proyecto de Supabase "Relevamiento Curricular" (región sa-east-1, São Paulo) con el SQL del
  `01` al `10` aplicado, escuelas y catálogo nuevo cargados, y datos de ejemplo
  (`es_ejemplo = true`). `assets/supabase.js` ya apunta al proyecto: lo que se envíe desde el
  formulario se guarda de verdad
- **Catálogo curricular terminado** (22/09/2026): las 16 materias transcritas a mano contra el
  PDF. 942 saberes con trimestre asignado y 45 ejes reales, en `datos/catalogo.json`. Todos
  `calidad: buena`, ninguna combinación materia/año vacía
- El SQL se puede probar entero fuera de Supabase: alcanza con un PostgreSQL 16 y un
  andamiaje mínimo (roles `anon`/`authenticated`, `auth.users`, `auth.uid()` leyendo
  `request.jwt.claim.sub`, y los esqueletos de `storage.buckets` y `storage.objects`).
  Con eso corren del `01` al `11` sin tocar nada
- **Contenidos sugeridos reescritos** (22/09/2026): 4.716, cinco por saber, escritos por el
  equipo porque los de la transcripción eran recortes del texto del saber. `origen:
  "propuesto_equipo"`. Fuente editable en `datos/contenidos/`
- **Edición del catálogo desde el panel** (22/09/2026): `sql/09_edicion_catalogo.sql` y
  `assets/editor.js`. Editar, agregar y archivar saberes y contenidos, con historial de
  cambios. Probado con un cliente simulado; falta correr el SQL en Supabase y probarlo con
  un usuario del equipo
- **Publicar con un botón** (22/09/2026): `sql/10_publicar_catalogo.sql` sube el catálogo al
  bucket `catalogo` de Storage y el formulario lo lee de ahí, con el JSON del repositorio
  como respaldo. Probado con un cliente simulado: sube 1,2 MB, muestra los cambios sin
  publicar, cae al repositorio si el bucket no está o el archivo viene roto
- **Exportar e importar el catálogo** (22/09/2026): `sql/11_importar_catalogo.sql` y
  `assets/archivo.js`. El catálogo baja como Excel, vuelve corregido y se aplica cruzando por
  id, con resumen previo. Probado contra PostgreSQL 16 local con el catálogo real (942
  saberes, 4.716 contenidos): reimportar el archivo entero sin tocarlo da cero cambios y no
  archiva nada; un saber corregido en sus cinco filas genera una sola edición y una sola
  entrada de auditoría; corregido en una sola fila, se rechaza por contradictorio
- **Recorrido guiado del panel** (`assets/tour.js`): diez pasos para leer los resultados y
  ocho para editar el catálogo. Arranca solo la primera vez y se repite desde «¿Cómo se usa?»
- Dashboard completo (`dashboard.html` + `assets/dashboard.js` + `assets/tablero.css`):
  ingreso con Supabase Auth, chequeo de `equipo_planificacion`, Detalle, Mapa de calor,
  datos de ejemplo, exportar a Excel y PDF
- **Usuarios del panel creados** (22/09/2026): el equipo técnico, más de diez personas, ya
  entra al dashboard. Hay docentes probando el formulario y devolviendo comentarios; las
  mejoras que salen de ahí se van aplicando
- Listado de escuelas: 81 E.P.E.S. en 9 departamentos, en `datos/escuelas.json`
- Modelo de datos definido
- Diseño de pantallas (en Claude Design, en paralelo)
- Publicado en GitHub Pages bajo la organización `des-formosa`:
  https://des-formosa.github.io/relevamiento-curricular/ (formulario) y
  https://des-formosa.github.io/relevamiento-curricular/dashboard.html (panel)

**Pendiente**
- **Ejecutar `sql/11_importar_catalogo.sql`** en el SQL Editor, después del 09 y el 10:
  habilita «Exportar e importar» en el panel. Se puede repetir
- Prueba real con 5 o 6 docentes cargando desde sus celulares antes del 26

**Orden sugerido**: correr el `11`, probar el formulario en celulares reales y seguir juntando
el feedback del equipo. El sitio está publicado, los usuarios del panel están creados y el
equipo técnico ya lo está usando.
