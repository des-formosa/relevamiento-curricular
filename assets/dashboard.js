/* ============================================================================
   Tablero del equipo de Planificación Curricular.

   Una sola pantalla: materia · año · alcance arriba, y la materia completa del
   año abajo, con los tres trimestres en columnas. Dos vistas de la misma
   información: Detalle (contenidos con su barra) y Mapa de calor (ejes por
   trimestre). Requiere sesión de Supabase Auth y pertenecer al equipo.
   ============================================================================ */

(function () {
  'use strict';

  const app = document.getElementById('app');
  // Los logos oficiales traen el nombre incrustado y a escala chica no se lee:
  // en pantalla se usa el símbolo recortado, con el nombre escrito al lado.
  const RUTA_SIMBOLO_MINISTERIO = 'assets/img/simbolo-ministerio.png';
  const RUTA_SIMBOLO_SECUNDARIA = 'assets/img/simbolo-secundaria.png';
  // La marca del programa, recortada de la placa oficial de ReSaP
  const RUTA_RESAP_SIMBOLO = 'assets/img/resap-simbolo.png';
  const RUTA_RESAP_PALABRA = 'assets/img/resap-palabra.png';
  const URL_SHEETJS = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

  const MUESTRA_MINIMA = 5;      // menos docentes que esto: «muestra insuficiente»
  const MOSTRAR_POR_SABER = 3;   // contenidos visibles por saber antes de «ver los demás»
  const TILES_POR_CELDA = 4;     // contenidos por celda del mapa de calor
  const FILAS_POR_PAGINA = 1000; // paginado de la exportación completa

  const ORDINAL = { 1: '1er', 2: '2do', 3: '3er' };

  const sb = window.supabase.createClient(CONFIG_SUPABASE.url, CONFIG_SUPABASE.claveAnon);

  /* ======================================================================
     Utilidades
     ====================================================================== */

  function esc(texto) {
    return String(texto == null ? '' : texto)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  const plural = (n, uno, varios) => (n === 1 ? uno : varios);
  const numero = (n) => Number(n || 0).toLocaleString('es-AR');
  const fechaLarga = (d) => d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });

  const svg = (contenido, { tam = 22, color = '#003380', grosor = 2.4 } = {}) =>
    `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${grosor}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${contenido}</svg>`;
  const Icono = {
    descargar: svg('<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>', { tam: 21, color: '#FFFFFF' }),
    chevron: svg('<path d="M6 9l6 6 6-6"/>', { tam: 17, grosor: 2.6 }),
    info: svg('<circle cx="12" cy="12" r="9.2"/><path d="M12 11v6"/><path d="M12 7.6v.2"/>', { color: '#636C80', grosor: 2.2 }),
    cerrar: svg('<path d="M6 6l12 12"/><path d="M18 6L6 18"/>', { tam: 21, color: '#535D71' }),
  };

  // «EJE II: LECTURA Y PRODUCCIÓN ESCRITA» → { rotulo: 'EJE II', nombre: 'Lectura y producción escrita' }
  function partirEje(nombre, orden) {
    const m = String(nombre || '').match(/^\s*EJE\s*([IVX0-9]+)\s*[:.—–-]?\s*(.*)$/i);
    if (m && m[2]) return { rotulo: `EJE ${m[1].toUpperCase()}`, nombre: capitalizar(m[2]) };
    return { rotulo: `EJE ${orden}`, nombre: capitalizar(nombre) };
  }
  function capitalizar(t) {
    t = String(t || '').trim();
    if (!t) return '';
    const mayusculas = t === t.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(t);
    return mayusculas ? t.charAt(0) + t.slice(1).toLowerCase() : t;
  }

  /* ======================================================================
     Estado
     ====================================================================== */

  const estado = {
    pantalla: 'cargando',     // cargando | ingreso | sin-permiso | inicio | panel
    nombre: null,             // el de equipo_planificacion, para saludar
    inicio: null,             // { cargas } para la pantalla de inicio
    usuario: null,
    espacio_id: null,
    anio: 1,
    alcance: { tipo: 'provincia' },   // | { tipo: 'departamento', id } | { tipo: 'escuela', id }
    vista: 'detalle',                 // detalle | mapa
    modo: 'resultados',               // resultados | catalogo (editar el diseño);
                                      //   no se guarda: siempre se entra por resultados
    ejemplo: false,
    datos: null,
    cargandoDatos: false,
    errorDatos: null,
    abiertos: new Set(),
    escuelasAgregadas: [],
    ingreso: { email: '', error: null, enviando: false },
    // Descargar: que = 'materia' (todos los años) | 'anio' (el que se mira) |
    //   'control' (seguimiento de la carga, uso interno) | 'curricula' (sin resultados);
    //   formato = 'pdf' | 'excel'; vista del PDF = 'barras' | 'mapa'
    exportar: null,                   // { que, formato, vista, progreso, error, descargando }
    documento: null,                  // el HTML que se está imprimiendo
  };

  function leerHash() {
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (h.get('materia') && Catalogo.espacio(h.get('materia'))) estado.espacio_id = h.get('materia');
    if (['1', '2', '3'].includes(h.get('anio'))) estado.anio = Number(h.get('anio'));
    if (h.get('departamento')) estado.alcance = { tipo: 'departamento', id: h.get('departamento') };
    else if (h.get('escuela')) estado.alcance = { tipo: 'escuela', id: h.get('escuela') };
    if (h.get('vista') === 'mapa') estado.vista = 'mapa';
    if (h.get('ejemplo') === '1') estado.ejemplo = true;
    // El modo no viaja en el hash a propósito: se entra siempre por los
    // resultados. Editar el catálogo es algo que se elige, no un lugar donde
    // amanecer porque la última vez quedaste ahí.
  }
  function escribirHash() {
    const h = new URLSearchParams();
    h.set('materia', estado.espacio_id);
    h.set('anio', String(estado.anio));
    if (estado.alcance.tipo === 'departamento') h.set('departamento', estado.alcance.id);
    if (estado.alcance.tipo === 'escuela') h.set('escuela', estado.alcance.id);
    if (estado.vista === 'mapa') h.set('vista', 'mapa');
    if (estado.ejemplo) h.set('ejemplo', '1');
    history.replaceState(null, '', '#' + h.toString());
  }

  /* ======================================================================
     Datos
     ====================================================================== */

  async function cargarDatos() {
    if (estado.modo === 'catalogo') {
      Editor.estado.anioActual = estado.anio;
      await Editor.cargar(estado.espacio_id, estado.anio);
      return;
    }
    estado.cargandoDatos = true;
    estado.errorDatos = null;
    estado.abiertos = new Set();
    render();
    const { data, error } = await sb.rpc('panel_resultados', {
      p_espacio_id: estado.espacio_id,
      p_anio: estado.anio,
      p_trimestre: null,
      p_departamento_id: estado.alcance.tipo === 'departamento' ? estado.alcance.id : null,
      p_escuela_id: estado.alcance.tipo === 'escuela' ? estado.alcance.id : null,
      p_ejemplo: estado.ejemplo,
    });
    estado.cargandoDatos = false;
    if (error) {
      estado.datos = null;
      estado.errorDatos = 'No pudimos traer los resultados. Revisá la conexión y volvé a intentar.';
      render();
      return;
    }
    estado.datos = prepararDatos(data);
    render();
  }

  // Numera los saberes del año y arma la estructura que usan las dos vistas
  function prepararDatos(crudo) {
    const saberes = (crudo.saberes || []).map((s, i) => Object.assign({}, s, {
      numero: i + 1,
      ejeInfo: partirEje(s.eje, s.eje_orden),
      suficiente: (s.trabajan || 0) >= MUESTRA_MINIMA,
    }));
    const porTrimestre = { 1: [], 2: [], 3: [] };
    for (const s of saberes) porTrimestre[[1, 2, 3].includes(s.trimestre) ? s.trimestre : 1].push(s);
    return { contexto: crudo.contexto || { docentes: 0, escuelas: 0, respuestas: 0 }, saberes, porTrimestre };
  }

  async function cargarEscuelasAgregadas() {
    const { data } = await sb.from('escuelas').select('id, nombre, localidad, departamento_id').eq('origen', 'agregada_por_docente').order('nombre');
    estado.escuelasAgregadas = data || [];
  }

  /* ======================================================================
     Sesión
     ====================================================================== */

  async function verificarSesion() {
    const { data } = await sb.auth.getSession();
    const sesion = data && data.session;
    if (!sesion) { estado.pantalla = 'ingreso'; estado.usuario = null; render(); return; }
    estado.usuario = sesion.user;
    // Si la consulta falla no es lo mismo que no estar en el equipo: antes las
    // dos cosas mostraban «no está habilitado» y no había forma de saber cuál era
    const { data: fila, error: errorPermiso } = await sb.from('equipo_planificacion').select('usuario_id, nombre').eq('usuario_id', sesion.user.id).maybeSingle();
    estado.errorPermiso = errorPermiso ? (errorPermiso.message || String(errorPermiso)) : null;
    if (!fila) { estado.pantalla = 'sin-permiso'; render(); return; }
    estado.nombre = (fila.nombre || '').trim() || null;
    Editor.iniciar(sb, { render, refrescar: () => Editor.cargar(estado.espacio_id, estado.anio) });
    await cargarEscuelasAgregadas();
    // Un link compartido (con la selección en el hash) va directo a lo que
    // muestra; entrar al panel a secas, al inicio
    if (/(^|[#&])materia=/.test(window.location.hash)) { irAlPanel('resultados'); return; }
    irAlInicio();
  }

  // El inicio: el nombre del sistema, una línea de cómo va la carga y los dos
  // caminos. Trae una sola consulta liviana; si falla, la pantalla igual se ve.
  async function irAlInicio() {
    estado.pantalla = 'inicio';
    estado.modo = 'resultados';
    estado.exportar = null;
    Editor.limpiar();
    history.replaceState(null, '', window.location.pathname + window.location.search);
    render();
    window.scrollTo(0, 0);
    const cargas = await sb.from('aportes').select('id', { count: 'exact', head: true }).eq('es_ejemplo', false);
    estado.inicio = { cargas: cargas && !cargas.error && typeof cargas.count === 'number' ? cargas.count : null };
    // Solo se completa la línea de estado: redibujar todo cortaría la entrada
    const lugar = document.getElementById('inicio-estado');
    if (estado.pantalla === 'inicio' && lugar) lugar.innerHTML = lineaEstadoInicio();
  }

  function irAlPanel(modo) {
    estado.pantalla = 'panel';
    estado.modo = modo;
    Editor.limpiar();
    escribirHash();
    render();
    window.scrollTo(0, 0);
    cargarDatos();
  }

  async function ingresar(email, clave) {
    estado.ingreso.enviando = true;
    estado.ingreso.error = null;
    estado.ingreso.email = email;
    render();
    const { error } = await sb.auth.signInWithPassword({ email, password: clave });
    estado.ingreso.enviando = false;
    if (error) {
      estado.ingreso.error = /invalid/i.test(error.message)
        ? 'El correo o la contraseña no coinciden. Revisalos y probá de nuevo.'
        : 'No pudimos iniciar sesión. Revisá la conexión y volvé a intentar.';
      render();
      return;
    }
    estado.pantalla = 'cargando';
    render();
    verificarSesion();
  }

  async function salir() {
    await sb.auth.signOut();
    estado.usuario = null;
    estado.datos = null;
    // Cerrar sesión no recarga la página, así que el modo hay que bajarlo a
    // mano: el que entra después tiene que ver los resultados, no el editor
    estado.modo = 'resultados';
    Editor.limpiar();
    history.replaceState(null, '', window.location.pathname + window.location.search);
    estado.pantalla = 'ingreso';
    render();
  }

  /* ======================================================================
     Piezas
     ====================================================================== */

  function nombreMateria() {
    const e = Catalogo.espacio(estado.espacio_id);
    return e ? Catalogo.nombreCorto(e) : '';
  }
  function nombreAlcance() {
    const a = estado.alcance;
    if (a.tipo === 'departamento') { const d = Catalogo.departamento(a.id); return d ? `Departamento ${d.nombre}` : 'Departamento'; }
    if (a.tipo === 'escuela') {
      const e = Catalogo.escuela(a.id) || estado.escuelasAgregadas.find((x) => x.id === a.id);
      return e ? e.nombre : 'Escuela';
    }
    return 'Toda la provincia';
  }
  const textoAnio = () => `${estado.anio}° año`;

  function cabecera() {
    return `<header class="t-cabecera">
      <div class="t-cabecera__marca">
        <img class="t-cabecera__simbolo" src="${RUTA_SIMBOLO_MINISTERIO}" alt="Ministerio de Cultura y Educación — Provincia de Formosa">
        <div class="t-cabecera__nombre" aria-hidden="true"><span>Ministerio de Cultura y Educación</span><span>Provincia de Formosa</span></div>
        <div class="t-cabecera__separador"></div>
        <img class="t-cabecera__simbolo t-cabecera__simbolo--des" src="${RUTA_SIMBOLO_SECUNDARIA}" alt="Dirección de Educación Secundaria">
        <div class="t-cabecera__nombre" aria-hidden="true"><span>Dirección de Educación Secundaria</span><span>Formosa</span></div>
        ${estado.pantalla === 'inicio' ? '' : `<div class="t-cabecera__separador"></div>${resapChico()}`}
      </div>
      <div class="t-cabecera__derecha">
        <div class="t-cabecera__fecha">Datos al ${esc(fechaLarga(new Date()))}</div>
        ${['inicio', 'panel'].includes(estado.pantalla) ? navegacion() : ''}
      </div>
    </header>`;
  }

  // El logo del programa con su nombre completo, y abajo el filete tricolor y
  // el eslogan, como en la placa oficial. En el ingreso y el inicio el nombre
  // es el título de la página.
  function marcaResap({ titulo = false } = {}) {
    const nombre = 'Relevamiento y Sistematización<br>de Saberes Prioritarios <span>del Nivel Secundario</span>';
    return `<div class="resap resap--grande">
        <img class="resap__simbolo" src="${RUTA_RESAP_SIMBOLO}" alt="">
        <div class="resap__textos">
          <img class="resap__palabra" src="${RUTA_RESAP_PALABRA}" alt="ReSaP">
          ${titulo ? `<h1 class="resap__nombre">${nombre}</h1>` : `<p class="resap__nombre">${nombre}</p>`}
        </div>
      </div>
      <div class="filete-marca" aria-hidden="true"><span></span><span></span><span></span></div>
      <p class="eslogan">Una herramienta para <strong class="eslogan__celeste">Consolidar</strong>, <strong class="eslogan__verde">Unificar</strong> y <strong class="eslogan__amarillo">Fortalecer</strong> los saberes curriculares.</p>`;
  }

  const resapChico = () => `<span class="resap-chico">
      <img class="resap-chico__simbolo" src="${RUTA_RESAP_SIMBOLO}" alt="">
      <img class="resap-chico__palabra" src="${RUTA_RESAP_PALABRA}" alt="ReSaP">
    </span>`;

  // La cabecera solo lleva por dónde moverse: Inicio, Resultados y Catálogo,
  // con el lugar actual marcado, y la ayuda y la salida. Las acciones de cada
  // pantalla van en su propia barra, al lado de lo que afectan.
  function navegacion() {
    const actual = estado.pantalla === 'inicio' ? 'inicio' : estado.modo === 'catalogo' ? 'catalogo' : 'resultados';
    const enlace = (id, accion, texto) =>
      `<button type="button" class="t-enlace-cab ${actual === id ? 't-enlace-cab--actual' : ''}" data-accion="${accion}" ${actual === id ? 'aria-current="page"' : ''}>${texto}</button>`;
    return `<nav class="t-nav" aria-label="Secciones">
        ${enlace('inicio', 'ir-inicio', 'Inicio')}
        ${enlace('resultados', 'ir-resultados', 'Resultados')}
        ${enlace('catalogo', 'ir-catalogo', 'Catálogo')}
      </nav>
      <span class="t-nav__separador" aria-hidden="true"></span>
      ${estado.pantalla === 'panel' ? '<button type="button" class="t-enlace-cab t-ayuda" data-accion="tour" title="Ver cómo se usa esta pantalla">¿Cómo se usa?</button>' : ''}
      <button type="button" class="t-enlace-cab" data-accion="salir">Salir</button>`;
  }

  function bandaEjemplo() {
    if (!estado.ejemplo) return '';
    return `<div class="t-banda-ejemplo"><strong>Datos de ejemplo</strong> · inventados para la demostración. No son respuestas de docentes.</div>`;
  }

  function selectores() {
    const opcionesMateria = Catalogo.areas().map((a) => {
      const espacios = Catalogo.espaciosPorArea(a.id);
      return `<optgroup label="${esc(a.nombre)}">${espacios.map((e) =>
        `<option value="${esc(e.id)}" ${e.id === estado.espacio_id ? 'selected' : ''}>${esc(Catalogo.esArtistica(e) ? e.nombre : Catalogo.nombreCorto(e))}</option>`).join('')}</optgroup>`;
    }).join('');
    const espacio = Catalogo.espacio(estado.espacio_id);
    const anios = espacio ? espacio.anios_dictados : [1, 2, 3];
    const opcionesAnio = anios.map((a) => `<option value="${a}" ${a === estado.anio ? 'selected' : ''}>${a}° año</option>`).join('');
    const a = estado.alcance;
    const opcionesAlcance = [
      `<option value="provincia" ${a.tipo === 'provincia' ? 'selected' : ''}>Toda la provincia</option>`,
      `<optgroup label="Por departamento">${Catalogo.departamentos().map((d) =>
        `<option value="departamento:${esc(d.id)}" ${a.tipo === 'departamento' && a.id === d.id ? 'selected' : ''}>Departamento ${esc(d.nombre)}</option>`).join('')}</optgroup>`,
      ...Catalogo.departamentos().map((d) => {
        const escuelas = Catalogo.buscarEscuelas('', d.id).grupos[0];
        if (!escuelas) return '';
        return `<optgroup label="Escuelas · ${esc(d.nombre)}">${escuelas.escuelas.map((e) =>
          `<option value="escuela:${esc(e.id)}" ${a.tipo === 'escuela' && a.id === e.id ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}</optgroup>`;
      }),
      estado.escuelasAgregadas.length ? `<optgroup label="Escuelas agregadas por docentes">${estado.escuelasAgregadas.map((e) =>
        `<option value="escuela:${esc(e.id)}" ${a.tipo === 'escuela' && a.id === e.id ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}</optgroup>` : '',
    ].join('');
    return `<div class="t-selectores">
      <div class="t-selector">
        <label class="t-selector__etiqueta" for="s-materia">Materia</label>
        <select class="t-select t-select--materia" id="s-materia" data-cambio="materia">${opcionesMateria}</select>
      </div>
      <div class="t-selector">
        <label class="t-selector__etiqueta" for="s-anio">Año</label>
        <select class="t-select t-select--anio" id="s-anio" data-cambio="anio">${opcionesAnio}</select>
      </div>
      ${estado.modo === 'catalogo' ? '' : `
      <div class="t-selector">
        <label class="t-selector__etiqueta" for="s-alcance">Alcance</label>
        <select class="t-select t-select--alcance" id="s-alcance" data-cambio="alcance">${opcionesAlcance}</select>
      </div>`}
      <div class="espaciador"></div>
      ${estado.modo === 'catalogo' ? '' : `
      <div class="t-selectores__acciones">
        <button type="button" class="t-interruptor ${estado.ejemplo ? 't-interruptor--activo' : ''}" data-accion="alternar-ejemplo" aria-pressed="${estado.ejemplo}">
          <span class="t-interruptor__pista"></span>Datos de ejemplo
        </button>
        <button type="button" class="t-exportar" data-accion="abrir-exportar">${Icono.descargar}Descargar resultados</button>
      </div>`}
    </div>`;
  }

  function lineaContexto() {
    const d = estado.datos;
    const c = d ? d.contexto : { docentes: 0, escuelas: 0 };
    const totalSaberes = d ? d.saberes.length : 0;
    const totalContenidos = d ? d.saberes.reduce((n, s) => n + (s.contenidos || []).length, 0) : 0;
    const detalle = estado.vista === 'mapa'
      ? `El año completo: ${numero(totalContenidos)} contenidos en ${totalSaberes} ${plural(totalSaberes, 'saber', 'saberes')}.`
      : `El año completo: ${totalSaberes} ${plural(totalSaberes, 'saber', 'saberes')} en los tres trimestres.`;
    return `<div class="t-contexto">
      <div class="t-contexto__texto">Basado en <strong>${numero(c.docentes)} ${plural(c.docentes, 'docente', 'docentes')}</strong> de <strong>${numero(c.escuelas)} ${plural(c.escuelas, 'escuela', 'escuelas')}</strong>. ${detalle}</div>
      <div class="t-vistas">
        <button type="button" class="t-vista ${estado.vista === 'detalle' ? 't-vista--activa' : ''}" data-accion="vista" data-vista="detalle">Detalle</button>
        <button type="button" class="t-vista ${estado.vista === 'mapa' ? 't-vista--activa' : ''}" data-accion="vista" data-vista="mapa">Mapa de calor</button>
      </div>
    </div>`;
  }

  // El PDF es un documento, no la pantalla impresa: la currícula de la materia
  // tal como queda con lo que eligieron los docentes, para leer en papel o
  // mandar a los profesores. En pantalla no se ve; al imprimir es lo único.
  // Arriba de cada PDF, el logo chico y el nombre del programa
  const marcaDocumento = () => `<div class="t-doc__marca">
      <img class="t-doc__marca-simbolo" src="${RUTA_RESAP_SIMBOLO}" alt="">
      <img class="t-doc__marca-palabra" src="${RUTA_RESAP_PALABRA}" alt="ReSaP">
      <span class="t-doc__marca-nombre">Relevamiento y Sistematización de Saberes Prioritarios del Nivel Secundario</span>
    </div>`;

  // «1°, 2° y 3° año», «1° y 2° año», «1° año»
  function textoAnios(anios) {
    const t = anios.map((a) => `${a}°`);
    return (t.length > 1 ? `${t.slice(0, -1).join(', ')} y ${t[t.length - 1]}` : t[0]) + ' año';
  }
  const textoAlcance = () => (estado.alcance.tipo === 'provincia' ? 'Toda la provincia' : nombreAlcance());
  const textoBase = (c) => `${numero(c.docentes)} ${plural(c.docentes, 'docente', 'docentes')} de ${numero(c.escuelas)} ${plural(c.escuelas, 'escuela', 'escuelas')}`;
  const aniosDeLaMateria = () => {
    const esp = Catalogo.espacio(estado.espacio_id);
    return esp ? esp.anios_dictados.slice().sort() : [estado.anio];
  };

  /* ---------- El reporte de la materia para imprimir (PDF) ---------- */

  // Barras: un saber, y debajo sus contenidos con una barra fina y el porcentaje.
  // El encabezado del saber y su primer contenido van en un bloque que no se
  // parte: un saber largo puede seguir en la hoja siguiente, pero su encabezado
  // nunca queda solo al pie. «antes» es lo que va pegado arriba del saber (el
  // título del trimestre, en el primero), por lo mismo.
  function saberDocumento(s, antes = '') {
    const pct = (v) => Math.round(Number(v) || 0);
    const contenido = (co) => `
        <li class="t-doc__contenido">
          <span class="t-doc__contenido-texto">${esc(co.texto)}${co.tipo === 'libre' ? ' <em>(agregado por docentes)</em>' : ''}</span>
          <span class="t-doc__barra"><span style="width:${pct(co.porcentaje)}%"></span></span>
          <span class="t-doc__pct">${pct(co.porcentaje)} %</span>
        </li>`;
    let primero;
    let resto = '';
    if (!s.suficiente) {
      primero = `<p class="t-doc__nota">${s.trabajan
        ? `Solo ${s.trabajan} ${plural(s.trabajan, 'docente lo trabaja', 'docentes lo trabajan')}: son muy pocos para dar porcentajes.`
        : 'Todavía ningún docente informó que lo trabaja.'}</p>`;
    } else if (!(s.contenidos || []).length) {
      primero = '<p class="t-doc__nota">Los docentes que lo trabajan no eligieron contenidos.</p>';
    } else {
      primero = `<ul class="t-doc__contenidos">${contenido(s.contenidos[0])}</ul>`;
      if (s.contenidos.length > 1) resto = `<ul class="t-doc__contenidos t-doc__contenidos--sigue">${s.contenidos.slice(1).map(contenido).join('')}</ul>`;
    }
    return `<div class="t-doc__saber">
      <div class="t-doc__saber-cabeza">
        ${antes}
        <div class="t-doc__rotulo">Saber ${s.numero} · ${esc(s.ejeInfo.rotulo)} — ${esc(s.ejeInfo.nombre)}</div>
        <div class="t-doc__texto">${esc(s.texto)}</div>
        ${s.informan ? `<div class="t-doc__cuenta">Lo trabajan ${s.trabajan} de ${s.informan} docentes que lo informaron</div>` : ''}
        ${primero}
      </div>
      ${resto}
    </div>`;
  }

  // Barras: un año, los trimestres de corrido
  function barrasDocumento(d, anio) {
    return [1, 2, 3].filter((t) => d.porTrimestre[t].length).map((t) => {
      const titulo = `<h2 class="t-doc__trimestre-titulo">${anio ? `${anio}° año · ` : ''}${ORDINAL[t]} trimestre <span>· ${d.porTrimestre[t].length} ${plural(d.porTrimestre[t].length, 'saber', 'saberes')}</span></h2>`;
      return `
      <section class="t-doc__trimestre">
        ${d.porTrimestre[t].map((s, i) => saberDocumento(s, i === 0 ? titulo : '')).join('')}
      </section>`;
    }).join('');
  }

  // Mapa de calor: un año en una tabla, los ejes en filas y los trimestres en
  // columnas. Si el año no entra en una página, el encabezado se repite y dice
  // de qué año es.
  function mapaDocumento(d, anio) {
    const { ejes, contenidosPorTrimestre } = datosMapa(d);
    const tile = (t) => (t.insuficiente ? `
      <div class="t-doc__tile t-doc__tile--insuficiente">
        <div class="t-doc__tile-fila"><span class="t-doc__tile-nombre">${esc(t.nombre)}</span><span class="t-doc__tile-pct">—</span></div>
        <div class="t-doc__tile-saber">${esc(t.saber)} · muestra insuficiente</div>
      </div>` : `
      <div class="t-doc__tile t-doc__tile--${tono(t.pct)}">
        <div class="t-doc__tile-fila"><span class="t-doc__tile-nombre">${esc(t.nombre)}</span><span class="t-doc__tile-pct">${t.pct}%</span></div>
        <div class="t-doc__tile-saber">${esc(t.saber)}</div>
      </div>`);
    const filas = ejes.map(({ info, saberes, totalContenidos, celdas }) => `
      <tr>
        <th class="t-doc__mapa-eje" scope="row">
          <span class="t-doc__mapa-eje-rotulo">${esc(info.rotulo)}</span>
          <span class="t-doc__mapa-eje-nombre">${esc(info.nombre)}</span>
          <span class="t-doc__mapa-eje-cuenta">${saberes.length} ${plural(saberes.length, 'saber', 'saberes')} · ${totalContenidos} contenidos</span>
        </th>
        ${[1, 2, 3].map((t) => {
          const celda = celdas[t];
          if (celda.estado !== 'datos') return `<td class="t-doc__mapa-celda"><p class="t-doc__mapa-vacia">${textoCeldaVacia(celda, t)}</p></td>`;
          return `<td class="t-doc__mapa-celda">${celda.visibles.map(tile).join('')}${celda.mas > 0 ? `<p class="t-doc__mapa-mas">+ ${celda.mas} ${plural(celda.mas, 'contenido más', 'contenidos más')}</p>` : ''}</td>`;
        }).join('')}
      </tr>`).join('');
    return `<table class="t-doc__mapa">
        <thead><tr>
          <th scope="col">Eje del diseño curricular${anio ? ` <span>${anio}° año</span>` : ''}</th>
          ${[1, 2, 3].map((t) => `<th scope="col">${ORDINAL[t]} trimestre <span>${contenidosPorTrimestre[t]} contenidos</span></th>`).join('')}
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>`;
  }

  const leyendaMapaDocumento = () => `<div class="t-doc__leyenda">
      <span>pocos</span>
      <span class="t-doc__leyenda-escala">${[1, 2, 3, 4, 5, 6].map((n) => `<span class="t-doc__tile--${n}"></span>`).join('')}</span>
      <span>casi todos</span>
      <span class="t-doc__leyenda-insuficiente"></span><span>muestra insuficiente (menos de ${MUESTRA_MINIMA} docentes)</span>
    </div>`;

  // El reporte para imprimir, de uno o de varios años. Con varios, cada año
  // arranca en una página nueva y dice sobre cuántos docentes se basa.
  function documentoReporte(reportes, vista) {
    const varios = reportes.length > 1;
    const mapa = vista === 'mapa';
    const cuerpoAnio = (r) => (mapa ? mapaDocumento(r.datos, varios ? r.anio : null) : barrasDocumento(r.datos, varios ? r.anio : null));
    const secciones = reportes.map((r, i) => (varios ? `
      <section class="t-doc__anio ${i > 0 ? 't-doc__anio--nueva' : ''}">
        <h2 class="t-doc__anio-titulo">${r.anio}° año <span>· ${r.datos.contexto.docentes ? `basado en ${textoBase(r.datos.contexto)}` : 'todavía sin cargas'}</span></h2>
        ${cuerpoAnio(r)}
      </section>` : cuerpoAnio(r))).join('');
    const unico = reportes[0].datos.contexto;
    return `<article class="t-doc ${mapa ? 't-doc--mapa' : ''}">
      <header class="t-doc__cabeza">
        ${marcaDocumento()}
        <div class="t-doc__institucion">Ministerio de Cultura y Educación · Dirección de Educación Secundaria · Formosa</div>
        <h1 class="t-doc__titulo">${esc(nombreMateria())} · ${esc(textoAnios(reportes.map((r) => r.anio)))}</h1>
        <div class="t-doc__sub">${mapa ? 'Mapa de calor: los contenidos más elegidos, por eje y trimestre' : 'Contenidos que priorizan los docentes, trimestre por trimestre'}</div>
        <div class="t-doc__datos">${esc(textoAlcance())}${varios ? '' : ` · ${textoBase(unico)}`} · Datos al ${esc(fechaLarga(new Date()))}</div>
        ${estado.ejemplo ? '<div class="t-doc__ejemplo">DATOS DE EJEMPLO: inventados para mostrar cómo se ve. No son respuestas de docentes.</div>' : ''}
        <p class="t-doc__lectura">${mapa
          ? `Cada fila es un eje del diseño curricular y cada columna, un trimestre. En cada celda, los ${TILES_POR_CELDA} contenidos más elegidos de ese eje: el número y el color dicen qué porcentaje de los docentes que trabajan ese saber lo eligió.`
          : 'Los saberes van en el orden del diseño curricular. Debajo de cada uno, los contenidos que eligieron los docentes que lo trabajan, de más a menos elegido; el porcentaje es sobre esos docentes.'}</p>
        ${mapa ? leyendaMapaDocumento() : ''}
      </header>
      ${secciones}
    </article>`;
  }

  // Lo que sale al imprimir: el reporte que se pidió al descargar, la currícula
  // de «Descargar para revisar» o, con Ctrl+P, el año que se está mirando
  function documentoImpresion() {
    if (estado.documento) return estado.documento;
    if (!estado.datos) return '';
    return documentoReporte([{ anio: estado.anio, datos: estado.datos }], estado.vista === 'mapa' ? 'mapa' : 'barras');
  }

  /* ---------- Vista Detalle ---------- */

  function tarjetaSaber(s) {
    const abierto = estado.abiertos.has(s.id);
    const contenidos = s.contenidos || [];
    let cuerpo = '';
    if (s.suficiente) {
      const filas = contenidos.map((c, i) => `
        <div class="t-fila ${i >= MOSTRAR_POR_SABER && !abierto ? 't-fila--oculta' : ''}">
          <div class="t-fila__texto">${esc(c.texto)}${c.tipo === 'libre' ? ' <span class="t-chip-libre">agregado por docentes</span>' : ''}</div>
          <div class="t-fila__barra">
            <div class="t-pista"><div class="t-barra" style="width:${Math.max(0, Math.min(100, Number(c.porcentaje) || 0))}%"></div></div>
            <div class="t-pct">${Math.round(Number(c.porcentaje) || 0)}%</div>
          </div>
        </div>`).join('');
      const restantes = contenidos.length - MOSTRAR_POR_SABER;
      const ver = restantes > 0 ? `<div class="t-ver"><button type="button" class="t-ver__boton" data-accion="alternar-saber" data-id="${esc(s.id)}">${Icono.chevron}${abierto ? 'ver menos' : `ver ${restantes === 1 ? 'el restante' : `los ${restantes} restantes`}`}</button></div>` : '';
      cuerpo = `<div class="t-filas">${filas}</div>${ver}`;
    } else {
      const texto = s.informan === 0
        ? 'Ningún docente informó este saber todavía.'
        : `Solo ${s.informan} ${plural(s.informan, 'docente informó', 'docentes informaron')} este saber. Muestra insuficiente.`;
      cuerpo = `<div class="t-aviso">${Icono.info}<div class="t-aviso__texto">${esc(texto)}</div></div>`;
    }
    const base = s.suficiente
      ? `<div class="t-saber__base">Lo ${s.trabajan === 1 ? 'trabaja' : 'trabajan'} ${s.trabajan} de ${s.informan} ${plural(s.informan, 'docente que lo informó', 'docentes que lo informaron')}${s.no_trabajan ? ` · ${s.no_trabajan} no lo ${s.no_trabajan === 1 ? 'trabaja' : 'trabajan'}` : ''}</div>`
      : '';
    return `<div class="t-saber ${abierto ? 't-saber--abierto' : ''}">
      <div class="t-saber__cabeza">
        <div class="t-saber__rotulos">
          <span class="t-saber__rotulo">Saber ${s.numero}</span>
          <span class="t-saber__eje">${esc(s.ejeInfo.rotulo)} — ${esc(s.ejeInfo.nombre)}</span>
        </div>
        <div class="t-saber__texto">${esc(s.texto)}</div>
        ${base}
      </div>
      ${cuerpo}
    </div>`;
  }

  function vistaDetalle() {
    const d = estado.datos;
    const columnas = [1, 2, 3].map((t) => {
      const lista = d.porTrimestre[t];
      return `<div class="t-columna">
        <div class="t-columna__cabecera">
          <div class="t-columna__titulo">${ORDINAL[t]} TRIMESTRE</div>
          <div class="t-columna__resumen">${lista.length} ${plural(lista.length, 'saber', 'saberes')}</div>
        </div>
        ${lista.length ? lista.map(tarjetaSaber).join('') : '<div class="t-columna__vacia">Sin saberes asignados a este trimestre.</div>'}
      </div>`;
    }).join('');
    return `<div class="t-columnas">${columnas}</div>`;
  }

  /* ---------- Vista Mapa de calor ---------- */

  function tono(pct) {
    if (pct >= 85) return 6;
    if (pct >= 65) return 5;
    if (pct >= 45) return 4;
    if (pct >= 25) return 3;
    if (pct >= 10) return 2;
    return 1;
  }

  // Lo que muestra el mapa de calor, sin dibujarlo: lo usan la pantalla y el PDF.
  // Ejes en el orden del diseño. Los saberes llegan en el orden del equipo
  // (trimestre y ciclado), que puede intercalar ejes: el orden de las filas
  // sale del eje, no de cuál aparece primero.
  function datosMapa(d) {
    const claves = [];
    const porEje = new Map();
    for (const s of d.saberes) {
      const clave = s.eje_orden + '|' + s.eje;
      if (!porEje.has(clave)) { porEje.set(clave, { orden: Number(s.eje_orden) || 0, info: s.ejeInfo, saberes: [] }); claves.push(clave); }
      porEje.get(clave).saberes.push(s);
    }
    claves.sort((a, b) => porEje.get(a).orden - porEje.get(b).orden);
    const contenidosPorTrimestre = { 1: 0, 2: 0, 3: 0 };
    for (const s of d.saberes) contenidosPorTrimestre[s.trimestre] += (s.contenidos || []).length;

    const ejes = claves.map((clave) => {
      const { info, saberes } = porEje.get(clave);
      const totalContenidos = saberes.reduce((n, s) => n + (s.contenidos || []).length, 0);
      // Cada celda: 'sin-saberes' (el diseño no ubica saberes del eje en ese
      // trimestre), 'sin-datos' (nadie informó todavía) o sus contenidos
      const celdas = {};
      for (const t of [1, 2, 3]) {
        const del = saberes.filter((s) => s.trimestre === t);
        if (!del.length) { celdas[t] = { estado: 'sin-saberes' }; continue; }
        const tiles = [];
        for (const s of del) {
          if (s.suficiente) {
            for (const c of s.contenidos || []) tiles.push({ pct: Math.round(Number(c.porcentaje) || 0), nombre: c.texto, saber: `SABER ${s.numero}`, insuficiente: false });
          } else {
            const primero = (s.contenidos || [])[0];
            tiles.push({ pct: -1, nombre: primero ? primero.texto : s.texto, saber: `SABER ${s.numero}`, insuficiente: true, informan: s.informan });
          }
        }
        tiles.sort((a, b) => b.pct - a.pct);
        if (!tiles.length) { celdas[t] = { estado: 'sin-datos' }; continue; }
        const visibles = tiles.slice(0, TILES_POR_CELDA);
        celdas[t] = { estado: 'datos', visibles, mas: tiles.length - visibles.length };
      }
      return { info, saberes, totalContenidos, celdas };
    });
    return { ejes, contenidosPorTrimestre };
  }

  const textoCeldaVacia = (celda, t) => (celda.estado === 'sin-saberes'
    ? `El diseño curricular no ubica ningún saber de este eje en el ${ORDINAL[t]} trimestre.`
    : `Ningún docente informó todavía contenidos de este eje en el ${ORDINAL[t]} trimestre.`);

  function vistaMapa() {
    const d = estado.datos;
    const docentes = d.contexto.docentes;
    const { ejes, contenidosPorTrimestre } = datosMapa(d);

    const filas = ejes.map(({ info, saberes, totalContenidos, celdas: porTrimestre }) => {
      const celdas = [1, 2, 3].map((t) => {
        const celda = porTrimestre[t];
        const rotulo = `<div class="t-celda__trimestre">${ORDINAL[t]} TRIMESTRE</div>`;
        if (celda.estado !== 'datos') return `<div class="t-celda">${rotulo}<div class="t-celda__vacia">${textoCeldaVacia(celda, t)}</div></div>`;
        const { visibles, mas } = celda;
        return `<div class="t-celda">${rotulo}${visibles.map((t2) => t2.insuficiente ? `
          <div class="t-tile t-tile--insuficiente" title="${esc(t2.saber)} · ${esc(t2.nombre)}: ${t2.informan ? `solo ${t2.informan} ${plural(t2.informan, 'docente informó', 'docentes informaron')} este saber` : 'ningún docente informó este saber'}, muestra insuficiente">
            <div class="t-tile__fila"><div class="t-tile__nombre">${esc(t2.nombre)}</div><div class="t-tile__pct">—</div></div>
            <div class="t-tile__saber">${esc(t2.saber)} · muestra insuficiente</div>
          </div>` : `
          <div class="t-tile t-tile--${tono(t2.pct)}" title="${esc(t2.nombre)} (${esc(t2.saber)}): lo eligió el ${t2.pct}% de los docentes que trabajan ese saber">
            <div class="t-tile__fila"><div class="t-tile__nombre">${esc(t2.nombre)}</div><div class="t-tile__pct">${t2.pct}%</div></div>
            <div class="t-tile__saber">${esc(t2.saber)}</div>
          </div>`).join('')}
          ${mas > 0 ? `<div class="t-celda__mas">+ ${mas} ${plural(mas, 'contenido más de este eje', 'contenidos más de este eje')} en el ${ORDINAL[t]} trimestre</div>` : ''}
        </div>`;
      }).join('');
      return `<div class="t-mapa__fila">
        <div class="t-mapa__eje">
          <div class="t-mapa__eje-rotulo">${esc(info.rotulo)}</div>
          <div class="t-mapa__eje-nombre">${esc(info.nombre)}</div>
          <div class="t-mapa__eje-cuenta">${saberes.length} ${plural(saberes.length, 'saber', 'saberes')} · ${totalContenidos} contenidos</div>
        </div>
        ${celdas}
      </div>`;
    }).join('');

    return `<div class="t-mapa">
      <div class="t-mapa__cabecera">
        <div class="t-mapa__eje-titulo">Eje del diseño curricular</div>
        ${[1, 2, 3].map((t) => `<div class="t-mapa__col"><div class="t-mapa__col-titulo">${ORDINAL[t]} TRIMESTRE</div><div class="t-mapa__col-cuenta">${contenidosPorTrimestre[t]} contenidos</div></div>`).join('')}
      </div>
      ${filas}
      <div class="t-mapa__pie">
        <div class="t-mapa__leyenda-texto">El número y el color dicen qué porcentaje de los docentes que trabajan ese saber eligió ese contenido${docentes ? ` (${numero(docentes)} docentes en total)` : ''}.</div>
        <div class="t-leyenda">
          <div class="t-leyenda__grupo"><span>pocos</span><div class="t-leyenda__escala"><div style="background:#EDF0F5"></div><div style="background:#D3E0F2"></div><div style="background:#A6BFE4"></div><div style="background:#6E95CE"></div><div style="background:#2B5FA8"></div><div style="background:#003380"></div></div><span>casi todos</span></div>
          <div class="t-leyenda__grupo"><div class="t-leyenda__insuficiente"></div><span>muestra insuficiente</span></div>
        </div>
      </div>
    </div>`;
  }

  /* ---------- Estados del cuerpo ---------- */

  function cuerpo() {
    if (estado.cargandoDatos) return `<div class="t-estado"><div class="t-estado__texto">Calculando los resultados…</div></div>`;
    if (estado.errorDatos) return `<div class="t-estado"><div class="t-estado__titulo">No pudimos traer los resultados</div><div class="t-estado__texto">${esc(estado.errorDatos)}</div><button type="button" class="boton boton--primario boton--66" data-accion="reintentar">Volver a intentar</button></div>`;
    const d = estado.datos;
    if (!d) return '';
    if (!d.contexto.docentes) {
      return `<div class="t-estado">
        <div class="t-estado__titulo">Todavía no hay cargas de ${esc(nombreMateria())} de ${esc(textoAnio())}${estado.alcance.tipo === 'provincia' ? '' : ` en ${esc(nombreAlcance())}`}</div>
        <div class="t-estado__texto">${estado.ejemplo ? 'Tampoco hay datos de ejemplo para esta selección. Probá con otra materia u otro año.' : 'Cuando los docentes empiecen a enviar, los resultados aparecen acá solos. Mientras tanto podés ver cómo se va a ver el tablero con datos de ejemplo.'}</div>
        ${estado.ejemplo ? '' : '<button type="button" class="boton boton--primario boton--66" data-accion="alternar-ejemplo">Ver datos de ejemplo</button>'}
      </div>`;
    }
    return estado.vista === 'mapa' ? vistaMapa() : vistaDetalle();
  }

  /* ---------- Exportar ---------- */

  // Una opción de la ventana (radio), con título y aclaración
  const formatoPanel = (grupo, valor, elegido, titulo, sub) => `
          <label class="t-formato ${elegido ? 't-formato--elegido' : ''}" for="${grupo}-${valor}">
            <span class="t-formato__cabeza"><input type="radio" id="${grupo}-${valor}" name="${grupo}" value="${valor}" ${elegido ? 'checked' : ''} data-cambio="${grupo}"><span class="t-formato__titulo">${titulo}</span></span>
            <span class="t-formato__sub">${sub}</span>
          </label>`;

  // Qué dice cada combinación, en una línea, antes de descargar
  function notaExportar(x) {
    if (x.que === 'curricula') {
      return x.formato === 'pdf'
        ? 'Un año por página, cada saber con sus contenidos. Se abre la ventana de impresión: elegí «Guardar como PDF».'
        : 'Una hoja con año, trimestre, eje, saber y contenidos, y una columna de «Observaciones» para que el profesor anote.';
    }
    if (x.que === 'control') {
      return 'Tres hojas: los <strong>envíos</strong> (uno por fila), <strong>por escuela</strong> (también las que todavía no tienen ninguno) y el <strong>detalle</strong> de cada envío. <strong>Trae nombre y apellido de cada docente: es de uso interno, no para repartir.</strong>';
    }
    const porAnio = x.que === 'materia' && aniosDeLaMateria().length > 1;
    if (x.formato === 'excel') {
      return `Una hoja con ${porAnio ? 'cada año, ' : ''}cada saber y sus contenidos priorizados, y una columna de «Observaciones» para que los profesores anoten.`;
    }
    const paginas = x.vista === 'mapa'
      ? (porAnio ? 'Un año por página: los ejes en filas y los trimestres en columnas.' : 'Los ejes en filas y los trimestres en columnas.')
      : (porAnio ? 'Cada año arranca en una hoja nueva, con sus tres trimestres de corrido.' : 'Los tres trimestres de corrido.');
    return `${paginas} Se abre la ventana de impresión: imprimilo directo o elegí «Guardar como PDF».`;
  }

  function panelExportar() {
    const x = estado.exportar;
    if (!x) return '';
    if (x.que === 'control') return panelControl(x);
    const curricula = x.que === 'curricula';
    const materia = esc(nombreMateria());
    const alcance = esc(estado.alcance.tipo === 'provincia' ? 'toda la provincia' : nombreAlcance());
    const anios = aniosDeLaMateria();
    const opciones = curricula ? `
      <p class="t-panel__bajada">La currícula de <strong>${materia}</strong> tal como está hoy en el catálogo: todos los años, con sus saberes y contenidos. Sin respuestas de docentes. Es para mandarle a un profesor y que la revise.</p>
      <div class="t-panel__separador"></div>` : `
      <div class="t-panel__grupo">
        <div class="t-panel__etiqueta">Qué descargar <span class="t-panel__contexto">${materia} · ${alcance}</span></div>
        <div class="t-formatos">
          ${anios.length > 1 ? formatoPanel('ex-que', 'materia', x.que === 'materia', 'Toda la materia', esc(textoAnios(anios))) : ''}
          ${formatoPanel('ex-que', 'anio', x.que === 'anio', `Solo ${esc(textoAnio())}`, 'los tres trimestres')}
        </div>
      </div>`;
    return `<div class="t-velo" data-accion="cerrar-exportar"></div>
    <div class="t-panel" role="dialog" aria-modal="true" aria-labelledby="exportar-titulo">
      <div class="t-panel__cabecera">
        <h2 class="t-panel__titulo" id="exportar-titulo">${curricula ? 'Descargar para revisar' : 'Descargar resultados'}</h2>
        <button type="button" class="t-panel__cerrar" data-accion="cerrar-exportar" aria-label="Cerrar">${Icono.cerrar}</button>
      </div>
      ${opciones}
      <div class="t-panel__grupo">
        <div class="t-panel__etiqueta">En qué formato</div>
        <div class="t-formatos">
          ${formatoPanel('ex-formato', 'pdf', x.formato === 'pdf', 'PDF', 'para imprimir y presentar')}
          ${formatoPanel('ex-formato', 'excel', x.formato === 'excel', 'Excel', 'para seguir trabajando')}
        </div>
      </div>
      ${!curricula && x.formato === 'pdf' ? `
      <div class="t-panel__grupo">
        <div class="t-panel__etiqueta">Cómo se ve el PDF</div>
        <div class="t-formatos">
          ${formatoPanel('ex-vista', 'barras', x.vista === 'barras', 'Gráficos de barras', 'cada saber con sus contenidos')}
          ${formatoPanel('ex-vista', 'mapa', x.vista === 'mapa', 'Mapa de calor', 'los ejes por trimestre')}
        </div>
      </div>` : ''}
      <div class="t-panel__nota">${notaExportar(x)}</div>
      ${x.progreso ? `<div class="t-panel__nota">${esc(x.progreso)}</div>` : ''}
      ${x.error ? `<div class="t-panel__nota t-panel__nota--error">${esc(x.error)}</div>` : ''}
      <div class="t-panel__acciones">
        <button type="button" class="t-descargar" data-accion="descargar" ${x.descargando ? 'disabled' : ''}>${x.descargando ? 'Preparando…' : 'Descargar'}</button>
        <button type="button" class="t-cancelar" data-accion="cerrar-exportar">Cancelar</button>
      </div>
    </div>`;
  }

  // Seguimiento de la carga (uso interno). Se abre desde un enlace discreto al
  // pie del inicio: no es un resultado y el inicio se proyecta en reuniones, así
  // que no se ofrece a la vista. Toda la provincia y todas las materias.
  function panelControl(x) {
    return `<div class="t-velo" data-accion="cerrar-exportar"></div>
    <div class="t-panel" role="dialog" aria-modal="true" aria-labelledby="control-titulo">
      <div class="t-panel__cabecera">
        <h2 class="t-panel__titulo" id="control-titulo">Seguimiento de la carga</h2>
        <button type="button" class="t-panel__cerrar" data-accion="cerrar-exportar" aria-label="Cerrar">${Icono.cerrar}</button>
      </div>
      <p class="t-panel__bajada">Un Excel para ver cómo avanza el relevamiento: los envíos que llegaron y las escuelas de las que todavía no llegó ninguno. De toda la provincia y de todas las materias.</p>
      <label class="t-opcion ${x.ejemplo ? 't-opcion--elegida' : ''}" for="ex-ejemplo">
        <input type="checkbox" id="ex-ejemplo" ${x.ejemplo ? 'checked' : ''} data-cambio="ex-ejemplo">
        <span><span class="t-opcion__titulo">Con los datos de ejemplo</span><span class="t-opcion__sub">Para ver cómo es la planilla antes de que lleguen cargas reales</span></span>
      </label>
      <div class="t-panel__nota t-panel__nota--interno">${notaExportar(x)}</div>
      ${x.progreso ? `<div class="t-panel__nota">${esc(x.progreso)}</div>` : ''}
      ${x.error ? `<div class="t-panel__nota t-panel__nota--error">${esc(x.error)}</div>` : ''}
      <div class="t-panel__acciones">
        <button type="button" class="t-descargar" data-accion="descargar" ${x.descargando ? 'disabled' : ''}>${x.descargando ? 'Preparando…' : 'Descargar el Excel'}</button>
        <button type="button" class="t-cancelar" data-accion="cerrar-exportar">Cancelar</button>
      </div>
    </div>`;
  }

  function cargarSheetJS() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((resolver, rechazar) => {
      const s = document.createElement('script');
      s.src = URL_SHEETJS;
      s.onload = () => resolver();
      s.onerror = () => rechazar(new Error('No se pudo cargar la librería para armar el Excel.'));
      document.head.appendChild(s);
    });
  }

  const limpioArchivo = (t) => normalizarTexto(t).replace(/\s+/g, '-');
  const hoyArchivo = () => new Date().toISOString().slice(0, 10);

  function nombreArchivo(reportes) {
    const anios = reportes.length > 1 ? 'todos-los-anios' : `${reportes[0].anio}-anio`;
    const partes = ['resultados', limpioArchivo(nombreMateria()), anios, limpioArchivo(textoAlcance())];
    if (estado.ejemplo) partes.push('ejemplo');
    return partes.join('-') + '.xlsx';
  }

  // Los resultados de la materia, año por año, con el alcance elegido. El año
  // que se está mirando ya está calculado; los otros se piden a la base.
  async function traerReportes(anios) {
    const reportes = [];
    for (const anio of anios) {
      if (anio === estado.anio && estado.datos) { reportes.push({ anio, datos: estado.datos }); continue; }
      if (estado.exportar) { estado.exportar.progreso = `Calculando ${anio}° año…`; render(); }
      const { data, error } = await sb.rpc('panel_resultados', {
        p_espacio_id: estado.espacio_id,
        p_anio: anio,
        p_trimestre: null,
        p_departamento_id: estado.alcance.tipo === 'departamento' ? estado.alcance.id : null,
        p_escuela_id: estado.alcance.tipo === 'escuela' ? estado.alcance.id : null,
        p_ejemplo: estado.ejemplo,
      });
      if (error) throw new Error(`No pudimos traer los resultados de ${anio}° año. Revisá la conexión y volvé a intentar.`);
      reportes.push({ anio, datos: prepararDatos(data) });
    }
    // Un año sin saberes en el diseño (pasa en algunas materias) no va al reporte
    const conSaberes = reportes.filter((r) => r.datos.saberes.length);
    if (!conSaberes.length) throw new Error(`${nombreMateria()} no tiene saberes en ${textoAnios(anios)}.`);
    return conSaberes;
  }

  async function descargar() {
    const x = estado.exportar;
    if (!x || x.descargando) return;
    x.error = null;
    if (x.que === 'curricula') { await descargarCurricula(x); return; }
    x.descargando = true;
    x.progreso = 'Preparando el archivo…';
    render();
    try {
      if (x.que === 'control') {
        await cargarSheetJS();
        window.XLSX.writeFile(await libroControl(x.ejemplo), `seguimiento-de-la-carga-${hoyArchivo()}${x.ejemplo ? '-ejemplo' : ''}.xlsx`);
        estado.exportar = null;
      } else {
        const reportes = await traerReportes(x.que === 'materia' ? aniosDeLaMateria() : [estado.anio]);
        if (x.formato === 'pdf') { imprimir(documentoReporte(reportes, x.vista)); return; }
        await cargarSheetJS();
        window.XLSX.writeFile(libroReporte(reportes), nombreArchivo(reportes));
        estado.exportar = null;
      }
    } catch (e) {
      x.descargando = false;
      x.progreso = null;
      x.error = (e && e.message) || 'No pudimos armar el archivo. Volvé a intentar.';
    }
    render();
  }

  /* ---------- La currícula de la materia (sin resultados) ---------- */

  // Lo que hay hoy en el catálogo de la materia, todos los años: para que el
  // equipo lo revise con un profesor. Sale de la base (catalogo_filas), así
  // incluye lo editado aunque todavía no se haya publicado.
  async function traerCurricula() {
    const { data, error } = await sb.rpc('catalogo_filas', { p_espacio_id: estado.espacio_id, p_anio: null });
    if (error || (data && data.error)) throw new Error('No pudimos traer el catálogo de la materia. Volvé a intentar.');
    const saberes = new Map();
    for (const f of data || []) {
      if (f.saber_estado !== 'activo') continue;
      if (!saberes.has(f.saber_id)) {
        saberes.set(f.saber_id, { anio: f.anio, trimestre: f.trimestre, eje: partirEje(f.eje, f.eje_orden), texto: f.saber, contenidos: [] });
      }
      if (f.contenido && f.contenido_estado === 'activo') saberes.get(f.saber_id).contenidos.push(f.contenido);
    }
    // catalogo_filas ya viene por año, trimestre y orden del equipo
    const grupos = [];
    for (const s of saberes.values()) {
      const clave = `${s.anio == null ? 0 : s.anio}|${s.trimestre}`;
      let g = grupos[grupos.length - 1];
      if (!g || g.clave !== clave) { g = { clave, anio: s.anio, trimestre: s.trimestre, saberes: [] }; grupos.push(g); }
      g.saberes.push(s);
    }
    return grupos;
  }

  const textoAnioCurricula = (a) => (a == null ? 'Todo el ciclo' : `${a}° año`);

  function libroCurricula(grupos) {
    const X = window.XLSX;
    const filas = [
      [`${nombreMateria()} — Saberes y contenidos del diseño curricular`],
      [`Como está hoy en el catálogo · ${fechaLarga(new Date())}`],
      ['Los saberes van en el orden en que se enseñan. En «Observaciones» se puede anotar si falta, sobra o hay que corregir algo.'],
      [],
    ];
    const cabecera = ['Año', 'Trimestre', 'Eje', 'Saber', 'Contenido', 'Observaciones'];
    filas.push(cabecera);
    const inicio = filas.length;
    for (const g of grupos) {
      g.saberes.forEach((s, i) => {
        const base = [textoAnioCurricula(g.anio), `${ORDINAL[g.trimestre]} trimestre`, `${s.eje.rotulo} — ${s.eje.nombre}`, `${i + 1}. ${s.texto}`];
        if (!s.contenidos.length) { filas.push(base.concat(['(sin contenidos)', ''])); return; }
        s.contenidos.forEach((c, k) => filas.push((k === 0 ? base : ['', '', '', '']).concat([c, ''])));
      });
    }
    const hoja = X.utils.aoa_to_sheet(filas);
    hoja['!cols'] = [{ wch: 12 }, { wch: 13 }, { wch: 34 }, { wch: 70 }, { wch: 60 }, { wch: 40 }];
    hoja['!autofilter'] = { ref: X.utils.encode_range({ s: { r: inicio - 1, c: 0 }, e: { r: filas.length - 1, c: cabecera.length - 1 } }) };
    const libro = X.utils.book_new();
    X.utils.book_append_sheet(libro, hoja, 'Currícula');
    return libro;
  }

  function documentoCurricula(grupos) {
    // Un año por página; los trimestres del mismo año, seguidos
    const bloques = grupos.map((g, i) => `
      <section class="t-doc__trimestre ${i > 0 && grupos[i - 1].anio !== g.anio ? 't-doc__trimestre--anio' : ''}">
        <h2 class="t-doc__trimestre-titulo">${esc(textoAnioCurricula(g.anio))} · ${ORDINAL[g.trimestre]} trimestre <span>· ${g.saberes.length} ${plural(g.saberes.length, 'saber', 'saberes')}</span></h2>
        ${g.saberes.map((s, i) => `
          <div class="t-doc__saber">
            <div class="t-doc__rotulo">Saber ${i + 1} · ${esc(s.eje.rotulo)} — ${esc(s.eje.nombre)}</div>
            <div class="t-doc__texto">${esc(s.texto)}</div>
            ${s.contenidos.length
              ? `<ul class="t-doc__lista">${s.contenidos.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
              : '<p class="t-doc__nota">Sin contenidos cargados.</p>'}
          </div>`).join('')}
      </section>`).join('');
    return `<article class="t-doc t-doc--curricula">
      <header class="t-doc__cabeza">
        ${marcaDocumento()}
        <div class="t-doc__institucion">Ministerio de Cultura y Educación · Dirección de Educación Secundaria · Formosa</div>
        <h1 class="t-doc__titulo">${esc(nombreMateria())}</h1>
        <div class="t-doc__sub">Saberes y contenidos del diseño curricular</div>
        <div class="t-doc__datos">Como está hoy en el catálogo · ${esc(fechaLarga(new Date()))}</div>
        <p class="t-doc__lectura">Por año y trimestre, los saberes en el orden en que se enseñan y, debajo de cada uno, sus contenidos.</p>
      </header>
      ${bloques}
    </article>`;
  }

  // Pone el documento en la página, abre la impresión del navegador (de ahí sale
  // el PDF) y al cerrarla lo saca
  function imprimir(html) {
    estado.documento = html;
    estado.exportar = null;
    render();
    window.addEventListener('afterprint', () => { estado.documento = null; render(); }, { once: true });
    setTimeout(() => window.print(), 150);
  }

  async function descargarCurricula(x) {
    x.descargando = true;
    x.progreso = 'Trayendo el catálogo de la materia…';
    render();
    try {
      const grupos = await traerCurricula();
      if (!grupos.length) throw new Error('La materia no tiene saberes activos.');
      if (x.formato === 'pdf') { imprimir(documentoCurricula(grupos)); return; }
      await cargarSheetJS();
      const limpio = normalizarTexto(nombreMateria()).replace(/\s+/g, '-');
      window.XLSX.writeFile(libroCurricula(grupos), `curricula-${limpio}-${new Date().toISOString().slice(0, 10)}.xlsx`);
      estado.exportar = null;
    } catch (e) {
      x.descargando = false;
      x.progreso = null;
      x.error = (e && e.message) || 'No pudimos armar el archivo. Volvé a intentar.';
    }
    render();
  }

  // El reporte de la materia en Excel: una sola hoja que se lee como la
  // currícula. El equipo la manda a los profesores para que confirmen o
  // corrijan: solo lo que hace falta para eso, y una columna para anotar. El
  // saber se escribe una vez, en su primera fila; debajo, sus contenidos. Con
  // varios años, una columna más adelante dice de qué año es cada fila.
  function libroReporte(reportes) {
    const X = window.XLSX;
    const conAnio = reportes.length > 1;
    const base = conAnio
      ? reportes.map((r) => `${r.anio}° año: ${textoBase(r.datos.contexto)}`).join(' · ')
      : textoBase(reportes[0].datos.contexto);
    const filas = [
      [`${nombreMateria()} · ${textoAnios(reportes.map((r) => r.anio))} — Contenidos que priorizan los docentes`],
      [`${textoAlcance()} · ${base} · Datos al ${fechaLarga(new Date())}`],
    ];
    if (estado.ejemplo) filas.push(['DATOS DE EJEMPLO: inventados para mostrar cómo se ve. No son respuestas de docentes.']);
    filas.push(['El porcentaje es sobre los docentes que trabajan ese saber. En «Observaciones» se puede anotar si falta, sobra o hay que corregir algo.']);
    filas.push([]);
    const cabecera = (conAnio ? ['Año'] : []).concat(['Trimestre', 'Saber', 'Eje', 'Contenido priorizado', '% de docentes', 'Observaciones']);
    filas.push(cabecera);
    const inicioDatos = filas.length;
    const vacias = (n) => Array(n).fill('');
    for (const { anio, datos: d } of reportes) {
      let primeraDelAnio = true;
      for (const t of [1, 2, 3]) {
        d.porTrimestre[t].forEach((s, i) => {
          const rotulos = (conAnio ? [primeraDelAnio ? `${anio}° año` : ''] : []).concat([i === 0 ? `${ORDINAL[t]} trimestre` : '']);
          primeraDelAnio = false;
          const inicio = rotulos.concat([`${s.numero}. ${s.texto}`, `${s.ejeInfo.rotulo} — ${s.ejeInfo.nombre}`]);
          const lista = s.suficiente ? (s.contenidos || []) : [];
          if (!lista.length) {
            const nota = !s.suficiente
              ? (s.trabajan ? `Muestra insuficiente: solo ${s.trabajan} ${plural(s.trabajan, 'docente lo trabaja', 'docentes lo trabajan')}` : 'Ningún docente lo informó todavía')
              : 'Sin contenidos elegidos';
            filas.push(inicio.concat([nota, '', '']));
            return;
          }
          lista.forEach((co, k) => {
            const texto = co.texto + (co.tipo === 'libre' ? ' (agregado por docentes)' : '');
            filas.push((k === 0 ? inicio : vacias(inicio.length)).concat([texto, Number(co.porcentaje) / 100, '']));
          });
        });
      }
    }
    const hoja = X.utils.aoa_to_sheet(filas);
    hoja['!cols'] = (conAnio ? [{ wch: 9 }] : []).concat([{ wch: 14 }, { wch: 70 }, { wch: 34 }, { wch: 60 }, { wch: 13 }, { wch: 40 }]);
    const columnaPct = conAnio ? 5 : 4;
    for (let r = inicioDatos; r < filas.length; r++) {
      const celda = hoja[X.utils.encode_cell({ r, c: columnaPct })];
      if (celda && typeof celda.v === 'number') celda.z = '0%';
    }
    hoja['!autofilter'] = { ref: X.utils.encode_range({ s: { r: inicioDatos - 1, c: 0 }, e: { r: filas.length - 1, c: cabecera.length - 1 } }) };
    const libro = X.utils.book_new();
    X.utils.book_append_sheet(libro, hoja, 'Resultados');
    return libro;
  }

  // Baja una vista entera de a páginas, avisando cuánto lleva
  async function traerTodo(vista, columnas, orden, aviso, ejemplo) {
    const filas = [];
    let desde = 0;
    for (;;) {
      let q = sb.from(vista).select(columnas.join(',')).eq('es_ejemplo', ejemplo);
      for (const o of orden) q = q.order(o);
      const { data, error } = await q.range(desde, desde + FILAS_POR_PAGINA - 1);
      if (error) throw new Error('La base de datos no respondió a mitad de la descarga. Volvé a intentar.');
      filas.push(...data);
      if (estado.exportar) { estado.exportar.progreso = `${aviso}… ${numero(filas.length)}`; render(); }
      if (data.length < FILAS_POR_PAGINA) return filas;
      desde += FILAS_POR_PAGINA;
    }
  }

  // Una hoja con un título y una aclaración arriba, y la tabla con filtro
  function hojaConTitulo(X, titulo, aclaraciones, cabecera, filas, anchos) {
    const arriba = [[titulo], ...aclaraciones.map((a) => [a]), []];
    const hoja = X.utils.aoa_to_sheet(arriba.concat([cabecera], filas));
    hoja['!cols'] = anchos.map((wch) => ({ wch }));
    hoja['!autofilter'] = { ref: X.utils.encode_range({ s: { r: arriba.length, c: 0 }, e: { r: arriba.length + filas.length, c: cabecera.length - 1 } }) };
    return hoja;
  }

  // Seguimiento de la carga (uso interno; antes era «Todo el relevamiento»,
  // dentro de Descargar resultados). Es para que el equipo vea qué docentes enviaron y de
  // qué escuelas falta respuesta; por eso trae nombres y no es para repartir.
  // Toda la provincia, todas las materias, sin mirar la selección del panel.
  async function libroControl(conEjemplo) {
    const X = window.XLSX;
    const ejemplo = conEjemplo ? ['DATOS DE EJEMPLO: inventados para mostrar cómo se ve. No son respuestas de docentes.'] : [];
    const fecha = `Datos al ${fechaLarga(new Date())}. Trae nombre y apellido de cada docente: es para uso interno, no para repartir.`;

    const aportes = await traerTodo('v_aportes',
      ['aporte_id', 'enviado_en', 'docente_id', 'apellido', 'nombre', 'escuela_id', 'escuela', 'localidad', 'departamento', 'espacio', 'anio'],
      ['aporte_id'], 'Trayendo los envíos', conEjemplo);
    // Se piden las columnas de orden solo para ordenar; en el archivo van las que lee una persona
    const respuestas = await traerTodo('v_relevamiento',
      ['aporte_id', 'enviado_en', 'departamento', 'escuela', 'localidad', 'apellido', 'nombre', 'espacio', 'anio', 'trimestre', 'eje', 'saber', 'saber_id', 'estado', 'tipo', 'contenido'],
      ['aporte_id', 'saber_id', 'contenido_orden'], 'Trayendo el detalle de cada envío', conEjemplo);
    if (estado.exportar) { estado.exportar.progreso = 'Armando el Excel…'; render(); }

    // Cuánto contestó cada envío
    const cuenta = new Map();
    for (const f of respuestas) {
      if (!cuenta.has(f.aporte_id)) cuenta.set(f.aporte_id, { trabaja: new Set(), noTrabaja: new Set(), contenidos: 0 });
      const c = cuenta.get(f.aporte_id);
      if (f.estado === 'no_trabaja') c.noTrabaja.add(f.saber_id);
      else { c.trabaja.add(f.saber_id); c.contenidos += 1; }
    }

    // 1 · Envíos: uno por fila
    const orden = (a, b) => ['departamento', 'escuela', 'apellido', 'nombre', 'espacio'].reduce((r, k) => r || String(a[k] || '').localeCompare(String(b[k] || ''), 'es'), 0) || (a.anio - b.anio);
    const quien = aportes.slice().sort(orden).map((a) => {
      const c = cuenta.get(a.aporte_id) || { trabaja: new Set(), noTrabaja: new Set(), contenidos: 0 };
      return [a.apellido || '', a.nombre || '', a.escuela || '', a.localidad || '', a.departamento || '', a.espacio || '', a.anio == null ? '' : `${a.anio}°`,
        a.enviado_en ? new Date(a.enviado_en).toLocaleString('es-AR') : '', c.trabaja.size, c.noTrabaja.size, c.contenidos];
    });
    const docentes = new Set(aportes.map((a) => a.docente_id)).size;

    // 2 · Por escuela: todas las de la nómina, en el orden oficial, y al final
    // las que agregaron los docentes. Las que no tienen envíos son las que faltan.
    const porEscuela = new Map();
    for (const a of aportes) {
      if (!porEscuela.has(a.escuela_id)) porEscuela.set(a.escuela_id, { docentes: new Set(), envios: 0, materias: new Set(), escuela: a.escuela, localidad: a.localidad, departamento: a.departamento });
      const e = porEscuela.get(a.escuela_id);
      e.docentes.add(a.docente_id); e.envios += 1; e.materias.add(a.espacio);
    }
    const filaEscuela = (depto, nombre, localidad, e) => [depto, nombre, localidad || '',
      e ? e.docentes.size : 0, e ? e.envios : 0, e ? [...e.materias].sort((x, y) => x.localeCompare(y, 'es')).join(', ') : '',
      e ? '' : 'Sin envíos todavía'];
    const escuelas = [];
    const oficiales = new Set();
    let sinRespuesta = 0;
    for (const { departamento, escuelas: lista } of Catalogo.buscarEscuelas('').grupos) {
      for (const es of lista) {
        oficiales.add(es.id);
        const e = porEscuela.get(es.id);
        if (!e) sinRespuesta += 1;
        escuelas.push(filaEscuela(departamento.nombre, es.nombre, es.localidad, e));
      }
    }
    for (const [id, e] of porEscuela) {
      if (!oficiales.has(id)) escuelas.push(filaEscuela(e.departamento || '', `${e.escuela} (la agregó un docente)`, e.localidad, e));
    }

    // 3 · Detalle: una fila por contenido elegido o saber que no trabaja
    const que = respuestas.map((f) => [
      f.enviado_en ? new Date(f.enviado_en).toLocaleString('es-AR') : '',
      f.departamento || '', f.escuela || '', f.localidad || '', f.apellido || '', f.nombre || '',
      f.espacio || '', f.anio == null ? '' : f.anio, f.trimestre == null ? '' : f.trimestre, f.eje || '', f.saber || '',
      f.estado === 'no_trabaja' ? 'no' : 'sí',
      f.contenido || '',
      f.tipo === 'libre' ? 'agregado por el docente' : (f.tipo === 'catalogo' ? 'sugerido' : ''),
    ]);

    const libro = X.utils.book_new();
    X.utils.book_append_sheet(libro, hojaConTitulo(X, 'Envíos — uso interno',
      [`${numero(aportes.length)} ${plural(aportes.length, 'envío', 'envíos')} de ${numero(docentes)} ${plural(docentes, 'docente', 'docentes')}. Un envío por fila: quien cargó dos materias aparece dos veces.`, fecha, ...ejemplo],
      ['Apellido', 'Nombre', 'Escuela', 'Localidad', 'Departamento', 'Materia', 'Año', 'Enviado', 'Saberes que trabaja', 'Saberes que no trabaja', 'Contenidos elegidos'],
      quien, [18, 18, 34, 20, 16, 30, 6, 18, 12, 12, 12]), 'Envíos');
    X.utils.book_append_sheet(libro, hojaConTitulo(X, 'Por escuela — uso interno',
      [`${numero(oficiales.size)} escuelas de la nómina, en el orden oficial. ${numero(sinRespuesta)} ${plural(sinRespuesta, 'todavía no tiene', 'todavía no tienen')} ningún envío: son las que dicen «Sin envíos todavía».`, fecha, ...ejemplo],
      ['Departamento', 'Escuela', 'Localidad', 'Docentes que enviaron', 'Envíos', 'Materias cargadas', 'Estado'],
      escuelas, [16, 40, 22, 12, 9, 60, 24]), 'Por escuela');
    X.utils.book_append_sheet(libro, hojaConTitulo(X, 'Detalle de cada envío — uso interno',
      ['Una fila por contenido elegido y por saber que el docente dijo que no trabaja.', fecha, ...ejemplo],
      ['Enviado', 'Departamento', 'Escuela', 'Localidad', 'Apellido', 'Nombre', 'Materia', 'Año', 'Trimestre', 'Eje', 'Saber', 'Lo trabaja', 'Contenido', 'Origen del contenido'],
      que, [18, 16, 36, 20, 18, 18, 28, 5, 9, 40, 70, 10, 60, 22]), 'Detalle');
    return libro;
  }

  /* ---------- Pantallas ---------- */

  // Ingreso: la misma composición que la bienvenida de escritorio del formulario
  function heroIngreso() {
    return `<section class="t-hero">
      <div class="marca-barra">
        <img class="marca-barra__simbolo" src="${RUTA_SIMBOLO_MINISTERIO}" alt="Ministerio de Cultura y Educación — Provincia de Formosa">
        <div class="marca-barra__separador"></div>
        <img class="marca-barra__simbolo marca-barra__simbolo--des" src="${RUTA_SIMBOLO_SECUNDARIA}" alt="Dirección de Educación Secundaria">
        <div class="marca-barra__nombre" aria-hidden="true"><span>Ministerio de Cultura y Educación</span><span>Educación Secundaria · Formosa</span></div>
      </div>
      <div class="espaciador"></div>
      <div class="t-hero__marca">${marcaResap({ titulo: true })}</div>
      <div class="espaciador"></div>
      <div class="t-hero__items">
        <div class="t-hero__item">${svg('<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>', { tam: 24, color: '#003380', grosor: 2 })}<div>Solo para el equipo de Planificación</div></div>
        <div class="t-hero__item">${svg('<path d="M4 14a8 8 0 0 1 14.5-4.6"/><path d="M18 5v5h-5"/><path d="M20 10a8 8 0 0 1-14.5 4.6"/><path d="M6 19v-5h5"/>', { tam: 24, color: '#003380', grosor: 2 })}<div>Se actualiza solo a medida que los docentes cargan</div></div>
        <div class="t-hero__item">${svg('<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>', { tam: 24, color: '#003380', grosor: 2 })}<div>Se exporta a Excel para trabajar y a PDF para presentar</div></div>
      </div>
    </section>`;
  }

  function pantallaIngreso() {
    const i = estado.ingreso;
    return `<div class="tablero t-ingreso">
      ${heroIngreso()}
      <section class="t-ingreso__cuerpo">
        <form class="t-ingreso__tarjeta" data-form="ingreso" novalidate>
          <div class="columna columna--10">
            <div class="t-ingreso__etiqueta">Planificación Curricular · Ciclo Básico</div>
            <h2 class="t-ingreso__titulo">Ingresá</h2>
            <p class="bajada">Con el correo y la contraseña que te dio el administrador.</p>
          </div>
          <div class="campo">
            <label class="campo__etiqueta" for="email">Correo</label>
            <input class="entrada" id="email" name="email" type="email" autocomplete="username" value="${esc(i.email)}" ${i.error ? 'aria-invalid="true"' : ''}>
          </div>
          <div class="campo">
            <label class="campo__etiqueta" for="clave">Contraseña</label>
            <input class="entrada" id="clave" name="clave" type="password" autocomplete="current-password">
          </div>
          ${i.error ? `<div class="error-campo" role="alert">${esc(i.error)}</div>` : ''}
          <button type="submit" class="boton boton--primario boton--66" ${i.enviando ? 'disabled' : ''}>${i.enviando ? 'Entrando…' : 'Entrar'}</button>
          <div class="ayuda ayuda--centrada">Si no tenés usuario, pedíselo al área de Planificación Curricular.</div>
        </form>
      </section>
    </div>`;
  }

  function pantallaSinPermiso() {
    const u = estado.usuario || {};
    const e = estado.errorPermiso;
    // Un reloj adelantado o atrasado hace que la base rechace la sesión
    const reloj = e && /future|iat|clock|expired|exp/i.test(e);
    const titulo = e ? 'No pudimos comprobar tu usuario' : 'Tu usuario todavía no está habilitado';
    const texto = !e
      ? `Entraste como <strong>${esc(u.email || '')}</strong>, pero ese usuario no está en el equipo de Planificación. Pedile al administrador que lo agregue y volvé a entrar.`
      : reloj
        ? 'La fecha y la hora de esta computadora no coinciden con las reales, y por eso la base no acepta la sesión. Corregilas (en Windows: Configuración → Hora e idioma → «Establecer la hora automáticamente») y volvé a intentar.'
        : 'La base de datos no respondió como esperábamos. Revisá la conexión y volvé a intentar. Si sigue igual, pasale al administrador los datos de abajo.';
    return `<div class="tablero t-ingreso">
      ${heroIngreso()}
      <section class="t-ingreso__cuerpo">
        <div class="t-ingreso__tarjeta">
          <h2 class="t-ingreso__titulo">${titulo}</h2>
          <p class="bajada">${texto}</p>
          <p class="t-ingreso__datos">Para el administrador: ${esc(u.email || '')} · código ${esc(u.id || '')}${e ? ` · ${esc(e)}` : ''}</p>
          ${e ? '<button type="button" class="boton boton--primario" data-accion="reintentar-permiso">Volver a intentar</button>' : ''}
          <button type="button" class="boton boton--secundario" data-accion="salir">Salir</button>
        </div>
      </section>
    </div>`;
  }

  function pantallaPanel() {
    if (estado.modo === 'catalogo') {
      return `<div class="tablero">
        ${cabecera()}
        ${selectores()}
        <div class="t-cuerpo ed-cuerpo">
          ${Editor.pantalla({ nombreMateria: nombreMateria(), textoAnio: textoAnio() })}
        </div>
        ${panelExportar()}
        ${estado.documento || ''}
      </div>`;
    }
    return `<div class="tablero">
      ${cabecera()}
      ${bandaEjemplo()}
      ${selectores()}
      ${lineaContexto()}
      <div class="t-cuerpo">
        ${cuerpo()}
      </div>
      ${panelExportar()}
      ${documentoImpresion()}
    </div>`;
  }

  /* ---------- Inicio ---------- */

  function saludo() {
    const nombre = estado.nombre ? estado.nombre.split(/\s+/)[0] : '';
    return nombre ? `Hola, ${nombre}` : 'Hola';
  }

  // Una sola línea: lo único que cambia de un día a otro
  function lineaEstadoInicio() {
    const i = estado.inicio;
    if (!i || i.cargas == null) return '';
    if (i.cargas > 0) return `<p class="t-inicio__estado">Los docentes ya enviaron <strong>${numero(i.cargas)} ${plural(i.cargas, 'carga', 'cargas')}</strong>.</p>`;
    return new Date() < new Date(2026, 8, 26)
      ? '<p class="t-inicio__estado">La carga de los docentes abre el <strong>viernes 26 de septiembre</strong>.</p>'
      : '<p class="t-inicio__estado">Todavía no llegó ninguna carga de docentes.</p>';
  }

  function pantallaInicio() {
    const flecha = svg('<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>', { tam: 22, color: '#003380', grosor: 2.4 });
    const opcion = (accion, icono, titulo, texto) => `
      <button type="button" class="t-inicio__opcion" data-accion="${accion}">
        <span class="t-inicio__icono">${icono}</span>
        <span class="t-inicio__opcion-textos">
          <span class="t-inicio__opcion-titulo">${titulo}</span>
          <span class="t-inicio__opcion-texto">${texto}</span>
        </span>
        <span class="t-inicio__flecha">${flecha}</span>
      </button>`;
    return `<div class="tablero">
      ${cabecera()}
      <main class="t-inicio">
        <div class="t-inicio__marco">
          <div class="t-inicio__hola">${esc(saludo())}</div>
          <div class="t-inicio__marca">${marcaResap({ titulo: true })}</div>
          <div id="inicio-estado">${lineaEstadoInicio()}</div>
          <div class="t-inicio__opciones">
            ${opcion('ir-resultados',
              svg('<path d="M4 20h16"/><rect x="5" y="11" width="3" height="6"/><rect x="10.5" y="7" width="3" height="10"/><rect x="16" y="4" width="3" height="13"/>', { tam: 28, color: '#003380', grosor: 2 }),
              'Ver los resultados',
              'Qué contenidos eligen los docentes, materia por materia.')}
            ${opcion('ir-catalogo',
              svg('<path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>', { tam: 28, color: '#003380', grosor: 2 }),
              'Editar el catálogo',
              'Los saberes y contenidos que ven los docentes.')}
          </div>
          <div class="t-inicio__pie">
            <button type="button" class="t-enlace-discreto" data-accion="abrir-control">Seguimiento de la carga</button>
          </div>
        </div>
      </main>
      ${panelExportar()}
    </div>`;
  }

  function pantallaCargando() {
    return `<div class="tablero">${cabecera()}<div class="t-estado"><div class="t-estado__texto">Cargando…</div></div></div>`;
  }

  // Movimiento: el panel se redibuja entero en cada acción, así que cada
  // animación corre solo si hay algo nuevo: otra sección, otros datos u otra
  // vista, un panel que recién se abre. Con «reducir movimiento», nada (CSS).
  const previo = { seccion: null, datos: null, vista: null, editor: null };

  function animarLoNuevo(habiaPanel) {
    const seccion = estado.pantalla + '|' + estado.modo;
    if (seccion !== previo.seccion) {
      const t = app.querySelector('.t-inicio__marco, .t-hero__marca, .t-ingreso__tarjeta');
      if (t) t.classList.add('t-entra');
    }
    if (estado.pantalla === 'panel' && estado.modo !== 'catalogo' && estado.datos
        && (estado.datos !== previo.datos || estado.vista !== previo.vista)) {
      const cuerpo = app.querySelector('.t-columnas, .t-mapa');
      if (cuerpo) {
        cuerpo.classList.add('t-entra');
        app.querySelectorAll('.t-barra').forEach((b) => b.classList.add('t-barra--crece'));
        previo.datos = estado.datos;
        previo.vista = estado.vista;
      }
    }
    // En el editor, solo al cambiar de materia o año: después de cada edición
    // los datos se vuelven a pedir, y que la lista entera parpadee cada vez que
    // se mueve un saber molestaría
    const materiaEditor = Editor.estado.espacio_id + '|' + Editor.estado.anio;
    if (estado.modo === 'catalogo' && Editor.estado.datos && materiaEditor !== previo.editor) {
      if (app.querySelector('.ed-lista, .ed-vacio')) {
        app.querySelectorAll('.ed-trimestre, .ed-vacio').forEach((el) => el.classList.add('t-entra'));
        previo.editor = materiaEditor;
      }
    }
    if (estado.modo !== 'catalogo') previo.editor = null;
    if (!habiaPanel) app.querySelectorAll('.t-panel, .t-velo').forEach((el) => el.classList.add('t-panel--entra'));
    previo.seccion = seccion;
  }

  function render() {
    const fn = { ingreso: pantallaIngreso, 'sin-permiso': pantallaSinPermiso, inicio: pantallaInicio, panel: pantallaPanel }[estado.pantalla] || pantallaCargando;
    const habiaPanel = !!app.querySelector('.t-panel');
    app.innerHTML = fn();
    animarLoNuevo(habiaPanel);
    document.body.style.overflow = estado.exportar ? 'hidden' : '';
    // La primera vez que se entra a cada pantalla, el recorrido arranca solo
    if (estado.pantalla === 'panel' && !estado.cargandoDatos && !Editor.estado.cargando) {
      Tour.quizas(estado.modo === 'catalogo' ? 'catalogo' : 'resultados');
    }
  }

  /* ======================================================================
     Eventos
     ====================================================================== */

  app.addEventListener('click', (e) => {
    const objetivo = e.target.closest('[data-accion]');
    if (!objetivo) return;
    const d = objetivo.dataset;
    if (d.accion.startsWith('ed-') || d.accion.startsWith('ar-')) { Editor.manejar(d.accion, d, objetivo); return; }
    switch (d.accion) {
      case 'salir': salir(); break;
      case 'reintentar-permiso': estado.pantalla = 'cargando'; render(); verificarSesion(); break;
      case 'reintentar': cargarDatos(); break;
      case 'alternar-ejemplo': estado.ejemplo = !estado.ejemplo; escribirHash(); cargarDatos(); break;
      case 'tour': Tour.iniciar(estado.modo === 'catalogo' ? 'catalogo' : 'resultados'); break;
      case 'ir-inicio': irAlInicio(); break;
      case 'ir-resultados': irAlPanel('resultados'); break;
      case 'ir-catalogo': irAlPanel('catalogo'); break;
      case 'alternar-modo':
        estado.modo = estado.modo === 'catalogo' ? 'resultados' : 'catalogo';
        Editor.limpiar();
        escribirHash();
        cargarDatos();
        break;
      case 'vista': if (estado.vista !== d.vista) { estado.vista = d.vista; escribirHash(); render(); } break;
      case 'alternar-saber':
        if (estado.abiertos.has(d.id)) estado.abiertos.delete(d.id); else estado.abiertos.add(d.id);
        render();
        break;
      case 'abrir-revisar': estado.exportar = { que: 'curricula', formato: 'excel', progreso: null, error: null, descargando: false }; render(); break;
      case 'abrir-exportar':
        estado.exportar = {
          que: aniosDeLaMateria().length > 1 ? 'materia' : 'anio',
          formato: 'pdf',
          vista: estado.vista === 'mapa' ? 'mapa' : 'barras',
          progreso: null, error: null, descargando: false,
        };
        render();
        break;
      case 'abrir-control': estado.exportar = { que: 'control', ejemplo: estado.ejemplo, progreso: null, error: null, descargando: false }; render(); break;
      case 'cerrar-exportar': if (!(estado.exportar && estado.exportar.descargando)) { estado.exportar = null; render(); } break;
      case 'descargar': descargar(); break;
      default: break;
    }
  });

  app.addEventListener('change', (e) => {
    // El archivo que sube el equipo para importar el catálogo
    const subida = e.target.closest('[data-accion="ar-elegir"]');
    if (subida) { Editor.manejar('ar-elegir', subida.dataset, subida); return; }
    const el = e.target.closest('[data-cambio]');
    if (!el) return;
    switch (el.dataset.cambio) {
      case 'materia': {
        estado.espacio_id = el.value;
        const esp = Catalogo.espacio(estado.espacio_id);
        if (esp && !esp.anios_dictados.includes(estado.anio)) estado.anio = esp.anios_dictados[0];
        escribirHash();
        cargarDatos();
        break;
      }
      case 'anio': estado.anio = Number(el.value); escribirHash(); cargarDatos(); break;
      case 'alcance': {
        const [tipo, id] = el.value.split(':');
        estado.alcance = tipo === 'provincia' ? { tipo: 'provincia' } : { tipo, id };
        escribirHash();
        cargarDatos();
        break;
      }
      case 'ex-que': if (estado.exportar) { estado.exportar.que = el.value; estado.exportar.error = null; render(); } break;
      case 'ex-formato': if (estado.exportar) { estado.exportar.formato = el.value; estado.exportar.error = null; render(); } break;
      case 'ex-ejemplo': if (estado.exportar) { estado.exportar.ejemplo = el.checked; estado.exportar.error = null; render(); } break;
      case 'ex-vista': if (estado.exportar) { estado.exportar.vista = el.value; estado.exportar.error = null; render(); } break;
      default: break;
    }
  });

  app.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form="ingreso"]');
    if (!form) return;
    e.preventDefault();
    const email = form.email.value.trim();
    const clave = form.clave.value;
    if (!email || !clave) { estado.ingreso.error = 'Escribí tu correo y tu contraseña para entrar.'; estado.ingreso.email = email; render(); return; }
    ingresar(email, clave);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && estado.exportar && !estado.exportar.descargando) { estado.exportar = null; render(); }
  });

  sb.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT' && estado.pantalla !== 'ingreso') { estado.pantalla = 'ingreso'; estado.usuario = null; render(); }
  });

  /* ======================================================================
     Arranque
     ====================================================================== */

  async function iniciar() {
    render();
    try {
      await Catalogo.cargar();
    } catch (e) {
      app.innerHTML = '<div class="t-estado"><div class="t-estado__titulo">No pudimos cargar el diseño curricular</div><div class="t-estado__texto">Revisá la conexión y volvé a cargar la página.</div></div>';
      return;
    }
    // Arranca con una selección puesta: la primera materia de Matemática, 1° año
    estado.espacio_id = Catalogo.espacio('matematica') ? 'matematica' : Catalogo.espaciosPorArea(Catalogo.areas()[0].id)[0].id;
    leerHash();
    verificarSesion();
  }

  iniciar();
})();
