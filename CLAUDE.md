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
| Escuelas y departamentos | `datos/escuelas.json` en el repo, generado del Excel oficial | nadie desde la app |
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
├── planillas/              las planillas base por materia (no se versionan: se generan del panel)
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
│   ├── catalogo.json       848 saberes, 4.273 contenidos sugeridos
│   ├── contenidos/         contenidos propuestos por materia + aplicar.py
│   ├── priorizados/        saberes priorizados del equipo (Lengua, Matemática) + convertir.py
│   ├── contenidos_672_originales.json   los recortes que traía la transcripción
│   ├── Nomina de Escuelas por Departamentos.xlsx   nómina oficial, la fuente
│   ├── generar_escuelas.py  el .xlsx → escuelas.json
│   └── escuelas.json       288 unidades educativas, 9 departamentos
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
    ├── 11_importar_catalogo.sql  exportar a filas e importar correcciones por id
    ├── 12_reemplazar_materia.sql  subir la planilla de una materia y reemplazarla
    ├── mantenimiento/      scripts de una sola vez, con fecha; no forman parte de la instalación
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
en tres tramos, uno por trimestre. Antes de cada uno, la lista de sus saberes para destildar
los que no trabaja (ver «Pantalla 7»), y el progreso contado sobre lo que quedó marcado
(«Saber 3 de 7»). Un tramo sin saberes visibles se salta solo.

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

**6. El orden de los saberes lo decide el equipo, no el eje.**
Dentro de cada trimestre, los saberes van en el orden en que los puso el equipo: es el ciclado
de la materia, y lo armaron así a propósito. En Matemática la grilla intercala ejes (tres de
Geometría, después dos de Números), así que ordenar por eje lo desarmaba. `saberes.orden` es
la **posición del saber dentro de su año y trimestre**, y solo se compara ahí adentro. Lo usan
igual el formulario (lista del trimestre y recorrido), el panel (Detalle y numeración), el
editor, la planilla y la exportación. El Mapa de calor sigue con una fila por eje, en el orden
del diseño, porque su pregunta es por eje.

Para las 14 materias de la Resolución se numeró de corrido el orden que ya se veía (por eje);
en Lengua y Matemática sale de la fila de la grilla (`convertir.py`). Los id **no** cambiaron:
se siguen contando por eje, como cuando se cargaron.

### Saberes priorizados (Lengua y Matemática)

El 23/09/2026 el equipo técnico rehízo **Lengua y Matemática** con los saberes que priorizó el
Ministerio. Reemplazan a los de la Resolución en esas dos materias: Lengua pasa de 106 a 132
saberes (830 contenidos) y Matemática de 172 a 52 (117 contenidos). Las otras 14 materias no
cambian.

El equipo no trabaja en nuestro formato: arma una **grilla** en Excel. Obligarlos a pasar por
el importador del panel fue lo que no funcionó («me los carga pero los pone como la app
quiere, no como yo lo hago»): el archivo traía los `saber_id` vacíos, y para el importador eso
es alta, así que los sumaba al lado de los viejos en vez de reemplazarlos. Por eso
`python datos/priorizados/convertir.py` (`--revisar` no escribe) lee las grillas tal como
vienen:

- **Lengua** (`Saberes priorizado.xlsx`): un bloque por año, una fila por eje, una columna por
  trimestre. El eje se toma del romano («Eje II:»), no del nombre, porque en 1° dice «Lectura y
  Producción no escrita» (errata) y en 3° el nombre viene partido en dos filas. Una celda que
  arranca en minúscula es la continuación de la de arriba. Los contenidos vienen en otro
  archivo (`Lengua contenidos v3.xlsx`, una fila por contenido) y se cruzan por texto del
  saber, año y trimestre: los 132 coinciden.
- **Matemática** (`PRIORIZACIÓN DE SABERES-CBS.xlsx`): un bloque por trimestre, un par de
  columnas saber/contenidos por año. **La grilla no dice el eje de cada saber**: cada bloque
  nombra dos ejes juntos («Geometría y medida - Números y operaciones»). Si el saber coincide
  con uno de la Resolución, se toma su eje (48 de 52). Si no, lo elige el script por palabras
  clave (4) y queda marcado en `revision.md` para que el equipo lo confirme. Los contenidos se
  parten donde el equipo separó la lista (saltos de línea, barras con espacio, puntos), y lo
  que queda de menos de tres palabras se une al anterior para no repetir los recortes sueltos
  de la transcripción original.
- `contenidos_agregados.json`: contenidos para saberes que llegaron sin ninguno. Hoy, uno de
  Matemática cuya celda estaba vacía.

Los id nuevos llevan `--pr-` para no reusar nunca el de un saber viejo: si el primer saber
priorizado heredara `lengua--e1--a1s1`, las respuestas de ese id se contarían para un saber que
dice otra cosa. Los viejos salen del JSON y `cargar_catalogo()` los borra si nadie los usó o los
archiva si tienen respuestas. De paso limpia lo que haya entrado duplicado por el importador.

**Los id salen de la posición en la grilla.** Hasta que arranque la carga real el script se
puede correr las veces que haga falta. Después no: reordenar la grilla movería los id y con
ellos las respuestas. El orden (`saberes.orden`) también sale de la grilla, de arriba abajo
dentro de cada año y trimestre; si después del 26 hay que reordenar, se hace desde el editor o
con la planilla, no volviendo a correr el script.

Ojo al volver a correrlo: compara contra los saberes que ya están en el catálogo, que ahora son
los priorizados, así que `revision.md` sale sin la lista de ejes dudosos. Si hace falta, se
restaura con `git checkout datos/priorizados/revision.md`.

### Regenerar el catálogo

El equipo de Planificación está revisando un Excel con los 831 saberes y sus contenidos. Cuando
devuelvan las correcciones hay que regenerar `datos/catalogo.json` a partir de ese archivo. El
`id` de cada saber es estable, así que las correcciones se aplican por id sin romper nada.

---

## La nómina de escuelas

Sale de **«Nomina de Escuelas por Departamentos.xlsx»** (Hoja1), la planilla oficial del
Ministerio, y se vuelca con `python datos/generar_escuelas.py` (`--revisar` informa sin
escribir). Cuando llegue una nómina nueva, se reemplaza el .xlsx y se corre el script; no se
edita `escuelas.json` a mano.

Son **288 unidades educativas**: 113 E.P.E.S. (95 comunes, 12 E.I.B. y 6 agrarias) y 175
anexos —rurales, de Educación Intercultural Bilingüe y agrarios—. Los anexos están porque el
docente que trabaja en uno tiene que poder encontrarlo: son más de la mitad de la nómina.

**Los `id` no pueden moverse**, porque quedan escritos en los aportes. Por eso:

- se arman del nombre, no del CUE: hay cinco CUE repetidos en la planilla;
- un nombre que aparece más de una vez («San Isidro» está tres veces) lleva el CUE **en todas
  sus apariciones**, contado de antemano. Si el desempate dependiera de cuál se procesa
  primero, reordenar la planilla intercambiaría dos escuelas y sus aportes;
- los patrones `epes-N` / `epes-eib-N` / `epes-agraria-N` valen solo para la escuela
  cabecera. Sus anexos llevan «ANEXO» en el nombre y van por el camino genérico: si no, los
  nueve anexos de la Agraria N° 2 terminarían con el mismo id.

**El CUE no entra en el índice de búsqueda.** Son nueve dígitos: con él adentro, buscar «41»
devolvía cualquier escuela que tuviera 41 en el medio del CUE. Sí entran las dos formas de la
sigla, así que «epes 41» y «e.p.e.s. 41» encuentran lo mismo.

La lista se ordena por el **orden de la nómina**, que deja cada E.P.E.S. seguida de sus
anexos. Ordenar por número no sirve: 175 escuelas no tienen.

### Lo que cambió respecto de la lista anterior

La lista vieja tenía 81 escuelas y **no coincidía con la oficial**: de las 74 que están en
ambas, 31 figuraban en otro departamento y 65 en otra localidad. Como el dashboard filtra por
departamento, todos los reportes departamentales anteriores a este cambio estaban mal. Manda
la planilla del Ministerio.

Consecuencias que conviene tener presentes:

- **Siete E.P.E.S. ya no están en la nómina**: 5, 24, 75, 79, 85, 86 y 104. `cargar_escuelas`
  no las borra de la base —haría fallar un aporte que las referencie—, pero dejan de
  ofrecerse al docente porque el formulario lee el JSON. En la base quedan con
  `escuelas.vigente = false`: `cargar_escuelas` marca así toda escuela oficial que no venga en
  la nómina, y los datos de ejemplo no las usan.
- **Se perdieron 13 denominaciones** («Lethbridge», «Scalabrini Ortiz»…) porque la planilla
  oficial no trae nombres propios. Están en el historial de git, en la versión anterior de
  `datos/escuelas.json`, por si el equipo quiere reponerlas con una fuente confiable.

---

## Flujo del docente

Nueve pantallas, una decisión por pantalla. **Sin login, sin registro, sin contraseñas.**
Todas tienen «Volver», también en escritorio, salvo la bienvenida, que es la primera. En la
confirmación, «Volver» abre «Lo que enviaste»: el resumen de la materia recién mandada, con
«Enviar de nuevo» (reemplaza el envío anterior, por la `clave`). Si vuelve sin reenviar, vale
lo que ya había mandado.

Se usa desde el celular tanto como desde la computadora: diseñar mobile-first.

| # | Pantalla | Notas |
|---|---|---|
| 1 | Bienvenida | qué es, para qué sirve, cuánto tarda (~10 min) |
| 2 | Nombre y apellido | dos campos |
| 3 | Escuela | buscador sobre lista cerrada de 288, agrupada por departamento; enlace discreto "no encuentro mi escuela" que permite escribirla |
| 4 | Año | 1°, 2° o 3°; respetar `anios_dictados` |
| 5 | Área | seis opciones |
| 6 | Espacio curricular | filtrado por área |
| 7 | Carga de contenidos | **la pantalla crítica**, ver abajo; antes de cada trimestre, la lista de sus saberes para destildar |
| 8 | Resumen y chequeo | todo lo cargado, agrupado por trimestre, editable; si quedan saberes sin revisar no deja enviar. En escritorio, los tres trimestres lado a lado bajan con la página (una sola barra de desplazamiento, como el panel) y el botón de enviar está una sola vez, al final, como en el celular |
| 9 | Confirmación | "¿cargás otra materia?" → [misma escuela] [otra escuela] [terminé] |

Cuando un área tiene un solo espacio (Matemática) la pantalla 6 se salta; Educación Artística
muestra sus cuatro lenguajes agrupados en una tarjeta. Las dos cosas salen del catálogo, no
están escritas a mano. Si una materia y año no tienen saberes visibles (hoy: Educación Física
1°, entre otros), se muestra un aviso y se ofrece elegir otra materia u otro año.

### Pantalla 7 — carga de contenidos

**Primero, la lista del trimestre.** Antes de cada tramo aparecen todos sus saberes, en el
orden del equipo, como casillas **ya tildadas** (los seguidos del mismo eje van bajo un título;
si los ejes se intercalan, el eje va dentro de cada casilla): el docente destilda los que no trabaja y toca «Seguir
con los 11». Es más rápido que llegar a cada saber y tocar «No trabajo este saber», y en
Matemática o Lengua, con 20 saberes por trimestre, es lo que hace que no abandone. Arrancan
tildadas porque lo esperable es que trabaje la mayoría: destildar es la excepción.

Lo destildado queda como «no trabajo» (`noTrabajado: true, desdeLista: true` en el borrador)
y **no se recorre**: el progreso («Saber 3 de 11») y la lista lateral de escritorio cuentan
solo lo marcado. Se puede volver a tildar desde la lista (con «Volver» desde el primer saber)
o desde el resumen. Un saber marcado como «no trabajo» con el botón, en cambio, sigue en el
recorrido: lo decidió mirándolo, y ahí tiene que poder cambiarlo.

**Después, un saber por vez.** Arriba, el eje y el texto completo del saber, bien legible.
Abajo, **las sugerencias de ese saber a la vista, como casillas** («Tocá los que trabajás.
Podés elegir varios.»): tocar tilda, volver a tocar destilda. Con cinco sugerencias por saber,
completar un trimestre largo es tocar y seguir, sin escribir.

Van en el orden en que las escribió el equipo, **ninguna viene tildada y no se ordenan por
lo que más eligieron otros**: cualquiera de las dos cosas empujaría al docente hacia una
respuesta y el relevamiento mediría la sugerencia, no lo que se enseña.

Debajo, el campo «¿Trabajás otro que no está en la lista?». Sigue buscando en las sugerencias
del saber mientras se escribe, y si lo que escribe no aparece, lo agrega con «Agregar como
está». Esos contenidos se guardan con `tipo = 'libre'` y se ven como fichas aparte, marcadas
distinto. Si el saber no tiene sugerencias, el campo es lo único y vuelve a su texto original.

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

**El nombre del sistema** es «Aplicación web de Relevamiento y Sistematización Curricular de la
Provincia de Formosa» (`NOMBRE_SISTEMA` en `dashboard.js`): va completo en el ingreso y en el
inicio; en la cabecera y en el título de las pestañas, «Relevamiento y Sistematización
Curricular».

**Al entrar, un inicio** (24/09/2026, lo pidió el equipo: «algo más cómodo de recibir antes de
usarlo»). La primera versión tenía de más —saludo enorme, estado del catálogo, cuatro consejos—
y el equipo la sintió cargada. Quedó: «Hola, Ana» chico, el nombre del sistema como título
(«Relevamiento y Sistematización Curricular» grande, con «Aplicación web de» arriba y «de la
Provincia de Formosa» abajo), una línea de cómo va la carga y los dos caminos: «Ver los
resultados» y «Editar el catálogo». Desde el panel se vuelve con «Inicio». **Un link
compartido** (con `materia=` en el hash) no pasa por el inicio: va directo a lo que muestra.
Salir borra el hash, así el que entra después arranca por el inicio.

En la cabecera, «Inicio», «¿Cómo se usa?» y «Salir» son enlaces sin recuadro (`.t-enlace-cab`);
solo «Editar catálogo» y «Datos de ejemplo» son botones. Con cinco controles con recuadro la
cabecera se partía en dos filas a 1366 y 1920 px.

**Después, es prácticamente una sola pantalla:**

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

   El equipo manda lo exportado a los profesores para que confirmen o corrijan, así que
   **se exporta la currícula de la materia, no la pantalla**. El Excel de «lo que estoy
   viendo» es una sola hoja, *Trimestre · Saber · Eje · Contenido priorizado · % de docentes ·
   Observaciones*: el saber una vez y debajo sus contenidos, sin conteos ni columnas técnicas,
   y «Observaciones» vacía para que anoten. El PDF es un documento aparte
   (`documentoImpresion()`), invisible en pantalla: A4 vertical, un trimestre por página, cada
   saber con sus contenidos, una barra fina y el porcentaje. «Todo el relevamiento» perdió los
   ids y números de orden; ojo que trae nombre y apellido de cada docente: no es para repartir.

   Una tercera opción, **«La currícula de [materia]»**, exporta el catálogo sin resultados:
   todos los años, *Año · Trimestre · Eje · Saber · Contenido · Observaciones*, para que el
   equipo lo revise con un profesor. Sale de la base (`catalogo_filas`), así que incluye lo
   editado aunque no esté publicado. En PDF, un año por página y los contenidos como lista.

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

**Lo archivado no se muestra salvo que se pida.** Al principio el editor lo mostraba en gris
junto a lo activo. Después de reemplazar Lengua y Matemática, los saberes viejos quedaron
mezclados con los nuevos y el equipo pidió «eliminar lo viejo»: la base ya lo tenía archivado,
pero en pantalla parecía que no. Ahora arriba de la lista hay un «Ver lo archivado (N)» que
lo muestra para poder recuperarlo, y el aviso al archivar dice que quedó ahí.

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

**El orden se cambia con flechas.** El editor muestra los saberes por trimestre, cada uno con
su lugar («3 de 12») y flechas para subirlo o bajarlo un lugar (`mover_saber()`). En el
historial queda una sola línea por movimiento, con acción `orden` («Pasó del lugar 4 al 3 del
1er trimestre»): el vecino que cede su lugar y la renumeración no se anotan. Un saber nuevo, o
uno que cambia de trimestre, va al final del trimestre (`ultimo_orden()`).

**El historial dice dónde fue cada cambio** («Matemática · 1° año · 1er trimestre · contenido») y
se filtra por materia, año y trimestre. Desde «Ver historial» arranca en la materia y el año que
se están mirando; desde el reloj de un saber, solo ese saber. `historial_catalogo()` toma la
materia del eje del saber (o del saber del contenido).

La barra del editor dice en qué estado está —«hay 4 cambios sin publicar», «todo publicado
desde hace 2 horas, lo publicó fulano»— usando `estado_publicacion()`, que compara la última
publicación contra la auditoría.

### La planilla de la materia (assets/archivo.js + sql/12_reemplazar_materia.sql)

El equipo técnico no maneja ids ni formatos: trabaja en Excel y apenas. La primera versión del
importador pedía el Excel con una fila por contenido y los ids en columnas; cuando el equipo
rehízo Lengua en un Excel sin ids, el importador **sumó** los 132 saberes nuevos al lado de los
106 viejos, porque para él una fila sin id es un alta. El botón existía pero no servía.

Ahora el botón «Exportar e importar» de la barra del editor da **la planilla de la materia**:
una fila por saber, con las columnas *Año · Trimestre · Eje · Saber · Contenido 1, 2, 3… ·
Código (no tocar)*, ya completa con lo que hay hoy, y una segunda hoja que explica cómo
completarla en palabras del equipo. Se corrige en Excel y se sube acá mismo. Subirla
**reemplaza la materia** con `reemplazar_materia()`, con estas reglas:

1. **Solo los años que vienen en el archivo.** Si la planilla trae solo 1° año, 2° y 3° no se
   tocan. Un archivo parcial no puede vaciar la materia. Pero **dentro de un año que viene, lo
   que no está se archiva**: la hoja de instrucciones y la vista previa lo dicen en negrita.
2. **Lo que no cambió conserva su identidad**, y con ella sus respuestas. Un saber se reconoce
   por su código; si no lo tiene, por el mismo texto en el mismo año (primero el del mismo
   trimestre, porque el mismo texto puede estar en dos: pasa en Matemática 3°); y si no, por un
   texto casi igual (parecido ≥ 0,8 en el mismo eje y año), que es una corrección. Los
   contenidos igual: mismo texto, o parecido ≥ 0,6 dentro del mismo saber. Sin esto, corregir un
   tipeo después del 26 dejaría las respuestas colgadas de un saber archivado y el panel
   mostraría cero.
3. **Lo que sale se archiva** con sus respuestas, y vuelve con su mismo id si una planilla
   posterior lo trae de nuevo.
4. **Primero se mira, y todo o nada.** La vista previa dice «Así va a quedar Lengua: se
   reemplazan 1°, 2° y 3° año · 50 saberes quedan igual · 1 corregido · 1 nuevo · 1 sale», con
   ejemplos del antes y el después. Una fila con problemas —año que la materia no dicta,
   trimestre fuera de 1 a 3, eje que no es de la materia, código de otra materia— cancela todo,
   y la pantalla dice cuál es y por qué.

5. **El orden de las filas es el orden de los saberes** dentro de cada año y trimestre. Se
   compara el orden relativo, no el número: bajar y subir sin tocar no cambia nada aunque haya
   huecos por algo archivado. Si cambia, la vista previa dice «1 trimestre cambia el orden de sus
   saberes» y con qué saber empieza. La hoja de instrucciones explica cómo mover una fila y avisa
   que ordenar con el filtro por otra columna desarma el orden.

El eje se acepta como lo escriba el equipo: su id, «EJE II», «Eje II: Lectura…», «2» o el
nombre sin el número («Literatura») — `eje_desde_texto()`. El importador también entiende un
Excel con **una fila por contenido** (como el que armó el equipo para Lengua): junta las filas
del mismo saber. Si el archivo trae una columna «Materia» y no coincide con la materia elegida
en el panel, avisa antes de tocar nada.

Si el archivo trae la columna `saber_id` completa, es el Excel de correcciones de antes
(`importar_catalogo()`, sql/11): corrige por id y lo que no menciona no se toca. Se sigue
aceptando, pero ya no se ofrece. El JSON se sigue pudiendo bajar como respaldo del repositorio.

Escribe con `guardar_saber`, `guardar_contenido` y `archivar_catalogo`: valen sus validaciones
y cada cambio queda en la auditoría con la nota «Planilla «archivo»». Subir no publica: después
hay que tocar «Publicar».

`planillas/` tiene las 16 planillas generadas con el mismo código del panel, para repartir.
No se versionan: se desactualizan en cuanto alguien edita, y el panel las genera al día.

Las funciones del panel (`catalogo_editar`, `guardar_saber`, `guardar_contenido`,
`archivar_catalogo`, `historial_catalogo`, `exportar_catalogo`) son `security definer` y
verifican `es_equipo()`: el dashboard nunca escribe en las tablas directamente, igual que el
formulario solo entra por `registrar_aporte`.

### El recorrido guiado (assets/tour.js)

Son veinte personas que entran cada tanto, no todos los días. En vez de un instructivo que
nadie lee, el panel se explica solo: ilumina una parte de la pantalla y dice qué mira, con
«Saltar», «Anterior» y «Siguiente». Diez pasos para leer los resultados y once para editar el
catálogo (el último agregado: el orden de los saberes).

Arranca solo la primera vez que se entra a cada pantalla (queda anotado en `localStorage`,
claves `relevamiento.tour.<modo>.<versión>`) y se vuelve a ver desde «¿Cómo se usa?» en la
cabecera. Cuando cambia algo que el equipo ya había visto explicado, se sube `VERSION` en
`tour.js` y el recorrido le vuelve a aparecer solo una vez a todos. Los
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
- **Registro de documento, no de app.** Esquinas casi rectas (3 px), filetes en vez de
  sombras, barras de porcentaje rectangulares, casillas en vez de interruptores, solapas
  subrayadas en vez de segmentados. Es un programa de un ministerio y tiene que parecerlo.
  Lo que separa bloques es el espacio en blanco, no una línea ni una banda de color más: la
  primera versión de esta pasada agregó tinta para dar orden y quedó más cargada, no más
  clara. En el formulario cambia la piel, nunca las medidas: los 68 px de botón y la
  tipografía grande son el requisito de usarlo con sol en un celular viejo.
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
  `01` al `12` aplicado (23/09/2026, con Lengua y Matemática priorizadas), escuelas y catálogo nuevo cargados, y datos de ejemplo
  (`es_ejemplo = true`). `assets/supabase.js` ya apunta al proyecto: lo que se envíe desde el
  formulario se guarda de verdad
- **Catálogo curricular terminado** (22/09/2026): las 16 materias transcritas a mano contra el
  PDF. 942 saberes con trimestre asignado y 45 ejes reales, en `datos/catalogo.json`. Todos
  `calidad: buena`, ninguna combinación materia/año vacía
- **La planilla de la materia** (23/09/2026): `sql/12_reemplazar_materia.sql` y
  `assets/archivo.js`. El equipo baja la planilla de una materia, la corrige en Excel y la sube;
  el panel muestra cómo va a quedar y reemplaza. Probado contra PostgreSQL 16 con el catálogo
  real: bajar y subir sin tocar no cambia nada; medio 1° año archiva esa mitad y deja 2° y 3°
  intactos; volver a subir la completa restaura los mismos ids; un tipeo en un saber con
  respuestas conserva id y respuestas; reescribirlo entero entra como nuevo y archiva el viejo
  con su respuesta. Probado en el navegador de punta a punta, incluido el Excel del equipo para
  Lengua (una fila por contenido), que ahora entra sin duplicar
- **Lengua y Matemática, solo lo priorizado** (23/09/2026):
  `sql/mantenimiento/2026-09-23_solo_priorizados.sql` archiva en esas dos materias todo lo que no
  sea un saber priorizado (`--pr-`), con sus contenidos. Probado simulando lo que podía haber en
  producción: saberes viejos activos, uno con respuesta y un duplicado del importador. Quedan
  132 y 52 activos, todos priorizados; la respuesta se conserva; la segunda corrida no hace nada
- **Matemática, lo que la grilla no aclaraba, decidido** (23/09/2026). El equipo no llegó a
  responder, así que quedó como mejor cierra, y se corrige desde el editor si hace falta:
  - los 4 saberes sin eje claro (lista en `datos/priorizados/revision.md`) quedan donde los
    puso el script: ecuaciones en Álgebra, los dos de gráficos en Estadística, números enteros
    en Número y operaciones;
  - «Resolución de problemas de varios pasos…» sigue en los tres trimestres de 3° año. Cada
    aparición trae contenidos distintos: parece un saber que vuelve con más profundidad, y
    unificarlo perdería contenidos del equipo
- **Datos de ejemplo al día con el catálogo** (23/09/2026): los del 22/09 se habían generado
  con Lengua y Matemática viejas, y con esas materias rehechas el panel las mostraba vacías en
  «Datos de ejemplo». Además la función no miraba el `estado`, así que regenerarlos tal cual
  les habría inventado respuestas a saberes y contenidos archivados, y podía ubicar docentes en
  las 7 escuelas que salieron de la nómina. Ahora `generar_datos_ejemplo()` usa solo lo activo y
  solo escuelas vigentes. Probado: 1.500 docentes, 2.623 aportes, cero respuestas en lo
  archivado, cero en escuelas no vigentes; el panel muestra Lengua 1° con 48 saberes y
  Matemática 1° con 16, todos con barras. **Cada vez que cambie el catálogo hay que volver a
  generarlos**
- **Los SQL se instalan desde cero en orden** (23/09/2026): corriendo del `01` al `12` en una
  base vacía, el `07` fallaba porque `cargar_catalogo()` usa la columna `estado` que creaba el
  `09`. Ahora la crea el `01`. Verificado: los trece archivos pasan en orden y se pueden
  repetir encima
- **Lengua y Matemática con los saberes priorizados** (23/09/2026): 132 y 52 saberes, 830 y
  117 contenidos, leídos de las grillas del equipo con `datos/priorizados/convertir.py`. El
  catálogo queda en 848 saberes y 4.273 contenidos. Probado cargándolo en PostgreSQL local:
  los viejos quedan archivados con sus respuestas y no queda ningún duplicado activo
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
  once para editar el catálogo. Arranca solo la primera vez y se repite desde «¿Cómo se usa?»
- Dashboard completo (`dashboard.html` + `assets/dashboard.js` + `assets/tablero.css`):
  ingreso con Supabase Auth, chequeo de `equipo_planificacion`, Detalle, Mapa de calor,
  datos de ejemplo, exportar a Excel y PDF
- **Usuarios del panel creados** (22/09/2026): el equipo técnico, más de diez personas, ya
  entra al dashboard. Hay docentes probando el formulario y devolviendo comentarios; las
  mejoras que salen de ahí se van aplicando
- **Nómina oficial de escuelas** (23/09/2026): 288 unidades educativas en 9 departamentos,
  generadas del Excel del Ministerio con `datos/generar_escuelas.py`. Probado en el
  navegador: buscar «41», «epes 41», «e.p.e.s. 41», «corralito» y «clorinda» devuelve lo que
  corresponde, el orden respeta la nómina y se puede cargar una materia eligiendo un anexo.
  `normalizar_texto()` de PostgreSQL da idéntico a `normalizarTexto()` de JS en los 295
  nombres
- Modelo de datos definido
- Diseño de pantallas (en Claude Design, en paralelo)
- Publicado en GitHub Pages bajo la organización `des-formosa`:
  https://des-formosa.github.io/relevamiento-curricular/ (formulario) y
  https://des-formosa.github.io/relevamiento-curricular/dashboard.html (panel)

- **El orden de los saberes es el del equipo** (24/09/2026): el formulario, el panel, el editor,
  la planilla y la exportación ordenan por `saberes.orden` (posición en el año y trimestre), no
  por eje. Lengua y Matemática toman el orden de las grillas. El editor mueve saberes con
  flechas (`mover_saber()`, una línea `orden` en el historial) y la planilla toma el orden de sus
  filas. Recorrido del editor en `v3`, con un paso sobre el orden. Probado contra PostgreSQL 16:
  mover arriba y abajo, bordes, archivado rechazado, alta y cambio de trimestre al final, planilla
  sin tocar = cero cambios, fila movida = «cambia el orden» y se aplica, saber nuevo entra en su
  fila; instalación desde cero del `01` al `12` más el script de mantenimiento. En el navegador:
  la lista y el recorrido de Matemática 1° siguen la grilla, el Mapa de calor mantiene los ejes
  en orden, el panel refleja lo movido
- **«Volver» en todas las pantallas del docente** (24/09/2026): en escritorio la carga y el
  resumen lo escondían; la confirmación no tenía. Ahora vuelve a «Lo que enviaste»

**Pendiente**
- **Correr `sql/09_edicion_catalogo.sql`** otra vez (24/09/2026): trae el historial con materia,
  año y trimestre, y sus filtros (sin eso, «Ver historial» da error), y el conteo de respuestas
  del editor sin los datos de ejemplo: antes mostraba «66 respuestas» inventadas y confundía.
  También `sql/10_publicar_catalogo.sql`: el historial y «lo publicó…» muestran el nombre cargado
  en `equipo_planificacion.nombre` (si está vacío, el mail)
- **El orden de los saberes en la base**, en el SQL Editor y en este orden (el `09` redefine
  `panel_resultados()` del `04`, así que va después): `sql/04_vistas.sql`,
  `sql/09_edicion_catalogo.sql`, `sql/11_importar_catalogo.sql`, `sql/12_reemplazar_materia.sql` y
  después `sql/mantenimiento/2026-09-24_orden_de_los_saberes.sql`. El control del final muestra
  una fila por materia y tiene que decir «sí» en todas. Después, **Publicar** desde el panel.
  La primera versión del script dependía de que el `09` estuviera corrido: si no, fallaba el
  último paso y la base deshacía todo en silencio. Ahora se puede correr en cualquier orden
- **Poner al día la base y los datos de ejemplo**, en el SQL Editor y en este orden:
  1. `sql/mantenimiento/2026-09-23_solo_priorizados.sql` (si no se corrió): tiene que dar
     Lengua 132 activos y Matemática 52, todos priorizados
  2. `sql/01_esquema.sql`, `sql/03_funciones.sql` y `sql/05_datos_ejemplo.sql`
  3. `sql/06_cargar_escuelas.sql`: marca las 7 escuelas que ya no están (`no_vigentes: 7`)
  4. `select public.generar_datos_ejemplo();` — borra los ejemplos viejos y arma los nuevos
- Prueba real con 5 o 6 docentes cargando desde sus celulares antes del 26

**Orden sugerido**: la base está al día (SQL del `01` al `12` aplicado). Falta correr el script
de mantenimiento, probar el formulario en celulares reales y seguir juntando lo que devuelvan
los docentes.
