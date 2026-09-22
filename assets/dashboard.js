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

  const svg = (contenido, { tam = 22, color = '#0B4F4A', grosor = 2.4 } = {}) =>
    `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${grosor}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${contenido}</svg>`;
  const Icono = {
    descargar: svg('<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>', { tam: 21, color: '#FFFFFF' }),
    chevron: svg('<path d="M6 9l6 6 6-6"/>', { tam: 17, grosor: 2.6 }),
    info: svg('<circle cx="12" cy="12" r="9.2"/><path d="M12 11v6"/><path d="M12 7.6v.2"/>', { color: '#66706A', grosor: 2.2 }),
    cerrar: svg('<path d="M6 6l12 12"/><path d="M18 6L6 18"/>', { tam: 21, color: '#55605A' }),
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
    pantalla: 'cargando',     // cargando | ingreso | sin-permiso | panel
    usuario: null,
    espacio_id: null,
    anio: 1,
    alcance: { tipo: 'provincia' },   // | { tipo: 'departamento', id } | { tipo: 'escuela', id }
    vista: 'detalle',                 // detalle | mapa
    modo: 'resultados',               // resultados | catalogo (editar el diseño)
    ejemplo: false,
    datos: null,
    cargandoDatos: false,
    errorDatos: null,
    abiertos: new Set(),
    escuelasAgregadas: [],
    ingreso: { email: '', error: null, enviando: false },
    exportar: null,                   // { que: 'vista'|'todo', formato: 'excel'|'pdf', progreso, error }
  };

  function leerHash() {
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (h.get('materia') && Catalogo.espacio(h.get('materia'))) estado.espacio_id = h.get('materia');
    if (['1', '2', '3'].includes(h.get('anio'))) estado.anio = Number(h.get('anio'));
    if (h.get('departamento')) estado.alcance = { tipo: 'departamento', id: h.get('departamento') };
    else if (h.get('escuela')) estado.alcance = { tipo: 'escuela', id: h.get('escuela') };
    if (h.get('vista') === 'mapa') estado.vista = 'mapa';
    if (h.get('modo') === 'catalogo') estado.modo = 'catalogo';
    if (h.get('ejemplo') === '1') estado.ejemplo = true;
  }
  function escribirHash() {
    const h = new URLSearchParams();
    h.set('materia', estado.espacio_id);
    h.set('anio', String(estado.anio));
    if (estado.alcance.tipo === 'departamento') h.set('departamento', estado.alcance.id);
    if (estado.alcance.tipo === 'escuela') h.set('escuela', estado.alcance.id);
    if (estado.vista === 'mapa') h.set('vista', 'mapa');
    if (estado.modo === 'catalogo') h.set('modo', 'catalogo');
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
    const { data: fila } = await sb.from('equipo_planificacion').select('usuario_id').eq('usuario_id', sesion.user.id).maybeSingle();
    if (!fila) { estado.pantalla = 'sin-permiso'; render(); return; }
    estado.pantalla = 'panel';
    Editor.iniciar(sb, { render, refrescar: () => Editor.cargar(estado.espacio_id, estado.anio) });
    await cargarEscuelasAgregadas();
    escribirHash();
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
        <div class="t-cabecera__separador"></div>
        <div class="t-cabecera__rotulo">Contenidos priorizados · Resolución 672</div>
      </div>
      <div class="t-cabecera__derecha">
        <div class="t-cabecera__fecha">Datos al ${esc(fechaLarga(new Date()))}</div>
        ${estado.pantalla === 'panel' ? `
        <button type="button" class="t-salir t-ayuda" data-accion="tour" title="Ver cómo se usa esta pantalla">¿Cómo se usa?</button>
        <button type="button" class="t-salir t-modo" data-accion="alternar-modo">${estado.modo === 'catalogo' ? 'Ver resultados' : 'Editar catálogo'}</button>
        <button type="button" class="t-interruptor ${estado.ejemplo ? 't-interruptor--activo' : ''} ${estado.modo === 'catalogo' ? 'oculto-visual' : ''}" data-accion="alternar-ejemplo" aria-pressed="${estado.ejemplo}">
          <span class="t-interruptor__pista"></span>Datos de ejemplo
        </button>
        <button type="button" class="t-salir" data-accion="salir">Salir</button>` : ''}
      </div>
    </header>`;
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
      ${estado.modo === 'catalogo' ? '' : `<button type="button" class="t-exportar" data-accion="abrir-exportar">${Icono.descargar}Exportar</button>`}
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

  function bloqueImpresion() {
    return `<div class="t-impresion">
      <div class="t-impresion__titulo">Contenidos priorizados · ${esc(nombreMateria())} · ${esc(textoAnio())}</div>
      <div class="t-impresion__sub">${esc(nombreAlcance())} · Datos al ${esc(fechaLarga(new Date()))}${estado.ejemplo ? ' · DATOS DE EJEMPLO, no son respuestas de docentes' : ''}</div>
    </div>`;
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
      <div class="t-saber__eje">${esc(s.ejeInfo.rotulo)} — ${esc(s.ejeInfo.nombre)}</div>
      <div class="t-saber__rotulo">Saber ${s.numero}</div>
      <div class="t-saber__texto">${esc(s.texto)}</div>
      ${base}
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

  function vistaMapa() {
    const d = estado.datos;
    const docentes = d.contexto.docentes;
    // Ejes en el orden del diseño
    const ejes = [];
    const porEje = new Map();
    for (const s of d.saberes) {
      const clave = s.eje_orden + '|' + s.eje;
      if (!porEje.has(clave)) { porEje.set(clave, { info: s.ejeInfo, saberes: [] }); ejes.push(clave); }
      porEje.get(clave).saberes.push(s);
    }
    const contenidosPorTrimestre = { 1: 0, 2: 0, 3: 0 };
    for (const s of d.saberes) contenidosPorTrimestre[s.trimestre] += (s.contenidos || []).length;

    const filas = ejes.map((clave) => {
      const { info, saberes } = porEje.get(clave);
      const totalContenidos = saberes.reduce((n, s) => n + (s.contenidos || []).length, 0);
      const celdas = [1, 2, 3].map((t) => {
        const del = saberes.filter((s) => s.trimestre === t);
        const rotulo = `<div class="t-celda__trimestre">${ORDINAL[t]} TRIMESTRE</div>`;
        if (!del.length) return `<div class="t-celda">${rotulo}<div class="t-celda__vacia">El diseño curricular no ubica ningún saber de este eje en el ${ORDINAL[t]} trimestre.</div></div>`;
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
        const visibles = tiles.slice(0, TILES_POR_CELDA);
        const mas = tiles.length - visibles.length;
        if (!tiles.length) return `<div class="t-celda">${rotulo}<div class="t-celda__vacia">Ningún docente informó todavía contenidos de este eje en el ${ORDINAL[t]} trimestre.</div></div>`;
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
          <div class="t-leyenda__grupo"><span>pocos</span><div class="t-leyenda__escala"><div style="background:#EDEBE3"></div><div style="background:#D3E5DF"></div><div style="background:#A9CFC4"></div><div style="background:#74B0A1"></div><div style="background:#34796B"></div><div style="background:#0B4F4A"></div></div><span>casi todos</span></div>
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

  function panelExportar() {
    const x = estado.exportar;
    if (!x) return '';
    const c = estado.datos ? estado.datos.contexto : { docentes: 0 };
    const pdfConTodo = x.que === 'todo' && x.formato === 'pdf';
    return `<div class="t-velo" data-accion="cerrar-exportar"></div>
    <div class="t-panel" role="dialog" aria-modal="true" aria-labelledby="exportar-titulo">
      <div class="t-panel__cabecera">
        <h2 class="t-panel__titulo" id="exportar-titulo">Exportar</h2>
        <button type="button" class="t-panel__cerrar" data-accion="cerrar-exportar" aria-label="Cerrar">${Icono.cerrar}</button>
      </div>
      <div class="t-panel__grupo">
        <div class="t-panel__etiqueta">Qué exportar</div>
        <label class="t-opcion ${x.que === 'vista' ? 't-opcion--elegida' : ''}" for="ex-vista">
          <input type="radio" id="ex-vista" name="ex-que" value="vista" ${x.que === 'vista' ? 'checked' : ''} data-cambio="ex-que">
          <span><span class="t-opcion__titulo">Lo que estoy viendo</span><span class="t-opcion__sub">${esc(nombreMateria())} · ${esc(textoAnio())} · los tres trimestres · ${esc(estado.alcance.tipo === 'provincia' ? 'toda la provincia' : nombreAlcance())}</span></span>
        </label>
        <label class="t-opcion ${x.que === 'todo' ? 't-opcion--elegida' : ''}" for="ex-todo">
          <input type="radio" id="ex-todo" name="ex-que" value="todo" ${x.que === 'todo' ? 'checked' : ''} data-cambio="ex-que">
          <span><span class="t-opcion__titulo">Todo el relevamiento provincial</span><span class="t-opcion__sub">Todas las materias · 1° a 3° año · una fila por contenido elegido${estado.ejemplo ? ' · datos de ejemplo' : ''}</span></span>
        </label>
      </div>
      <div class="t-panel__separador"></div>
      <div class="t-panel__grupo">
        <div class="t-panel__etiqueta">En qué formato</div>
        <div class="t-formatos">
          <label class="t-formato ${x.formato === 'excel' ? 't-formato--elegido' : ''}" for="fm-excel">
            <span class="t-formato__cabeza"><input type="radio" id="fm-excel" name="ex-formato" value="excel" ${x.formato === 'excel' ? 'checked' : ''} data-cambio="ex-formato"><span class="t-formato__titulo">Excel</span></span>
            <span class="t-formato__sub">para seguir trabajando</span>
          </label>
          <label class="t-formato ${x.formato === 'pdf' ? 't-formato--elegido' : ''}" for="fm-pdf">
            <span class="t-formato__cabeza"><input type="radio" id="fm-pdf" name="ex-formato" value="pdf" ${x.formato === 'pdf' ? 'checked' : ''} data-cambio="ex-formato"><span class="t-formato__titulo">PDF</span></span>
            <span class="t-formato__sub">para presentar</span>
          </label>
        </div>
      </div>
      ${pdfConTodo ? '<div class="t-panel__nota">El PDF arma una presentación de lo que estás viendo. Para todo el relevamiento, usá Excel: son demasiadas páginas para un PDF.</div>' : ''}
      ${x.formato === 'pdf' && !pdfConTodo ? '<div class="t-panel__nota">Se abre la ventana de impresión del navegador: elegí «Guardar como PDF».</div>' : ''}
      ${x.progreso ? `<div class="t-panel__nota">${esc(x.progreso)}</div>` : ''}
      ${x.error ? `<div class="t-panel__nota t-panel__nota--error">${esc(x.error)}</div>` : ''}
      <div class="t-panel__acciones">
        <button type="button" class="t-descargar" data-accion="descargar" ${x.descargando || pdfConTodo ? 'disabled' : ''}>${x.descargando ? 'Preparando…' : 'Descargar'}</button>
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

  function nombreArchivo(sufijo) {
    const limpio = (t) => normalizarTexto(t).replace(/\s+/g, '-');
    const partes = ['relevamiento', sufijo === 'todo' ? 'provincial-completo' : `${limpio(nombreMateria())}-${estado.anio}-anio-${limpio(nombreAlcance())}`];
    if (estado.ejemplo) partes.push('ejemplo');
    return partes.join('-') + '.xlsx';
  }

  async function descargar() {
    const x = estado.exportar;
    if (!x || x.descargando) return;
    x.error = null;
    if (x.formato === 'pdf') {
      if (x.que === 'todo') return;
      estado.exportar = null;
      render();
      setTimeout(() => window.print(), 150);
      return;
    }
    x.descargando = true;
    x.progreso = 'Preparando el archivo…';
    render();
    try {
      await cargarSheetJS();
      const libro = x.que === 'todo' ? await libroCompleto() : libroVista();
      window.XLSX.writeFile(libro, nombreArchivo(x.que));
      estado.exportar = null;
    } catch (e) {
      x.descargando = false;
      x.progreso = null;
      x.error = (e && e.message) || 'No pudimos armar el archivo. Volvé a intentar.';
    }
    render();
  }

  // «Lo que estoy viendo»: dos hojas, resumen y contenidos
  function libroVista() {
    const X = window.XLSX;
    const d = estado.datos;
    const resumen = [
      ['Relevamiento curricular · Contenidos priorizados'],
      ['Materia', nombreMateria()],
      ['Año', textoAnio()],
      ['Alcance', nombreAlcance()],
      ['Docentes', d.contexto.docentes],
      ['Escuelas', d.contexto.escuelas],
      ['Datos al', fechaLarga(new Date())],
      ['Datos de ejemplo', estado.ejemplo ? 'SÍ — inventados para la demostración' : 'No'],
      [],
      ['Muestra insuficiente: menos de ' + MUESTRA_MINIMA + ' docentes trabajan el saber. En esos casos no se informan porcentajes.'],
    ];
    const filas = [['Trimestre', 'Eje', 'N° saber', 'Saber', 'Docentes que informaron', 'Lo trabajan', 'No lo trabajan', 'Contenido', 'Origen', 'Docentes que lo eligieron', 'Porcentaje']];
    for (const s of d.saberes) {
      const base = [s.trimestre, `${s.ejeInfo.rotulo} — ${s.ejeInfo.nombre}`, s.numero, s.texto, s.informan, s.trabajan, s.no_trabajan];
      if (!s.suficiente) { filas.push(base.concat(['(muestra insuficiente)', '', '', ''])); continue; }
      if (!(s.contenidos || []).length) { filas.push(base.concat(['', '', '', ''])); continue; }
      for (const c of s.contenidos) filas.push(base.concat([c.texto, c.tipo === 'libre' ? 'agregado por docentes' : 'catálogo', c.docentes, Number(c.porcentaje) / 100]));
    }
    const libro = X.utils.book_new();
    const h1 = X.utils.aoa_to_sheet(resumen);
    h1['!cols'] = [{ wch: 22 }, { wch: 60 }];
    X.utils.book_append_sheet(libro, h1, 'Resumen');
    const h2 = X.utils.aoa_to_sheet(filas);
    h2['!cols'] = [{ wch: 10 }, { wch: 40 }, { wch: 9 }, { wch: 70 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 60 }, { wch: 20 }, { wch: 12 }, { wch: 11 }];
    for (let r = 1; r < filas.length; r++) { const celda = h2[X.utils.encode_cell({ r, c: 10 })]; if (celda && typeof celda.v === 'number') celda.z = '0%'; }
    X.utils.book_append_sheet(libro, h2, 'Contenidos');
    return libro;
  }

  // «Todo el relevamiento»: v_relevamiento completa, paginada
  async function libroCompleto() {
    const X = window.XLSX;
    const columnas = ['aporte_id', 'enviado_en', 'departamento', 'escuela', 'localidad', 'apellido', 'nombre', 'area', 'espacio', 'anio', 'trimestre', 'eje_orden', 'eje', 'saber_orden', 'saber_id', 'saber', 'estado', 'tipo', 'contenido', 'contenido_orden'];
    const filas = [['Aporte', 'Enviado', 'Departamento', 'Escuela', 'Localidad', 'Apellido', 'Nombre', 'Área', 'Materia', 'Año', 'Trimestre', 'Orden eje', 'Eje', 'Orden saber', 'Id saber', 'Saber', 'Estado', 'Origen del contenido', 'Contenido', 'Orden']];
    let desde = 0;
    for (;;) {
      const { data, error } = await sb.from('v_relevamiento').select(columnas.join(','))
        .eq('es_ejemplo', estado.ejemplo)
        .order('aporte_id').order('saber_id').order('contenido_orden')
        .range(desde, desde + FILAS_POR_PAGINA - 1);
      if (error) throw new Error('La base de datos no respondió a mitad de la descarga. Volvé a intentar.');
      for (const f of data) filas.push(columnas.map((c) => {
        if (c === 'estado') return f.estado === 'no_trabaja' ? 'no trabaja el saber' : 'trabaja';
        if (c === 'tipo') return f.tipo === 'libre' ? 'agregado por docente' : (f.tipo === 'catalogo' ? 'catálogo' : '');
        if (c === 'enviado_en') return f.enviado_en ? new Date(f.enviado_en).toLocaleString('es-AR') : '';
        return f[c] == null ? '' : f[c];
      }));
      estado.exportar.progreso = `Descargando… ${numero(filas.length - 1)} filas`;
      render();
      if (data.length < FILAS_POR_PAGINA) break;
      desde += FILAS_POR_PAGINA;
    }
    const libro = X.utils.book_new();
    const hoja = X.utils.aoa_to_sheet(filas);
    hoja['!cols'] = [{ wch: 8 }, { wch: 18 }, { wch: 16 }, { wch: 40 }, { wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 28 }, { wch: 28 }, { wch: 5 }, { wch: 9 }, { wch: 9 }, { wch: 40 }, { wch: 11 }, { wch: 26 }, { wch: 70 }, { wch: 20 }, { wch: 20 }, { wch: 60 }, { wch: 6 }];
    X.utils.book_append_sheet(libro, hoja, 'Relevamiento');
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
      <div class="t-hero__textos">
        <div class="t-hero__etiqueta">Planificación Curricular · Resolución 672</div>
        <h1 class="t-hero__titulo">Panel de resultados</h1>
        <p class="t-hero__bajada">Qué contenidos priorizan los docentes de la provincia, materia por materia, escuela por escuela.</p>
      </div>
      <div class="espaciador"></div>
      <div class="t-hero__items">
        <div class="t-hero__item">${svg('<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>', { tam: 24, color: '#9FC8BD', grosor: 2 })}<div>Solo para el equipo de Planificación</div></div>
        <div class="t-hero__item">${svg('<path d="M4 14a8 8 0 0 1 14.5-4.6"/><path d="M18 5v5h-5"/><path d="M20 10a8 8 0 0 1-14.5 4.6"/><path d="M6 19v-5h5"/>', { tam: 24, color: '#9FC8BD', grosor: 2 })}<div>Se actualiza solo a medida que los docentes cargan</div></div>
        <div class="t-hero__item">${svg('<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>', { tam: 24, color: '#9FC8BD', grosor: 2 })}<div>Se exporta a Excel para trabajar y a PDF para presentar</div></div>
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
    return `<div class="tablero t-ingreso">
      ${heroIngreso()}
      <section class="t-ingreso__cuerpo">
        <div class="t-ingreso__tarjeta">
          <h2 class="t-ingreso__titulo">Tu usuario todavía no está habilitado</h2>
          <p class="bajada">Entraste como <strong>${esc(estado.usuario ? estado.usuario.email : '')}</strong>, pero ese usuario no está en el equipo de Planificación. Pedile al administrador que lo agregue y volvé a entrar.</p>
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
      </div>`;
    }
    return `<div class="tablero">
      ${cabecera()}
      ${bandaEjemplo()}
      ${selectores()}
      ${lineaContexto()}
      <div class="t-cuerpo">
        ${bloqueImpresion()}
        ${cuerpo()}
      </div>
      ${panelExportar()}
    </div>`;
  }

  function pantallaCargando() {
    return `<div class="tablero">${cabecera()}<div class="t-estado"><div class="t-estado__texto">Cargando…</div></div></div>`;
  }

  function render() {
    const fn = { ingreso: pantallaIngreso, 'sin-permiso': pantallaSinPermiso, panel: pantallaPanel }[estado.pantalla] || pantallaCargando;
    app.innerHTML = fn();
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
    if (d.accion.startsWith('ed-')) { Editor.manejar(d.accion, d); return; }
    switch (d.accion) {
      case 'salir': salir(); break;
      case 'reintentar': cargarDatos(); break;
      case 'alternar-ejemplo': estado.ejemplo = !estado.ejemplo; escribirHash(); cargarDatos(); break;
      case 'tour': Tour.iniciar(estado.modo === 'catalogo' ? 'catalogo' : 'resultados'); break;
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
      case 'abrir-exportar': estado.exportar = { que: 'vista', formato: 'excel', progreso: null, error: null, descargando: false }; render(); break;
      case 'cerrar-exportar': if (!(estado.exportar && estado.exportar.descargando)) { estado.exportar = null; render(); } break;
      case 'descargar': descargar(); break;
      default: break;
    }
  });

  app.addEventListener('change', (e) => {
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
