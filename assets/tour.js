/* ============================================================================
   Tour del panel — la explicación que no hay que dar dos veces.

   El equipo de Planificación entra al panel cada tanto, no todos los días, y
   no son perfiles técnicos. Este recorrido señala cada parte de la pantalla y
   dice qué mira: primero cómo leer los resultados, y con el mismo formato cómo
   editar el catálogo.

   Aparece solo la primera vez (queda anotado en el navegador) y se puede
   volver a ver desde «¿Cómo se usa?» en la cabecera. Siempre se puede saltear.

   Vive fuera de #app: el panel se redibuja entero en cada acción y se lo
   llevaría puesto.
   ============================================================================ */

const Tour = (function () {
  'use strict';

  const CLAVE = 'relevamiento.tour.';
  // Subir la versión hace que el recorrido vuelva a aparecer solo una vez a
  // todos: se usa cuando cambia algo que el equipo ya había visto explicado.
  const VERSION = 'v5';

  let capa = null;
  let pasos = [];
  let indice = 0;
  let modoActual = null;
  let alTerminar = null;

  /* ---------- Los recorridos ---------- */

  // objetivo: selector de lo que se ilumina. Sin objetivo, la tarjeta va centrada.
  // opcional: si el elemento no está en pantalla, el paso se saltea.
  const RECORRIDOS = {
    resultados: [
      {
        titulo: 'Este panel responde una sola pregunta',
        texto: 'Qué contenidos priorizan los docentes de cada saber del diseño curricular. Todo lo que ves ya está calculado: no hay que armar nada.',
      },
      {
        objetivo: '.t-selectores',
        titulo: 'Elegís qué mirar',
        texto: 'Materia, año y alcance: toda la provincia, un departamento o una escuela. Nunca queda vacío, siempre hay algo en pantalla.',
      },
      {
        objetivo: '.t-contexto__texto',
        titulo: 'Sobre cuántos está calculado',
        texto: 'Cuántos docentes y de cuántas escuelas respondieron esta materia y año. Es el respaldo de todos los números de abajo.',
      },
      {
        objetivo: '.t-vistas',
        titulo: 'Dos formas de ver lo mismo',
        texto: '«Detalle» muestra los contenidos de cada saber con su barra. «Mapa de calor» muestra los ejes del diseño por trimestre, para ver de un vistazo dónde hay consenso y qué queda flojo.',
      },
      {
        objetivo: '.t-saber',
        opcional: true,
        titulo: 'Cada tarjeta es un saber',
        texto: 'Arriba el eje y el texto tal como lo dice el diseño curricular. Abajo, los contenidos que más eligieron, de mayor a menor. Se muestran tres y el resto se abre con «ver los demás».',
      },
      {
        objetivo: '.t-saber__base',
        opcional: true,
        titulo: 'De dónde sale el porcentaje',
        texto: 'El porcentaje se calcula sobre los docentes que efectivamente trabajan ese saber, no sobre todos. No es lo mismo «18 de 163» que «18 de 22 que lo dictan».',
      },
      {
        objetivo: '.t-aviso',
        opcional: true,
        titulo: 'Cuando son pocos, no hay porcentaje',
        texto: 'Con menos de cinco docentes no mostramos porcentajes: un 67 % sobre tres respuestas engaña más de lo que informa. En su lugar dice cuántos informaron.',
      },
      {
        objetivo: '.t-interruptor',
        titulo: 'Datos de ejemplo',
        texto: 'Para mostrar el panel antes de que haya cargas reales. Son inventados y aparecen con una banda que lo aclara, así nadie los confunde con respuestas de docentes.',
      },
      {
        objetivo: '.t-exportar',
        titulo: 'Para llevarte los resultados',
        texto: '«Descargar resultados» arma el reporte de la materia: todos sus años o solo el que estás viendo. En PDF para imprimir, con gráficos de barras o mapa de calor, o en Excel para seguir trabajando.',
      },
      {
        objetivo: '[data-accion="ir-catalogo"]',
        titulo: 'Y si hay algo mal en el catálogo',
        texto: 'En «Catálogo», arriba, se corrige un saber, se agrega un contenido que falta o se saca uno que no va. También se puede rehacer una materia entera con una planilla de Excel. Cuando entres, te muestro cómo.',
      },
    ],

    catalogo: [
      {
        titulo: 'Acá se edita el diseño curricular',
        texto: 'Los saberes de la materia y el año que elegiste arriba, con sus contenidos. Todo lo que cambies queda registrado con tu nombre y la fecha.',
      },
      {
        objetivo: '.ed-nota-publicar',
        titulo: 'Editar no es publicar',
        texto: 'Lo que edites vale enseguida para los resultados, pero el docente sigue viendo el catálogo publicado. Esta línea te avisa si quedaron cambios sin publicar.',
      },
      {
        objetivo: '.ed-saber__texto',
        opcional: true,
        titulo: 'Corregir un saber',
        texto: 'El lápiz abre el texto para editarlo y también deja cambiar el trimestre. Sirve para arreglar una transcripción que quedó mal.',
      },
      {
        objetivo: '.ed-saber__flechas',
        opcional: true,
        titulo: 'El orden de los saberes',
        texto: 'Cada trimestre muestra sus saberes en el orden en que los ve el docente: «3 de 12» es el tercero. Con las flechas lo subís o lo bajás un lugar. El cambio queda en el historial y, como todo, lo ven los docentes cuando publicás.',
      },
      {
        objetivo: '.ed-fila',
        opcional: true,
        titulo: 'Los contenidos sugeridos',
        texto: 'Son las opciones que ve el docente cuando escribe. El lápiz corrige el texto; al lado se ve cuántos docentes ya lo eligieron.',
      },
      {
        objetivo: '.ed-fila .ed-icono[data-accion="ed-pedir-archivar"]',
        opcional: true,
        titulo: 'Nada se borra: se archiva',
        texto: 'Archivar saca el contenido de la lista y de lo que ve el docente, pero no lo borra: las respuestas que ya tiene se conservan. Lo archivado queda guardado en «Ver lo archivado», arriba de la lista, y desde ahí se puede recuperar.',
      },
      {
        objetivo: '.ed-agregar',
        opcional: true,
        titulo: 'Agregar lo que falta',
        texto: 'Un contenido nuevo dentro de un saber, o un saber nuevo con el botón de arriba. Los saberes nuevos arrancan activos y se publican como el resto.',
      },
      {
        objetivo: '.ed-barra [data-accion="ed-historial"]',
        titulo: 'Todo queda registrado',
        texto: 'El historial muestra cada cambio: qué decía antes, qué dice ahora, quién lo hizo y cuándo. El reloj de cada saber muestra solo los cambios de ese saber.',
      },
      {
        objetivo: '[data-accion="ar-abrir"]',
        titulo: 'Muchos cambios juntos: la planilla',
        texto: '«Cambiar con una planilla»: si hay que cambiar muchas cosas o rehacer la materia, es más fácil en Excel. Bajás la planilla de la materia, ya completa, la corregís y la subís acá mismo. El orden de las filas es el orden de los saberes.',
      },
      {
        objetivo: '[data-accion="ar-abrir"]',
        titulo: 'Antes de subirla',
        texto: 'La planilla reemplaza la materia. Si en un año falta un saber, ese saber se saca. Así que si querés corregir solo algunos, dejá los demás como están. Antes de aplicar, el panel te muestra cómo va a quedar.',
      },
      {
        objetivo: '[data-accion="abrir-revisar"]',
        titulo: 'Para revisar con un profesor',
        texto: '«Descargar para revisar» baja la currícula de la materia, todos los años, en Excel (con una columna para observaciones) o en PDF. Es para leer, no se vuelve a subir.',
      },
      {
        objetivo: '[data-accion="ed-publicar"]',
        titulo: 'Publicar, el último paso',
        texto: 'Lo que cambies acá, a mano o con la planilla, los docentes no lo ven hasta que tocás «Publicar». Los que entren después lo ven así; los que estaban cargando terminan con lo anterior, y no se pierde nada de lo que mandaron.',
      },
    ],
  };

  /* ---------- Utilidades ---------- */

  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function leido(modo) {
    try { return localStorage.getItem(CLAVE + modo + '.' + VERSION) === 'si'; } catch (e) { return true; }
  }
  function marcarLeido(modo) {
    try { localStorage.setItem(CLAVE + modo + '.' + VERSION, 'si'); } catch (e) { /* modo privado */ }
  }

  const esAngosto = () => window.matchMedia('(max-width: 899px)').matches;

  /* ---------- Pintado ---------- */

  function crearCapa() {
    if (capa) return;
    capa = document.createElement('div');
    capa.className = 'tour';
    capa.setAttribute('role', 'dialog');
    capa.setAttribute('aria-modal', 'true');
    capa.setAttribute('aria-label', 'Cómo se usa el panel');
    document.body.appendChild(capa);
    capa.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tour]');
      if (!b) return;
      if (b.dataset.tour === 'siguiente') mover(1);
      if (b.dataset.tour === 'anterior') mover(-1);
      if (b.dataset.tour === 'saltar') terminar();
    });
    window.addEventListener('resize', pintar);
    window.addEventListener('scroll', pintar, true);
    document.addEventListener('keydown', teclado);
  }

  function teclado(e) {
    if (!capa) return;
    if (e.key === 'Escape') { e.preventDefault(); terminar(); }
    if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); mover(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); mover(-1); }
  }

  function objetivoDe(paso) {
    if (!paso.objetivo) return null;
    const el = document.querySelector(paso.objetivo);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return (r.width > 0 && r.height > 0) ? el : null;
  }

  function pintar() {
    if (!capa) return;
    const paso = pasos[indice];
    if (!paso) return;
    const el = objetivoDe(paso);
    const m = 8;
    let foco = '';
    if (el) {
      const r = el.getBoundingClientRect();
      foco = `<div class="tour__foco" style="top:${r.top - m}px;left:${r.left - m}px;width:${r.width + m * 2}px;height:${r.height + m * 2}px"></div>`;
    }

    // La tarjeta va debajo del elemento, o encima si no entra. En pantallas
    // angostas queda siempre abajo, fija, como una hoja.
    let estilo = '';
    let clase = 'tour__tarjeta';
    if (!el || esAngosto()) {
      clase += el ? ' tour__tarjeta--abajo' : ' tour__tarjeta--centro';
    } else {
      const r = el.getBoundingClientRect();
      const ancho = 380;
      const alto = 210;
      const debajo = r.bottom + m + 14 + alto < window.innerHeight;
      const top = debajo ? r.bottom + m + 14 : Math.max(16, r.top - m - 14 - alto);
      let left = r.left + r.width / 2 - ancho / 2;
      left = Math.max(16, Math.min(left, window.innerWidth - ancho - 16));
      estilo = `top:${top}px;left:${left}px;width:${ancho}px`;
      clase += debajo ? ' tour__tarjeta--flecha-arriba' : ' tour__tarjeta--flecha-abajo';
    }

    const puntos = pasos.map((p, i) =>
      `<span class="tour__punto ${i === indice ? 'tour__punto--actual' : ''}"></span>`).join('');
    const ultimo = indice === pasos.length - 1;

    capa.innerHTML = `
      <div class="tour__velo"></div>
      ${foco}
      <div class="${clase}" style="${estilo}">
        <div class="tour__desplazable">
          <div class="tour__paso">Paso ${indice + 1} de ${pasos.length}</div>
          <h2 class="tour__titulo">${esc(paso.titulo)}</h2>
          <p class="tour__texto">${esc(paso.texto)}</p>
          <div class="tour__pie">
            <div class="tour__puntos" aria-hidden="true">${puntos}</div>
            <div class="tour__botones">
              ${ultimo ? '' : '<button type="button" class="tour__boton" data-tour="saltar">Saltar</button>'}
              ${indice > 0 ? '<button type="button" class="tour__boton" data-tour="anterior">Anterior</button>' : ''}
              <button type="button" class="tour__boton tour__boton--principal" data-tour="siguiente">${ultimo ? 'Listo' : 'Siguiente'}</button>
            </div>
          </div>
        </div>
      </div>`;

    if (el && !esAngosto()) ubicarJunto(el, m);

    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < 80 || r.bottom > window.innerHeight - 80) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }

  // El primer lugar se calcula con un alto supuesto; ya dibujada, la tarjeta se
  // mide y se corrige. Con zoom el texto crece, y con el alto supuesto los
  // botones quedaban fuera de la pantalla. Va debajo del elemento si entra,
  // encima si no; si no entra de ningún lado, del lado con más lugar y con lo
  // que sobre desplazándose por dentro (los botones siguen a la vista).
  function ubicarJunto(el, m) {
    const tarjeta = capa.querySelector('.tour__tarjeta');
    if (!tarjeta) return;
    const r = el.getBoundingClientRect();
    const alto = window.innerHeight;
    const borde = 16;
    const separacion = m + 14;
    const lugarAbajo = alto - (r.bottom + separacion) - borde;
    const lugarArriba = r.top - separacion - borde;
    const h = tarjeta.offsetHeight;
    let top;
    let debajo;
    if (h <= lugarAbajo) { debajo = true; top = r.bottom + separacion; }
    else if (h <= lugarArriba) { debajo = false; top = r.top - separacion - h; }
    else if (Math.max(lugarAbajo, lugarArriba) >= 160) {
      debajo = lugarAbajo >= lugarArriba;
      const lugar = Math.max(lugarAbajo, lugarArriba);
      tarjeta.style.maxHeight = `${lugar}px`;
      top = debajo ? r.bottom + separacion : r.top - separacion - Math.min(h, lugar);
    } else {
      // Ni arriba ni abajo hay lugar: la tarjeta tapa el elemento, pero entera
      // y sin flecha, que no tendría a qué apuntar
      debajo = null;
      top = Math.max(borde, alto - h - borde);
    }
    tarjeta.style.top = `${Math.max(borde, top)}px`;
    tarjeta.classList.toggle('tour__tarjeta--flecha-arriba', debajo === true);
    tarjeta.classList.toggle('tour__tarjeta--flecha-abajo', debajo === false);
  }

  function mover(paso) {
    const proximo = indice + paso;
    if (proximo < 0) return;
    if (proximo >= pasos.length) { terminar(); return; }
    indice = proximo;
    pintar();
  }

  function terminar() {
    if (modoActual) marcarLeido(modoActual);
    if (capa) { capa.remove(); capa = null; }
    document.removeEventListener('keydown', teclado);
    window.removeEventListener('resize', pintar);
    window.removeEventListener('scroll', pintar, true);
    document.body.classList.remove('tour-abierto');
    const fn = alTerminar;
    modoActual = null;
    alTerminar = null;
    if (fn) fn();
  }

  /* ---------- Fuera ---------- */

  function iniciar(modo, opciones) {
    const recorrido = RECORRIDOS[modo];
    if (!recorrido) return;
    // Los pasos opcionales solo entran si su elemento está en pantalla
    pasos = recorrido.filter((p) => !p.opcional || objetivoDe(p));
    if (!pasos.length) return;
    indice = 0;
    modoActual = modo;
    alTerminar = (opciones || {}).alTerminar || null;
    document.body.classList.add('tour-abierto');
    crearCapa();
    pintar();
  }

  // Lo llama el panel cuando termina de dibujar: la primera vez arranca solo
  function quizas(modo) {
    if (capa || leido(modo)) return;
    setTimeout(() => { if (!capa) iniciar(modo); }, 400);
  }

  return { iniciar, quizas, leido, abierto: () => Boolean(capa) };
})();
