/* ============================================================================
   Diseño curricular unificado — la sección «Diseño» del panel.

   Lo pidió el equipo técnico el 12/11/2026, con la carga cerrada: que el panel
   pueda cerrar el diseño curricular completo, con lo que cargaron los
   docentes como insumo, y entregarlo en un solo documento con carátula y el
   marco argumentativo. Y que el equipo lo pueda editar antes de cerrarlo.

   - Para cada año de cada materia (en las artísticas, una vez para todo el
     ciclo), el panel arma una propuesta con las cargas: los saberes que trabaja
     la mayoría de los docentes que los informaron quedan en el diseño, los de
     poco acuerdo quedan «para revisar», y los contenidos van de más a menos
     elegidos, con los más elegidos ya incluidos.
   - El equipo la edita: corrige textos, saca o vuelve a poner saberes, incluye
     o saca contenidos, agrega los que falten, cambia el orden. Cada cambio se
     guarda solo (sql/19_diseno_unificado.sql) y otra persona del equipo lo ve.
   - Cuando un año está listo, se cierra. Cerrado, no se cambia hasta reabrirlo.
   - «Descargar el diseño» arma el PDF: carátula, índice, marco argumentativo,
     cómo leerlo y las 16 materias. Mientras falte cerrar algo, sale como
     borrador.

   No toca el catálogo ni lo que ven los docentes en el formulario.
   ============================================================================ */

const Diseno = (function () {
  'use strict';

  const URL_MAMMOTH = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
  const URL_DOCX = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js';
  const LOGO_MINISTERIO = 'assets/img/logo-ministerio.webp';
  const LOGO_DES = 'assets/img/logo-secundaria.webp';
  // Word no lee webp: para el .docx, los mismos logos de la nota modelo
  const LOGO_MINISTERIO_JPG = 'assets/img/nota-logo-ministerio.jpg';
  const LOGO_DES_PNG = 'assets/img/nota-logo-secundaria.png';
  const RESAP_SIMBOLO = 'assets/img/resap-simbolo.png';
  const RESAP_PALABRA = 'assets/img/resap-palabra.png';
  const ORDINAL = { 1: '1er', 2: '2do', 3: '3er' };
  const OTROS_VISIBLES = 8;   // contenidos no incluidos a la vista antes de «ver todos»

  // Con qué se arma la propuesta. Se cambian en «Carátula, marco y criterios».
  const CRITERIOS_INICIALES = {
    saber: 50,      // % de los docentes que lo informaron que lo trabajan, para quedar en el diseño
    contenido: 30,  // % de los que trabajan el saber que eligieron el contenido, para incluirlo
    minimo: 5,      // con menos docentes que lo informaron, el saber queda para revisar
  };

  const CARATULA_INICIAL = {
    titulo: 'Diseño Curricular Unificado',
    subtitulo: 'Ciclo Básico del Nivel Secundario',
    bajada: 'Construido con los aportes de {{DOCENTES}} docentes de la provincia, a través de ReSaP',
    lugar: 'Formosa, 2026',
    vigencia: 'Rige a partir del ciclo lectivo 2027',
    autoridades: '',
  };

  // El marco argumentativo que mandó el equipo (Marco_argumentativo_diseno_unificado.docx)
  const MARCO_INICIAL = [
    '<h2>Marco argumentativo del Diseño Curricular Unificado</h2>',
    '<p>El diseño curricular unificado del Nivel Secundario no fue escrito para los docentes: fue construido con ellos. Lo respaldan 5.000 docentes, 11.428 cargas y la participación de todas las escuelas secundarias en actividad de la provincia.</p>',
    '<h3>Por qué un diseño único y cómo se construyó</h3>',
    '<p>La Secundaria es una sola unidad pedagógica en toda la provincia, y cada estudiante tiene derecho a aprender los mismos saberes centrales, viva donde viva. Un diseño común garantiza esa equidad y facilita los pases entre escuelas y la articulación con el nivel superior.</p>',
    '<p>Para construirlo, la Dirección de Educación Secundaria consultó a los docentes a través de ReSaP, una herramienta digital que relevó, materia por materia, qué saberes consideran prioritarios.</p>',
    '<p>En promedio, cada docente realizó más de dos cargas: las prioridades se relevaron por materia y por año, no como una opinión general.</p>',
    '<p>Con esas respuestas, el equipo técnico identificó coincidencias y diferencias, y las contrastó con los NAP y la normativa vigente.</p>',
    '<h3>Qué le da legitimidad</h3>',
    '<ol>',
    '<li><strong>Es participativo.</strong> Expresa lo que 5.000 docentes señalaron como prioritario. No es un diseño que llega «desde arriba».</li>',
    '<li><strong>Es territorial.</strong> Participaron todas las escuelas en actividad: urbanas, rurales y de todas las regiones. Ninguna quedó sin voz.</li>',
    '<li><strong>Se basa en evidencia.</strong> Con más de 11.000 cargas, las coincidencias entre docentes marcan consensos reales sobre qué enseñar.</li>',
    '<li><strong>Tiene respaldo normativo.</strong> La Ley General de Educación N.° 1613 establece la unidad del sistema (art. 8), resultados de calidad equivalente en toda la provincia (art. 9), una estructura curricular integrada por nivel (art. 13) y la validación de saberes con participación desde el territorio (art. 89).</li>',
    '</ol>',
    '<h3>Qué significa para cada docente</h3>',
    '<p>A partir de 2027, el diseño unificado rige como documento para planificar e implementar los contenidos priorizados.</p>',
    '<ul>',
    '<li><strong>Fija lo común:</strong> los saberes que todo estudiante de la provincia debe aprender en cada materia y año.</li>',
    '<li><strong>Respeta lo propio:</strong> cada escuela conserva su autonomía pedagógica para contextualizarlo en su proyecto institucional (Ley 1613, art. 94).</li>',
    '<li><strong>Viene con acompañamiento:</strong> las necesidades que surjan en esta jornada orientarán el trabajo del equipo técnico en 2027.</li>',
    '</ul>',
    '<blockquote><p>«Este diseño curricular lleva la voz de 5.000 docentes formoseños. Cada escuela secundaria de la provincia participó, y cada una de las 11.428 cargas se transformó en evidencia para decidir qué enseñar. Es nuestro diseño.»</p></blockquote>',
  ].join('');

  const OPCIONES_INICIALES = { consenso: true, porcentajes: false };

  // Lo que se puede escribir en la carátula y el marco, y se completa con los números de hoy
  const CAMPOS = [['DOCENTES', 'docentes que cargaron'], ['CARGAS', 'cargas'], ['ESCUELAS', 'escuelas con cargas']];

  const PERMITIDAS = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'H2', 'H3', 'BLOCKQUOTE', 'DIV']);

  let sb = null;
  let d = null;          // lo que presta el panel: render, imprimir, numero, partirEje…
  let relojDoc = null;   // autoguardado de la carátula y el marco

  const st = {
    activo: false,
    vista: 'resumen',    // resumen | materia | documento
    espacio_id: null,
    anio: null,
    general: null,       // lo de diseno_estado(): materias tocadas, relevamiento, documento, presentaciones
    cargando: false,
    error: null,
    sinTablas: null,     // sql/19 sin correr: lo que respondió la base
    m: null,             // el año abierto: { espacio_id, anio, datos, version, estado, guardada, … }
    cargandoMateria: false,
    errorMateria: null,
    filtro: 'todos',     // todos | revisar
    editando: null,      // 's:<id>' | 'c:<saber>:<clave>' | 'nc:<saber>' | 'ns:<trimestre>' | 'pres'
    otros: new Set(),    // saberes con «otros que eligieron» abiertos
    todos: new Set(),    // … y con todos a la vista, no solo los primeros
    confirmar: null,     // 'volver'
    guardando: false,
    pendiente: false,
    conflicto: false,
    errorAccion: null,
    aviso: null,
    doc: null,           // { datos, version, guardando, estado, error, conflicto, sucio }
    descargar: null,     // la ventana de descargar: { todas, elegidas, conMarco, formato, progreso, error, descargando }
  };

  /* ---------- Utilidades ---------- */

  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  const plural = (n, uno, varios) => (n === 1 ? uno : varios);
  const numero = (n) => Number(n || 0).toLocaleString('es-AR');
  const clave = (espacio, anio) => `${espacio}|${anio}`;
  const nuevoId = (prefijo) => `${prefijo}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const svg = (c, { tam = 18, color = '#003380', grosor = 2.2 } = {}) =>
    `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${grosor}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${c}</svg>`;
  const Icono = {
    lapiz: svg('<path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>'),
    restaurar: svg('<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v5h5"/>'),
    mas: svg('<path d="M12 5v14"/><path d="M5 12h14"/>'),
    arriba: svg('<path d="M6 15l6-6 6 6"/>', { tam: 20, grosor: 2.4 }),
    abajo: svg('<path d="M6 9l6 6 6-6"/>', { tam: 20, grosor: 2.4 }),
    descargar: svg('<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>', { tam: 21, color: '#FFFFFF' }),
    bajar: svg('<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>', { tam: 19 }),
    candado: svg('<rect x="5" y="11" width="14" height="9"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', { tam: 18, color: '#FFFFFF', grosor: 2.2 }),
    abierto: svg('<rect x="5" y="11" width="14" height="9"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>', { tam: 18, grosor: 2.2 }),
    chevron: svg('<path d="M6 9l6 6 6-6"/>', { tam: 16, grosor: 2.6 }),
    cerrar: svg('<path d="M6 6l12 12"/><path d="M18 6L6 18"/>', { tam: 21, color: '#535D71' }),
  };

  // «hoy 10:42», «ayer 18:05», «12 nov»
  function cuando(ts) {
    if (!ts) return '';
    const f = new Date(ts);
    const h = new Date();
    const dias = Math.round((new Date(h.getFullYear(), h.getMonth(), h.getDate()) - new Date(f.getFullYear(), f.getMonth(), f.getDate())) / 86400000);
    const hora = f.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    if (dias === 0) return `hoy ${hora}`;
    if (dias === 1) return `ayer ${hora}`;
    return f.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  }

  function limpiarHTML(html) {
    const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
    const raiz = doc.body.firstElementChild;
    const recorrer = (nodo) => {
      for (const hijo of [...nodo.childNodes]) {
        if (hijo.nodeType === 1) {
          recorrer(hijo);
          if (hijo.tagName === 'H1') { const h = doc.createElement('h2'); h.append(...hijo.childNodes); hijo.replaceWith(h); continue; }
          if (['H4', 'H5', 'H6'].includes(hijo.tagName)) { const h = doc.createElement('h3'); h.append(...hijo.childNodes); hijo.replaceWith(h); continue; }
          if (!PERMITIDAS.has(hijo.tagName)) {
            if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'TEMPLATE', 'IMG'].includes(hijo.tagName)) hijo.remove();
            else hijo.replaceWith(...hijo.childNodes);
          } else {
            for (const a of [...hijo.attributes]) hijo.removeAttribute(a.name);
            if (hijo.tagName === 'DIV') { const p = doc.createElement('p'); p.append(...hijo.childNodes); hijo.replaceWith(p); }
          }
        } else if (hijo.nodeType !== 3) hijo.remove();
      }
    };
    recorrer(raiz);
    return raiz.innerHTML;
  }

  function cargarScript(url, global) {
    if (window[global]) return Promise.resolve();
    return new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => ok();
      s.onerror = () => mal(new Error('No se pudo cargar una librería. Revisá la conexión y volvé a intentar.'));
      document.head.appendChild(s);
    });
  }

  /* ---------- Qué hay que cerrar ---------- */

  // Cada año de cada materia, en el orden del catálogo. Las artísticas no
  // diferencian saberes por año: van una vez, como «todo el ciclo» (año 0).
  function unidades() {
    const lista = [];
    for (const area of Catalogo.areas()) {
      for (const esp of Catalogo.espaciosPorArea(area.id)) {
        const anios = esp.saberes_por_ciclo ? [0] : esp.anios_dictados.slice().sort();
        for (const anio of anios) lista.push({ area, esp, anio, conSaberes: tieneSaberes(esp, anio) });
      }
    }
    return lista;
  }
  function tieneSaberes(esp, anio) {
    const t = Catalogo.saberesPorTramo(esp.id, anio || 1);
    return t[1].length + t[2].length + t[3].length > 0;
  }
  const textoAnio = (anio) => (anio ? `${anio}° año` : 'Todo el ciclo');
  const nombreMateria = (esp) => (Catalogo.esArtistica(esp) ? esp.nombre : Catalogo.nombreCorto(esp));
  const filaDe = (espacio, anio) => (st.general ? st.general.materias.find((m) => m.espacio_id === espacio && m.anio === anio) : null) || null;

  function criterios() {
    const c = (st.general && st.general.documento && st.general.documento.datos && st.general.documento.datos.criterios) || {};
    return Object.assign({}, CRITERIOS_INICIALES, c);
  }
  function datosDocumento() {
    const g = (st.doc && st.doc.datos) || (st.general && st.general.documento && st.general.documento.datos) || {};
    return {
      caratula: Object.assign({}, CARATULA_INICIAL, g.caratula || {}),
      marco: g.marco != null ? g.marco : MARCO_INICIAL,
      opciones: Object.assign({}, OPCIONES_INICIALES, g.opciones || {}),
      criterios: Object.assign({}, CRITERIOS_INICIALES, g.criterios || {}),
    };
  }
  function conCampos(texto) {
    const r = (st.general && st.general.relevamiento) || {};
    return String(texto || '')
      .replace(/\{\{DOCENTES\}\}/g, numero(r.docentes))
      .replace(/\{\{CARGAS\}\}/g, numero(r.cargas))
      .replace(/\{\{ESCUELAS\}\}/g, numero(r.escuelas));
  }

  /* ---------- La propuesta ---------- */

  // De lo que cargaron los docentes (diseno_propuesta) a un año del diseño.
  // Un saber queda si lo trabaja al menos criterios.saber % de los docentes
  // que lo informaron (y lo informaron al menos criterios.minimo); si no,
  // queda para revisar. Un contenido entra si lo eligió al menos
  // criterios.contenido % de los que trabajan el saber; si ninguno llega, el
  // más elegido. El orden de los saberes es el del equipo (el ciclado de la
  // materia); los contenidos, de más a menos elegidos.
  function armar(crudo, crit) {
    const c = Object.assign({}, CRITERIOS_INICIALES, crit || {});
    const saberes = (crudo.saberes || []).map((s) => {
      const pct = s.informan ? Math.round((100 * s.trabajan) / s.informan) : 0;
      let estado = 'prioritario';
      let motivo = null;
      if (s.informan < c.minimo) { estado = 'revisar'; motivo = 'muestra'; }
      else if (pct < c.saber) { estado = 'revisar'; motivo = 'consenso'; }
      let contenidos = (s.contenidos || []).map((co, i) => ({
        clave: `c${i + 1}`, texto: co.texto, texto_original: co.texto,
        origen: co.tipo === 'catalogo' ? 'catalogo' : 'docentes', docentes: co.docentes || 0, incluido: false,
      }));
      if (s.trabajan > 0) {
        for (const co of contenidos) co.incluido = co.docentes > 0 && (100 * co.docentes) / s.trabajan >= c.contenido;
        if (!contenidos.some((x) => x.incluido)) {
          const max = Math.max(0, ...contenidos.map((x) => x.docentes));
          if (max > 0) contenidos.forEach((x) => { if (x.docentes === max) x.incluido = true; });
        }
      }
      contenidos = contenidos.filter((x) => x.incluido).concat(contenidos.filter((x) => !x.incluido));
      return {
        id: s.id, eje_id: s.eje_id, trimestre: [1, 2, 3].includes(s.trimestre) ? s.trimestre : 1,
        texto: s.texto, texto_original: s.texto, estado, motivo, origen: 'catalogo',
        informan: s.informan || 0, trabajan: s.trabajan || 0, no_trabajan: s.no_trabajan || 0, contenidos,
      };
    });
    return { base: Object.assign({}, crudo.base || {}, { armada_en: new Date().toISOString(), criterios: c }), saberes };
  }

  async function traerPropuesta(espacio, anio) {
    const { data, error } = await sb.rpc('diseno_propuesta', { p_espacio_id: espacio, p_anio: anio });
    if (error || !data || data.error) throw new Error((data && data.error) || 'No pudimos traer las cargas de esa materia. Revisá la conexión y volvé a intentar.');
    return data;
  }

  /* ---------- Datos ---------- */

  async function cargarGeneral() {
    st.cargando = true;
    st.error = null;
    d.render();
    const { data, error } = await sb.rpc('diseno_estado');
    st.cargando = false;
    if (error) {
      // La función no existe todavía: falta correr sql/19
      st.sinTablas = error.message || String(error);
      st.general = null;
    } else if (data && data.error) {
      st.error = data.error;
    } else {
      st.sinTablas = null;
      st.general = data;
      if (!st.doc || !st.doc.sucio) {
        st.doc = { datos: (data.documento && data.documento.datos) || {}, version: data.documento ? data.documento.actualizado_en : null,
          guardando: false, estado: '', error: null, conflicto: false, sucio: false };
      }
    }
    d.render();
  }

  async function abrirMateria(espacio, anio) {
    const esp = Catalogo.espacio(espacio);
    if (!esp) return;
    if (esp.saberes_por_ciclo) anio = 0;
    else if (!esp.anios_dictados.includes(anio)) anio = esp.anios_dictados[0];
    Object.assign(st, { vista: 'materia', espacio_id: espacio, anio, m: null, cargandoMateria: true, errorMateria: null,
      editando: null, confirmar: null, errorAccion: null, aviso: null, conflicto: false, filtro: 'todos' });
    st.otros = new Set();
    st.todos = new Set();
    d.escribirHash();
    d.render();
    window.scrollTo(0, 0);
    try {
      const { data: fila, error } = await sb.from('diseno_materias')
        .select('espacio_id, anio, datos, estado, actualizada_en, cerrada_en').eq('espacio_id', espacio).eq('anio', anio).maybeSingle();
      if (error) throw new Error('No pudimos traer lo que guardó el equipo. Revisá la conexión y volvé a intentar.');
      if (st.espacio_id !== espacio || st.anio !== anio) return;   // se cambió de materia mientras tanto
      const resumen = filaDe(espacio, anio);
      if (fila) {
        st.m = { espacio_id: espacio, anio, datos: fila.datos, version: fila.actualizada_en, estado: fila.estado, guardada: true,
          actualizada_en: fila.actualizada_en, actualizada_por: resumen ? resumen.actualizada_por : null,
          cerrada_en: fila.cerrada_en, cerrada_por: resumen ? resumen.cerrada_por : null };
      } else {
        const crudo = await traerPropuesta(espacio, anio);
        if (st.espacio_id !== espacio || st.anio !== anio) return;
        st.m = { espacio_id: espacio, anio, datos: armar(crudo, criterios()), version: null, estado: 'en_revision', guardada: false };
      }
    } catch (e) {
      st.errorMateria = (e && e.message) || 'No pudimos armar la propuesta. Volvé a intentar.';
    }
    st.cargandoMateria = false;
    d.render();
  }

  // Después de guardar, cerrar o reabrir: la línea del resumen al día
  function actualizarResumen(extra) {
    if (!st.general || !st.m) return;
    const m = st.m;
    let fila = filaDe(m.espacio_id, m.anio);
    if (!fila) { fila = { espacio_id: m.espacio_id, anio: m.anio }; st.general.materias.push(fila); }
    Object.assign(fila, { estado: m.estado, actualizada_en: m.actualizada_en, actualizada_por: m.actualizada_por, cerrada_en: m.cerrada_en, cerrada_por: m.cerrada_por }, extra || {});
  }

  /* ---------- Guardar un año ---------- */

  const editable = () => st.m && st.m.estado !== 'cerrada' && !st.conflicto;

  // Cada cambio se aplica en pantalla y se guarda enseguida. Si hay un
  // guardado en curso, se guarda lo último cuando termina.
  function cambiar(fn) {
    if (!editable()) return;
    fn(st.m.datos);
    st.errorAccion = null;
    st.aviso = null;
    d.render();
    guardar();
  }

  async function guardar() {
    const m = st.m;
    if (!m || !editable()) return;
    if (st.guardando) { st.pendiente = true; return; }
    st.guardando = true;
    pintarGuardado('Guardando…');
    const { data, error } = await sb.rpc('guardar_diseno_materia', {
      p_espacio_id: m.espacio_id, p_anio: m.anio, p_datos: m.datos, p_version: m.version,
    });
    st.guardando = false;
    if (st.m !== m) return;
    if (error || !data || data.error) {
      st.pendiente = false;
      st.conflicto = !!(data && data.conflicto);
      st.errorAccion = (data && data.error) || 'No pudimos guardar el cambio. Revisá la conexión: lo que hiciste sigue en pantalla y se guarda con el próximo cambio.';
      d.render();
      return;
    }
    Object.assign(m, { version: data.actualizada_en, actualizada_en: data.actualizada_en, actualizada_por: d.nombreUsuario() || 'vos', guardada: true });
    actualizarResumen();
    if (st.pendiente) { st.pendiente = false; guardar(); return; }
    pintarGuardado(textoGuardado());
  }

  // Solo la línea de «Guardado»: redibujar todo borraría lo que se está escribiendo
  function pintarGuardado(texto) {
    const el = document.getElementById('ds-guardado');
    if (el) el.textContent = texto;
  }
  function textoGuardado() {
    const m = st.m;
    if (!m) return '';
    if (!m.guardada) return 'Es la propuesta que sale de las cargas: todavía nadie del equipo la cambió.';
    return `Guardado ${cuando(m.actualizada_en)}${m.actualizada_por ? ` (${m.actualizada_por})` : ''}.`;
  }

  async function cerrar(cerrarlo) {
    const m = st.m;
    if (!m || st.guardando) return;
    st.errorAccion = null;
    st.aviso = null;
    if (cerrarlo) {
      const revisar = m.datos.saberes.filter((s) => s.estado === 'revisar').length;
      if (revisar) {
        st.errorAccion = revisar === 1
          ? 'Queda 1 saber para revisar: decidí si queda en el diseño o sale, y después cerrá el año.'
          : `Quedan ${revisar} saberes para revisar: decidí si cada uno queda en el diseño o sale, y después cerrá el año.`;
        st.filtro = 'revisar';
        d.render();
        return;
      }
      // Un año que nadie tocó se guarda primero: se cierra la propuesta tal cual
      if (!m.guardada) {
        await guardar();
        if (!m.guardada) return;
      }
    }
    st.guardando = true;
    d.render();
    const { data, error } = await sb.rpc('cerrar_diseno_materia', {
      p_espacio_id: m.espacio_id, p_anio: m.anio, p_cerrar: cerrarlo, p_version: m.version,
    });
    st.guardando = false;
    if (error || !data || data.error) {
      st.conflicto = !!(data && data.conflicto);
      st.errorAccion = (data && data.error) || 'No pudimos guardar el cambio. Revisá la conexión y volvé a intentar.';
      d.render();
      return;
    }
    const yo = d.nombreUsuario() || 'vos';
    Object.assign(m, { estado: data.estado, version: data.actualizada_en, actualizada_en: data.actualizada_en,
      cerrada_en: cerrarlo ? data.actualizada_en : null, cerrada_por: cerrarlo ? yo : null });
    actualizarResumen();
    st.editando = null;
    const esp = Catalogo.espacio(m.espacio_id);
    st.aviso = cerrarlo
      ? `Listo: ${nombreMateria(esp)} · ${textoAnio(m.anio).toLowerCase()} quedó cerrado. ${siguientePendiente() ? 'Podés seguir con el próximo que falta.' : 'Era el último: el diseño completo está cerrado.'}`
      : 'Reabierto: ya se puede cambiar. Cuando termines, volvé a cerrarlo.';
    d.render();
  }

  // El próximo año sin cerrar, en el orden del catálogo
  function siguientePendiente() {
    return unidades().find((u) => u.conSaberes && !(filaDe(u.esp.id, u.anio) && filaDe(u.esp.id, u.anio).estado === 'cerrada')) || null;
  }

  async function volverAArmar() {
    const m = st.m;
    if (!m) return;
    st.confirmar = null;
    st.guardando = true;
    d.render();
    const { data, error } = await sb.rpc('volver_a_armar_diseno', { p_espacio_id: m.espacio_id, p_anio: m.anio });
    st.guardando = false;
    if (error || !data || data.error) {
      st.errorAccion = (data && data.error) || 'No pudimos volver a armarlo. Revisá la conexión y volvé a intentar.';
      d.render();
      return;
    }
    if (st.general) st.general.materias = st.general.materias.filter((x) => !(x.espacio_id === m.espacio_id && x.anio === m.anio));
    await abrirMateria(m.espacio_id, m.anio);
    st.aviso = 'Volvió a armarse con las cargas de hoy. Lo que había quedó guardado en la base, por si hace falta recuperarlo.';
    d.render();
  }

  /* ---------- Cambios en un año ---------- */

  const saberPorId = (id) => st.m.datos.saberes.find((s) => s.id === id);

  function moverSaber(id, hacia) {
    cambiar((datos) => {
      const lista = datos.saberes;
      const i = lista.findIndex((s) => s.id === id);
      if (i < 0) return;
      const t = lista[i].trimestre;
      let j = i + hacia;
      while (j >= 0 && j < lista.length && lista[j].trimestre !== t) j += hacia;
      if (j < 0 || j >= lista.length) return;
      [lista[i], lista[j]] = [lista[j], lista[i]];
    });
  }

  function moverContenido(saberId, cl, hacia) {
    cambiar(() => {
      const s = saberPorId(saberId);
      const incl = s.contenidos.filter((c) => c.incluido);
      const resto = s.contenidos.filter((c) => !c.incluido);
      const i = incl.findIndex((c) => c.clave === cl);
      const j = i + hacia;
      if (i < 0 || j < 0 || j >= incl.length) return;
      [incl[i], incl[j]] = [incl[j], incl[i]];
      s.contenidos = incl.concat(resto);
    });
  }

  function incluir(saberId, cl, si) {
    cambiar(() => {
      const s = saberPorId(saberId);
      const c = s.contenidos.find((x) => x.clave === cl);
      if (!c) return;
      c.incluido = si;
      // Lo que se suma va al final de los incluidos; lo que sale vuelve a su
      // lugar entre los demás, de más a menos elegidos
      const incl = s.contenidos.filter((x) => x.incluido && x !== c);
      const resto = s.contenidos.filter((x) => !x.incluido && x !== c);
      if (si) incl.push(c); else resto.push(c);
      resto.sort((a, b) => b.docentes - a.docentes || (a.origen === 'catalogo' ? -1 : 1));
      s.contenidos = incl.concat(resto);
    });
  }

  function guardarSaber(form) {
    const texto = form.texto.value.trim();
    const id = form.dataset.id;
    if (!texto) { st.errorAccion = 'Escribí el texto del saber.'; d.render(); return; }
    const eje = form.eje ? form.eje.value : null;
    const trimestre = Number(form.trimestre.value) || 1;
    st.editando = null;
    cambiar((datos) => {
      if (!id) {
        datos.saberes.push({ id: nuevoId('equipo'), eje_id: eje, trimestre, texto, texto_original: null, estado: 'prioritario',
          motivo: null, origen: 'equipo', informan: 0, trabajan: 0, no_trabajan: 0, contenidos: [] });
        return;
      }
      const s = saberPorId(id);
      if (!s) return;
      const cambiaTrimestre = s.trimestre !== trimestre;
      Object.assign(s, { texto, eje_id: eje || s.eje_id, trimestre });
      // Cambiar de trimestre lo lleva al final del nuevo
      if (cambiaTrimestre) { datos.saberes = datos.saberes.filter((x) => x !== s); datos.saberes.push(s); }
    });
  }

  function guardarContenido(form) {
    const texto = form.texto.value.trim();
    const s = saberPorId(form.dataset.saber);
    if (!s) return;
    if (!texto) { st.errorAccion = 'Escribí el contenido.'; d.render(); return; }
    const cl = form.dataset.clave;
    const repetido = s.contenidos.find((c) => c.clave !== cl && normalizarTexto(c.texto) === normalizarTexto(texto));
    if (repetido) {
      st.errorAccion = repetido.incluido ? 'Ese contenido ya está en este saber.' : 'Ese contenido ya está entre los que eligieron los docentes: tildalo ahí.';
      d.render();
      return;
    }
    st.editando = null;
    cambiar(() => {
      if (cl) {
        const c = s.contenidos.find((x) => x.clave === cl);
        if (c) c.texto = texto;
        return;
      }
      const nuevo = { clave: nuevoId('e'), texto, texto_original: null, origen: 'equipo', docentes: 0, incluido: true };
      const incl = s.contenidos.filter((x) => x.incluido);
      s.contenidos = incl.concat([nuevo], s.contenidos.filter((x) => !x.incluido));
    });
  }

  function quitarContenido(saberId, cl) {
    cambiar(() => {
      const s = saberPorId(saberId);
      s.contenidos = s.contenidos.filter((c) => c.clave !== cl);
    });
  }

  function quitarSaber(id) {
    cambiar((datos) => { datos.saberes = datos.saberes.filter((s) => s.id !== id); });
  }

  async function guardarPresentacion(form) {
    const texto = form.texto.value.trim();
    st.guardando = true;
    d.render();
    const { data, error } = await sb.rpc('guardar_presentacion', { p_espacio_id: st.espacio_id, p_texto: texto });
    st.guardando = false;
    if (error || !data || data.error) {
      st.errorAccion = (data && data.error) || 'No pudimos guardar la presentación. Revisá la conexión y volvé a intentar.';
      d.render();
      return;
    }
    if (st.general) {
      if (texto) st.general.presentaciones[st.espacio_id] = texto;
      else delete st.general.presentaciones[st.espacio_id];
    }
    st.editando = null;
    d.render();
  }

  /* ---------- Carátula, marco y criterios ---------- */

  function cambiarDoc(fn, { ya = false } = {}) {
    if (!st.doc) return;
    const datos = datosDocumento();
    fn(datos);
    st.doc.datos = datos;
    st.doc.sucio = true;
    pintarDoc('Sin guardar…');
    clearTimeout(relojDoc);
    relojDoc = setTimeout(guardarDoc, ya ? 0 : 1200);
  }

  async function guardarDoc() {
    clearTimeout(relojDoc);
    const doc = st.doc;
    if (!doc || !doc.sucio || doc.conflicto) return;
    if (doc.guardando) { relojDoc = setTimeout(guardarDoc, 400); return; }
    doc.guardando = true;
    doc.sucio = false;
    pintarDoc('Guardando…');
    const { data, error } = await sb.rpc('guardar_diseno_documento', { p_datos: doc.datos, p_version: doc.version });
    doc.guardando = false;
    if (error || !data || data.error) {
      doc.sucio = true;
      doc.conflicto = !!(data && data.conflicto);
      doc.error = (data && data.error) || 'No pudimos guardar. Revisá la conexión: lo escrito sigue en pantalla y se guarda con el próximo cambio.';
      d.render();
      return;
    }
    doc.version = data.actualizado_en;
    doc.error = null;
    if (st.general) st.general.documento = { datos: doc.datos, actualizado_en: data.actualizado_en, actualizado_por: d.nombreUsuario() || 'vos' };
    pintarDoc(doc.sucio ? 'Sin guardar…' : `Guardado ${cuando(data.actualizado_en)}.`);
  }

  function pintarDoc(texto) {
    if (st.doc) st.doc.estado = texto;
    const el = document.getElementById('ds-doc-guardado');
    if (el) el.textContent = texto;
  }

  async function subirWord(input) {
    const archivo = input.files && input.files[0];
    input.value = '';
    if (!archivo) return;
    try {
      await cargarScript(URL_MAMMOTH, 'mammoth');
      const r = await window.mammoth.convertToHtml({ arrayBuffer: await archivo.arrayBuffer() });
      const html = limpiarHTML(r.value);
      if (!html.replace(/<[^>]+>/g, '').trim()) throw new Error('El Word no tiene texto.');
      cambiarDoc((x) => { x.marco = html; }, { ya: true });
      st.doc.error = null;
      st.aviso = `Listo: el marco argumentativo ahora es el texto de «${archivo.name}».`;
    } catch (e) {
      st.doc.error = `No pudimos leer el Word: ${(e && e.message) || 'error desconocido'}. Probá guardarlo de nuevo como .docx.`;
    }
    d.render();
  }

  /* ---------- Pantallas ---------- */

  function pantalla() {
    return contenido() + panelDescargar();
  }

  function contenido() {
    if (st.cargando && !st.general) return `${barraResumen()}<div class="t-cuerpo"><div class="t-estado"><div class="t-estado__texto">Trayendo cómo va el diseño…</div></div></div>`;
    if (st.sinTablas) {
      return `${barraResumen()}<div class="t-cuerpo"><div class="ds-cuerpo">
        <div class="ed-aviso ed-aviso--error">Falta preparar la base para el diseño unificado: hay que correr <strong>sql/19_diseno_unificado.sql</strong> en el SQL Editor de Supabase. Después, volvé a entrar a esta pantalla.<br><small>La base respondió: ${esc(st.sinTablas)}</small></div>
      </div></div>`;
    }
    if (st.error) {
      return `${barraResumen()}<div class="t-cuerpo"><div class="t-estado"><div class="t-estado__titulo">No pudimos traer el diseño</div><div class="t-estado__texto">${esc(st.error)}</div><button type="button" class="boton boton--primario boton--66" data-accion="ds-reintentar">Volver a intentar</button></div></div>`;
    }
    if (!st.general) return barraResumen();
    if (st.vista === 'materia') return pantallaMateria();
    if (st.vista === 'documento') return pantallaDocumento();
    return pantallaResumen();
  }

  function barraResumen() {
    const listo = !!st.general;
    return `<div class="t-selectores ds-barra">
      <div class="ds-barra__titulo">Diseño curricular unificado <span>Ciclo Básico</span></div>
      <div class="espaciador"></div>
      <div class="t-selectores__acciones">
        <button type="button" class="t-exportar t-exportar--claro" data-accion="ds-documento"${listo ? '' : ' disabled'}>Carátula, marco y criterios</button>
        <button type="button" class="t-exportar" data-accion="ds-descargar"${listo ? '' : ' disabled'}>${Icono.descargar}Descargar el diseño</button>
      </div>
    </div>`;
  }

  function avisos() {
    return [
      st.aviso ? `<div class="ed-aviso" role="status">${esc(st.aviso)}</div>` : '',
      st.errorAccion ? `<div class="ed-aviso ed-aviso--error" role="alert">${esc(st.errorAccion)}${st.conflicto ? ' <button type="button" class="t-seg-enlace" data-accion="ds-traer">Traer la última versión</button>' : ''}</div>` : '',
    ].join('');
  }

  function pantallaResumen() {
    const lista = unidades().filter((u) => u.conSaberes);
    const cerradas = lista.filter((u) => (filaDe(u.esp.id, u.anio) || {}).estado === 'cerrada').length;
    const enRevision = lista.filter((u) => (filaDe(u.esp.id, u.anio) || {}).estado === 'en_revision').length;
    const faltan = lista.length - cerradas;
    const respuesta = faltan
      ? `Cerrados <strong>${cerradas} de ${lista.length}</strong>. ${enRevision ? `${enRevision} en revisión y ` : ''}${faltan - enRevision} sin revisar. Hasta cerrarlos todos, el documento sale como <strong>borrador</strong>.`
      : `Los <strong>${lista.length}</strong> están cerrados: el documento está listo para entregar.`;
    const sig = siguientePendiente();
    const celda = (u) => {
      if (!u.conSaberes) return '<div class="ds-celda ds-celda--nada">Sin saberes en el diseño</div>';
      const f = filaDe(u.esp.id, u.anio);
      const est = f ? f.estado : 'propuesta';
      const rotulo = { propuesta: 'Sin revisar', en_revision: 'En revisión', cerrada: 'Cerrado' }[est];
      const quien = est === 'cerrada' ? `${f.cerrada_por || ''} · ${cuando(f.cerrada_en)}` : f ? `${f.actualizada_por || ''} · ${cuando(f.actualizada_en)}` : 'la propuesta de las cargas';
      return `<button type="button" class="ds-celda ds-celda--${est}" data-accion="ds-abrir" data-espacio="${esc(u.esp.id)}" data-anio="${u.anio}"
          aria-label="${esc(nombreMateria(u.esp))}, ${esc(textoAnio(u.anio))}: ${rotulo}">
        <span class="ds-celda__estado">${est === 'cerrada' ? '✓ ' : ''}${rotulo}</span>
        <span class="ds-celda__quien">${esc(quien)}</span>
      </button>`;
    };
    const areas = Catalogo.areas().map((area) => {
      const filas = Catalogo.espaciosPorArea(area.id).map((esp) => {
        const propias = unidades().filter((u) => u.esp.id === esp.id);
        const celdas = esp.saberes_por_ciclo
          ? `<div class="ds-tabla__ciclo"><span class="ds-tabla__ciclo-rotulo">Todo el ciclo</span>${celda(propias[0])}</div>`
          : [1, 2, 3].map((a) => {
            const u = propias.find((x) => x.anio === a);
            return u ? celda(u) : '<div class="ds-celda ds-celda--nada">No se dicta</div>';
          }).join('');
        return `<div class="ds-tabla__fila">
          <div class="ds-tabla__materia">${esc(nombreMateria(esp))}${st.general.presentaciones[esp.id] ? '<span class="ds-tabla__con">con presentación</span>' : ''}</div>
          ${celdas}
        </div>`;
      }).join('');
      return `<section class="ds-area">
        <h2 class="t-seg-titulo">${esc(area.nombre)}</h2>
        <div class="ds-tabla">
          <div class="ds-tabla__fila ds-tabla__fila--cabeza" aria-hidden="true"><span>Materia</span><span>1° año</span><span>2° año</span><span>3° año</span></div>
          ${filas}
        </div>
      </section>`;
    }).join('');
    return `${barraResumen()}
      <div class="t-contexto"><div class="t-contexto__texto">${respuesta}</div>
        ${sig ? `<button type="button" class="t-seg-enlace ds-siguiente" data-accion="ds-abrir" data-espacio="${esc(sig.esp.id)}" data-anio="${sig.anio}">Seguir con ${esc(nombreMateria(sig.esp))} · ${esc(textoAnio(sig.anio).toLowerCase())} →</button>` : ''}
      </div>
      <div class="t-cuerpo"><div class="ds-cuerpo ds-cuerpo--ancho">
        ${avisos()}
        <p class="ds-ayuda">Cada año de cada materia arranca con la <strong>propuesta que sale de las cargas</strong> de los docentes. Abrilo, revisalo, cambiá lo que haga falta y cerralo. Cerrado, queda así en el documento.</p>
        ${areas}
      </div></div>`;
  }

  /* ---------- Un año de una materia ---------- */

  function consenso(s, base) {
    const minimo = ((base && base.criterios) || CRITERIOS_INICIALES).minimo;
    if (s.origen === 'equipo') return { nivel: 'equipo', texto: 'Lo agregó el equipo técnico.' };
    if (!s.informan) return { nivel: 'muestra', texto: 'Ningún docente lo informó.' };
    const pct = Math.round((100 * s.trabajan) / s.informan);
    const cuenta = `Lo trabajan ${numero(s.trabajan)} de ${numero(s.informan)} docentes que lo informaron (${pct} %)`;
    if (s.informan < minimo) return { nivel: 'muestra', texto: `${cuenta}: son muy pocos para decidir con las cargas.`, pct };
    const nivel = pct >= 75 ? 'alto' : pct >= 50 ? 'medio' : 'bajo';
    return { nivel, texto: `${cuenta} · acuerdo ${nivel}.`, pct };
  }

  function ejesDeLaMateria() {
    return (Catalogo.ejesPorEspacio(st.espacio_id) || []).slice().sort((a, b) => (a.orden || 0) - (b.orden || 0));
  }
  function nombreEje(id) {
    const e = Catalogo.eje(id);
    if (!e) return { rotulo: 'EJE', nombre: '' };
    const info = d.partirEje(e.nombre, e.orden);
    // «Eje: En relación con…» (sin número): que no diga «EJE 1 — Eje: …»
    const nombre = info.nombre.replace(/^eje\s*[:.—–-]\s*/i, '');
    return { rotulo: info.rotulo, nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1) };
  }

  function barraMateria() {
    const m = st.m;
    const opciones = Catalogo.areas().map((a) => `<optgroup label="${esc(a.nombre)}">${Catalogo.espaciosPorArea(a.id).map((e) =>
      `<option value="${esc(e.id)}" ${e.id === st.espacio_id ? 'selected' : ''}>${esc(nombreMateria(e))}</option>`).join('')}</optgroup>`).join('');
    const esp = Catalogo.espacio(st.espacio_id);
    const anios = esp.saberes_por_ciclo ? [0] : esp.anios_dictados.slice().sort();
    const cerrada = m && m.estado === 'cerrada';
    const accion = !m ? '' : cerrada
      ? `<button type="button" class="t-exportar t-exportar--claro" data-accion="ds-reabrir"${st.guardando ? ' disabled' : ''}>${Icono.abierto}Reabrir</button>`
      : `<button type="button" class="t-exportar" data-accion="ds-cerrar"${st.guardando || st.conflicto ? ' disabled' : ''}>${Icono.candado}Cerrar ${esc(textoAnio(st.anio).toLowerCase())}</button>`;
    return `<div class="t-selectores">
      <button type="button" class="t-seg-enlace ds-volver" data-accion="ds-resumen">← Todas</button>
      <div class="t-selector">
        <label class="t-selector__etiqueta" for="ds-materia">Materia</label>
        <select class="t-select t-select--materia" id="ds-materia" data-cambio="ds-materia">${opciones}</select>
      </div>
      <div class="t-selector">
        <label class="t-selector__etiqueta" for="ds-anio">Año</label>
        <select class="t-select t-select--anio" id="ds-anio" data-cambio="ds-anio"${anios.length < 2 ? ' disabled' : ''}>${anios.map((a) =>
          `<option value="${a}" ${a === st.anio ? 'selected' : ''}>${esc(textoAnio(a))}</option>`).join('')}</select>
      </div>
      <div class="espaciador"></div>
      <div class="t-selectores__acciones">
        <button type="button" class="t-exportar t-exportar--claro" data-accion="ds-descargar" data-espacio="${esc(st.espacio_id)}" title="El diseño de esta materia, todos sus años, en PDF o Word, para revisarlo">${Icono.bajar}Descargar esta materia</button>
        ${accion}
      </div>
    </div>`;
  }

  function pantallaMateria() {
    const m = st.m;
    if (st.cargandoMateria || !m) {
      return `${barraMateria()}<div class="t-cuerpo"><div class="ds-cuerpo">${st.errorMateria
        ? `<div class="t-estado"><div class="t-estado__titulo">No pudimos abrirlo</div><div class="t-estado__texto">${esc(st.errorMateria)}</div><button type="button" class="boton boton--primario boton--66" data-accion="ds-traer">Volver a intentar</button></div>`
        : '<div class="t-estado"><div class="t-estado__texto">Armando la propuesta con las cargas…</div></div>'}</div></div>`;
    }
    const saberes = m.datos.saberes;
    const quedan = saberes.filter((s) => s.estado === 'prioritario').length;
    const revisar = saberes.filter((s) => s.estado === 'revisar').length;
    const fuera = saberes.filter((s) => s.estado === 'fuera').length;
    const base = m.datos.base || {};
    const cerrada = m.estado === 'cerrada';
    const respuesta = cerrada
      ? `<strong>Cerrado</strong>${m.cerrada_por ? ` por ${esc(m.cerrada_por)}` : ''}${m.cerrada_en ? `, ${esc(cuando(m.cerrada_en))}` : ''}. Quedan <strong>${quedan} ${plural(quedan, 'saber', 'saberes')}</strong> en el diseño. Para cambiar algo, reabrilo.`
      : `Basado en <strong>${numero(base.docentes)} ${plural(base.docentes, 'docente', 'docentes')}</strong> de ${numero(base.escuelas)} ${plural(base.escuelas, 'escuela', 'escuelas')}. <strong>${quedan} ${plural(quedan, 'saber queda', 'saberes quedan')}</strong> en el diseño${revisar ? `, <strong>${revisar} para revisar</strong>` : ''}${fuera ? ` y ${fuera} ${plural(fuera, 'salió', 'salieron')}` : ''}.`;

    const porTrimestre = [1, 2, 3].map((t) => {
      const delTrimestre = saberes.filter((s) => s.trimestre === t);
      const visibles = st.filtro === 'revisar' ? delTrimestre.filter((s) => s.estado === 'revisar') : delTrimestre;
      if (!visibles.length && (st.filtro === 'revisar' || cerrada)) return '';
      let lugar = 0;
      const numerados = new Map(delTrimestre.filter((s) => s.estado !== 'fuera').map((s) => [s.id, ++lugar]));
      const cuenta = numerados.size;
      return `<section class="ed-trimestre ds-trimestre">
        <h2 class="ed-trimestre__titulo">${ORDINAL[t]} trimestre <span>· ${cuenta} ${plural(cuenta, 'saber', 'saberes')} en el diseño</span></h2>
        ${visibles.map((s) => tarjeta(s, numerados.get(s.id), delTrimestre)).join('')}
        ${!cerrada && st.filtro === 'todos' ? (st.editando === `ns:${t}` ? formSaber(null, t) : `<button type="button" class="ed-agregar ds-agregar-saber" data-accion="ds-nuevo-saber" data-trimestre="${t}">${Icono.mas} Agregar un saber al ${ORDINAL[t]} trimestre</button>`) : ''}
      </section>`;
    }).join('');

    const confirmarVolver = st.confirmar === 'volver' ? `<div class="ds-confirmar" role="alert">
        <p>¿Volver a armar ${esc(textoAnio(m.anio).toLowerCase())} con las cargas de hoy? Se pierde lo que cambió el equipo en este año (queda una copia en la base, por si hace falta).</p>
        <div class="ed-acciones-campo">
          <button type="button" class="ed-boton ed-boton--guardar" data-accion="ds-volver-si">Volver a armar</button>
          <button type="button" class="t-seg-enlace" data-accion="ds-cancelar">Cancelar</button>
        </div>
      </div>` : '';

    return `${barraMateria()}
      <div class="t-contexto">
        <div class="t-contexto__texto">${respuesta}</div>
        ${cerrada ? '' : `<div class="t-vistas">
          <button type="button" class="t-vista ${st.filtro === 'todos' ? 't-vista--activa' : ''}" data-accion="ds-filtro" data-filtro="todos">Todos los saberes</button>
          <button type="button" class="t-vista ${st.filtro === 'revisar' ? 't-vista--activa' : ''}" data-accion="ds-filtro" data-filtro="revisar">Para revisar (${revisar})</button>
        </div>`}
      </div>
      <div class="t-cuerpo"><div class="ds-cuerpo">
        ${avisos()}
        <p class="ds-estado">
          <span id="ds-guardado">${esc(textoGuardado())}</span>
          ${!cerrada && m.guardada && !st.confirmar ? '<button type="button" class="t-seg-enlace" data-accion="ds-volver">Volver a armar desde las cargas</button>' : ''}
        </p>
        ${confirmarVolver}
        ${presentacion(cerrada)}
        ${st.filtro === 'revisar' && !revisar ? '<p class="ed-vacio">No queda ningún saber para revisar en este año. Si está todo bien, cerralo con el botón de arriba.</p>' : ''}
        ${porTrimestre}
      </div></div>`;
  }

  function presentacion(cerrada) {
    const texto = (st.general.presentaciones || {})[st.espacio_id] || '';
    if (st.editando === 'pres') {
      return `<form class="ds-presentacion" data-form="ds-presentacion">
        <h2 class="t-seg-titulo">Presentación de la materia</h2>
        <textarea class="ed-campo" name="texto" rows="6" maxlength="8000" placeholder="Para qué se enseña la materia, cómo se organiza… Va antes de sus saberes en el documento.">${esc(texto)}</textarea>
        <div class="ed-acciones-campo">
          <button type="submit" class="ed-boton ed-boton--guardar"${st.guardando ? ' disabled' : ''}>Guardar</button>
          <button type="button" class="t-seg-enlace" data-accion="ds-cancelar">Cancelar</button>
        </div>
      </form>`;
    }
    return `<section class="ds-presentacion">
      <div class="ds-presentacion__cabeza">
        <h2 class="t-seg-titulo">Presentación de la materia <span>opcional · la misma para todos los años</span></h2>
        ${cerrada ? '' : `<button type="button" class="t-seg-enlace" data-accion="ds-editar-pres">${texto ? 'Corregir' : '+ Escribir'}</button>`}
      </div>
      ${texto ? `<p class="ds-presentacion__texto">${esc(texto)}</p>` : '<p class="ds-presentacion__vacia">Sin presentación: en el documento la materia arranca directo con sus saberes.</p>'}
    </section>`;
  }

  function formSaber(s, trimestre) {
    const ejes = ejesDeLaMateria();
    const eje = s ? s.eje_id : (ejes[0] && ejes[0].id);
    const t = s ? s.trimestre : trimestre;
    return `<form class="ed-saber ed-saber--nuevo ds-form" data-form="ds-saber" data-id="${s ? esc(s.id) : ''}">
      <label class="ds-form__etiqueta" for="ds-saber-texto">${s ? 'El texto del saber' : 'Saber nuevo'}</label>
      <textarea class="ed-campo ed-campo--saber" id="ds-saber-texto" name="texto" rows="4" maxlength="1500">${s ? esc(s.texto) : ''}</textarea>
      ${s && s.texto_original && s.texto_original !== s.texto ? `<p class="ds-original">Como estaba en el diseño: «${esc(s.texto_original)}»</p>` : ''}
      <div class="ed-acciones-campo">
        <label class="ed-select-linea">Eje
          <select class="ed-select ds-select-eje" name="eje">${ejes.map((e) => {
            const info = nombreEje(e.id);
            return `<option value="${esc(e.id)}" ${e.id === eje ? 'selected' : ''}>${esc(info.rotulo)} — ${esc(info.nombre)}</option>`;
          }).join('')}</select>
        </label>
        <label class="ed-select-linea">Trimestre
          <select class="ed-select" name="trimestre">${[1, 2, 3].map((x) => `<option value="${x}" ${x === t ? 'selected' : ''}>${ORDINAL[x]}</option>`).join('')}</select>
        </label>
        <button type="submit" class="ed-boton ed-boton--guardar">${s ? 'Guardar' : 'Agregar'}</button>
        <button type="button" class="t-seg-enlace" data-accion="ds-cancelar">Cancelar</button>
      </div>
    </form>`;
  }

  function formContenido(s, c) {
    return `<form class="ed-fila ed-fila--editando" data-form="ds-contenido" data-saber="${esc(s.id)}" data-clave="${c ? esc(c.clave) : ''}">
      <textarea class="ed-campo" name="texto" rows="2" maxlength="500" placeholder="Escribí el contenido">${c ? esc(c.texto) : ''}</textarea>
      ${c && c.texto_original && c.texto_original !== c.texto ? `<p class="ds-original">Como lo eligieron los docentes: «${esc(c.texto_original)}»</p>` : ''}
      <div class="ed-acciones-campo">
        <button type="submit" class="ed-boton ed-boton--guardar">${c ? 'Guardar' : 'Agregar'}</button>
        <button type="button" class="t-seg-enlace" data-accion="ds-cancelar">Cancelar</button>
      </div>
    </form>`;
  }

  function tarjeta(s, lugar, delTrimestre) {
    const m = st.m;
    const cerrada = m.estado === 'cerrada';
    if (st.editando === `s:${s.id}`) return formSaber(s);
    const info = nombreEje(s.eje_id);
    const con = consenso(s, m.datos.base);
    const pos = delTrimestre.indexOf(s);
    const flechas = cerrada ? '' : `<span class="ed-saber__flechas">
        ${pos > 0 ? `<button type="button" class="ed-icono" title="Subir un lugar" aria-label="Subir un lugar" data-accion="ds-mover" data-id="${esc(s.id)}" data-hacia="-1">${Icono.arriba}</button>` : '<span class="ed-icono ed-icono--vacio"></span>'}
        ${pos < delTrimestre.length - 1 ? `<button type="button" class="ed-icono" title="Bajar un lugar" aria-label="Bajar un lugar" data-accion="ds-mover" data-id="${esc(s.id)}" data-hacia="1">${Icono.abajo}</button>` : '<span class="ed-icono ed-icono--vacio"></span>'}
      </span>`;
    const chip = { prioritario: 'En el diseño', revisar: 'Para revisar', fuera: 'Fuera del diseño' }[s.estado];
    const corregido = s.texto_original && s.texto_original !== s.texto;

    if (s.estado === 'fuera') {
      return `<article class="ed-saber ds-saber ds-saber--fuera">
        <header class="ed-saber__cabecera">
          <div class="ed-saber__datos"><span class="ed-saber__eje">${esc(info.rotulo)} — ${esc(info.nombre)}</span><span class="ds-chip ds-chip--fuera">${chip}</span></div>
          ${cerrada ? '' : `<div class="ed-saber__botones">${s.origen === 'equipo'
            ? `<button type="button" class="t-seg-enlace" data-accion="ds-quitar-saber" data-id="${esc(s.id)}">Borrarlo</button>` : ''}
            <button type="button" class="ed-boton" data-accion="ds-estado" data-id="${esc(s.id)}" data-estado="prioritario">${Icono.restaurar} Volver a ponerlo</button></div>`}
        </header>
        <div class="ds-saber__texto-fuera">${esc(s.texto)}</div>
        <p class="ds-consenso">${esc(con.texto)}</p>
      </article>`;
    }

    const incluidos = s.contenidos.filter((c) => c.incluido);
    const otros = s.contenidos.filter((c) => !c.incluido);
    const pct = (c) => (s.trabajan ? Math.round((100 * c.docentes) / s.trabajan) : 0);
    const origen = (c) => (c.origen === 'equipo' ? '<span class="ds-marca ds-marca--equipo">agregado por el equipo</span>'
      : c.origen === 'docentes' ? '<span class="ds-marca ds-marca--docentes">escrito por docentes</span>' : '')
      + (c.texto_original && c.texto_original !== c.texto ? '<span class="ds-marca">corregido</span>' : '');
    const datoContenido = (c) => (c.origen === 'equipo' ? '' : c.docentes ? `${pct(c)} %` : 'nadie');
    const filaIncluido = (c, i) => (st.editando === `c:${s.id}:${c.clave}` ? formContenido(s, c) : `
      <div class="ed-fila ds-cont">
        <label class="ds-cont__casilla">
          <input type="checkbox" checked data-cambio="ds-incluir" data-saber="${esc(s.id)}" data-clave="${esc(c.clave)}"${cerrada ? ' disabled' : ''}>
          <span class="ed-fila__texto">${esc(c.texto)} ${origen(c)}</span>
        </label>
        <span class="ed-fila__datos" title="${c.docentes ? `Lo eligieron ${c.docentes} de los ${s.trabajan} docentes que trabajan el saber` : ''}">${datoContenido(c)}</span>
        ${cerrada ? '' : `<span class="ed-fila__botones">
          ${incluidos.length < 2 ? '' : i > 0 ? `<button type="button" class="ed-icono" title="Subir" aria-label="Subir" data-accion="ds-mover-c" data-saber="${esc(s.id)}" data-clave="${esc(c.clave)}" data-hacia="-1">${Icono.arriba}</button>` : '<span class="ed-icono ed-icono--vacio"></span>'}
          ${incluidos.length < 2 ? '' : i < incluidos.length - 1 ? `<button type="button" class="ed-icono" title="Bajar" aria-label="Bajar" data-accion="ds-mover-c" data-saber="${esc(s.id)}" data-clave="${esc(c.clave)}" data-hacia="1">${Icono.abajo}</button>` : '<span class="ed-icono ed-icono--vacio"></span>'}
          <button type="button" class="ed-icono" title="Corregir el texto" aria-label="Corregir el texto" data-accion="ds-editar-c" data-saber="${esc(s.id)}" data-clave="${esc(c.clave)}">${Icono.lapiz}</button>
        </span>`}
      </div>`);
    const filaOtro = (c) => `
      <div class="ed-fila ds-cont ds-cont--otro">
        <label class="ds-cont__casilla">
          <input type="checkbox" data-cambio="ds-incluir" data-saber="${esc(s.id)}" data-clave="${esc(c.clave)}">
          <span class="ed-fila__texto">${esc(c.texto)} ${origen(c)}</span>
        </label>
        <span class="ed-fila__datos">${datoContenido(c)}</span>
        <span class="ed-fila__botones">${c.origen === 'equipo' ? `<button type="button" class="t-seg-enlace" data-accion="ds-quitar-c" data-saber="${esc(s.id)}" data-clave="${esc(c.clave)}">Borrar</button>` : ''}</span>
      </div>`;
    const abiertos = st.otros.has(s.id);
    const todos = st.todos.has(s.id);
    const otrosVisibles = todos ? otros : otros.slice(0, OTROS_VISIBLES);

    return `<article class="ed-saber ds-saber ds-saber--${s.estado}" data-saber="${esc(s.id)}">
      <header class="ed-saber__cabecera">
        <div class="ed-saber__datos">
          <span class="ed-saber__lugar">Saber ${lugar}</span>
          <span class="ed-saber__eje">${esc(info.rotulo)} — ${esc(info.nombre)}</span>
          <span class="ds-chip ds-chip--${s.estado}">${chip}</span>
          ${corregido ? '<span class="ds-marca">texto corregido</span>' : ''}
        </div>
        ${cerrada ? '' : `<div class="ed-saber__botones">
          ${flechas}
          <button type="button" class="ed-icono" title="Corregir el saber" aria-label="Corregir el saber" data-accion="ds-editar-s" data-id="${esc(s.id)}">${Icono.lapiz}</button>
          ${s.estado === 'prioritario' ? `<button type="button" class="t-seg-enlace ds-sacar" data-accion="ds-estado" data-id="${esc(s.id)}" data-estado="fuera">Sacar del diseño</button>` : ''}
        </div>`}
      </header>
      <div class="ed-saber__texto">${esc(s.texto)}</div>
      <p class="ds-consenso ds-consenso--${con.nivel}">${esc(con.texto)}</p>
      ${s.estado === 'revisar' && !cerrada ? `<div class="ds-decidir">
        <p>${s.motivo === 'muestra'
          ? 'Lo informaron muy pocos docentes para decidir con las cargas.'
          : 'Lo trabaja menos de la mitad de los docentes que lo informaron.'} ¿Queda en el diseño?</p>
        <div class="ed-acciones-campo">
          <button type="button" class="ed-boton ed-boton--guardar" data-accion="ds-estado" data-id="${esc(s.id)}" data-estado="prioritario">Queda en el diseño</button>
          <button type="button" class="ed-boton" data-accion="ds-estado" data-id="${esc(s.id)}" data-estado="fuera">Sacarlo del diseño</button>
        </div>
      </div>` : ''}
      <div class="ed-contenidos">
        <div class="ed-contenidos__titulo">${incluidos.length} ${plural(incluidos.length, 'contenido', 'contenidos')} en el diseño <span class="ds-contenidos__ayuda">· de más a menos elegidos · % de los que trabajan el saber</span></div>
        ${incluidos.length ? incluidos.map(filaIncluido).join('') : `<p class="ds-sin">${s.trabajan ? 'No quedó ningún contenido: tildá alguno de los que eligieron los docentes, o agregá uno.' : 'Ningún docente eligió contenidos para este saber: tildá alguna sugerencia o agregá uno.'}</p>`}
        ${cerrada ? '' : st.editando === `nc:${s.id}` ? formContenido(s, null)
          : `<button type="button" class="ed-agregar" data-accion="ds-nuevo-c" data-saber="${esc(s.id)}">${Icono.mas} Agregar un contenido</button>`}
        ${cerrada || !otros.length ? '' : `
          <button type="button" class="ds-otros" data-accion="ds-otros" data-saber="${esc(s.id)}" aria-expanded="${abiertos}">
            <span class="ds-otros__flecha${abiertos ? ' ds-otros__flecha--abierta' : ''}">${Icono.chevron}</span>
            ${s.trabajan ? 'Otros que eligieron los docentes' : 'Sugerencias del catálogo'} (${otros.length})
          </button>
          ${abiertos ? `<div class="ds-otros__lista">
            ${otrosVisibles.map(filaOtro).join('')}
            ${!todos && otros.length > OTROS_VISIBLES ? `<button type="button" class="t-seg-enlace ds-otros__todos" data-accion="ds-todos" data-saber="${esc(s.id)}">Ver los ${otros.length}</button>` : ''}
          </div>` : ''}`}
      </div>
    </article>`;
  }

  /* ---------- Carátula, marco y criterios ---------- */

  function pantallaDocumento() {
    const x = datosDocumento();
    const c = x.caratula;
    const r = st.general.relevamiento || {};
    const doc = st.doc || {};
    const campo = (nombre, rotulo, ayuda, filas) => `
      <label class="ds-doc__campo${filas ? ' ds-doc__campo--ancho' : ''}">
        <span class="ds-form__etiqueta">${rotulo}</span>
        ${filas
          ? `<textarea class="ed-campo" rows="${filas}" data-entrada="ds-caratula" data-campo="${nombre}">${esc(c[nombre])}</textarea>`
          : `<input class="ed-campo" type="text" maxlength="300" data-entrada="ds-caratula" data-campo="${nombre}" value="${esc(c[nombre])}">`}
        ${ayuda ? `<span class="ds-doc__ayuda">${ayuda}</span>` : ''}
      </label>`;
    const numeroCriterio = (nombre, rotulo, ayuda, max) => `
      <label class="ds-doc__criterio">
        <span class="ds-form__etiqueta">${rotulo}</span>
        <span class="ds-doc__numero"><input class="ed-campo" type="number" min="0" max="${max}" step="1" data-entrada="ds-criterio" data-campo="${nombre}" value="${esc(x.criterios[nombre])}">${max === 100 ? ' %' : ''}</span>
        <span class="ds-doc__ayuda">${ayuda}</span>
      </label>`;
    const tocados = (st.general.materias || []).length;
    return `<div class="t-selectores">
        <button type="button" class="t-seg-enlace ds-volver" data-accion="ds-resumen">← Todas</button>
        <div class="ds-barra__titulo">Carátula, marco y criterios</div>
        <div class="espaciador"></div>
        <span class="ds-doc__guardado" id="ds-doc-guardado">${esc(doc.estado || '')}</span>
        <div class="t-selectores__acciones">
          <button type="button" class="t-exportar" data-accion="ds-descargar">${Icono.descargar}Descargar el diseño</button>
        </div>
      </div>
      <div class="t-cuerpo"><div class="ds-cuerpo ds-doc">
        ${avisos()}
        ${doc.error ? `<div class="ed-aviso ed-aviso--error" role="alert">${esc(doc.error)}${doc.conflicto ? ' <button type="button" class="t-seg-enlace" data-accion="ds-traer-doc">Traer la última versión</button>' : ''}</div>` : ''}
        <p class="ds-ayuda">Todo lo de esta página se guarda solo mientras escribís, y vale para el documento entero.</p>

        <section class="ds-doc__bloque">
          <h2 class="t-seg-titulo">Carátula</h2>
          <div class="ds-doc__grilla">
            ${campo('titulo', 'Título')}
            ${campo('subtitulo', 'Subtítulo')}
            ${campo('bajada', 'Bajada', 'Debajo del título. Podés usar {{DOCENTES}}, {{CARGAS}} y {{ESCUELAS}}: se completan con los números del relevamiento.', 2)}
            ${campo('lugar', 'Lugar y año')}
            ${campo('vigencia', 'Vigencia')}
            ${campo('autoridades', 'Autoridades', 'Una por renglón, como querés que figure: «Nombre Apellido — Cargo». Si queda vacío, la carátula va sin autoridades.', 4)}
          </div>
          <p class="ds-doc__numeros">Hoy el relevamiento tiene <strong>${numero(r.docentes)} docentes</strong>, <strong>${numero(r.cargas)} cargas</strong> y <strong>${numero(r.escuelas)} escuelas</strong> con alguna carga.</p>
        </section>

        <section class="ds-doc__bloque">
          <div class="t-notas__rotulo-linea">
            <h2 class="t-seg-titulo">Marco argumentativo</h2>
            <label class="t-seg-enlace">Reemplazarlo con un Word (.docx)<input type="file" accept=".docx" data-cambio="ds-word" hidden></label>
          </div>
          <p class="ds-doc__ayuda">Va después de la carátula y el índice. Los números del texto están escritos tal como vinieron: comparalos con los de arriba antes de entregar. También se pueden usar {{DOCENTES}}, {{CARGAS}} y {{ESCUELAS}}.</p>
          <div class="t-notas__herramientas-texto" role="toolbar" aria-label="Formato del texto">
            <button type="button" data-accion="ds-formato" data-cmd="formatBlock" data-valor="H3" title="Título de una parte">Título</button>
            <button type="button" data-accion="ds-formato" data-cmd="formatBlock" data-valor="P" title="Texto común">Párrafo</button>
            <button type="button" data-accion="ds-formato" data-cmd="bold" title="Negrita"><b>N</b></button>
            <button type="button" data-accion="ds-formato" data-cmd="italic" title="Cursiva"><i>C</i></button>
            <button type="button" data-accion="ds-formato" data-cmd="insertUnorderedList">• Lista</button>
            <button type="button" data-accion="ds-formato" data-cmd="insertOrderedList">1. Lista</button>
            <button type="button" data-accion="ds-formato" data-cmd="formatBlock" data-valor="BLOCKQUOTE" title="Cita destacada">Cita</button>
          </div>
          <div class="t-notas__editor ds-doc__marco" id="ds-marco" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Marco argumentativo" data-entrada="ds-marco">${limpiarHTML(x.marco)}</div>
          <button type="button" class="t-seg-enlace ds-doc__original" data-accion="ds-marco-original">Volver al texto que mandó el equipo</button>
        </section>

        <section class="ds-doc__bloque">
          <h2 class="t-seg-titulo">Cómo se ve cada saber en el documento</h2>
          <label class="ds-doc__casilla"><input type="checkbox" data-cambio="ds-opcion" data-campo="consenso" ${x.opciones.consenso ? 'checked' : ''}> Mostrar el acuerdo de cada saber <span>(«Lo trabaja el 82 % de los docentes que lo informaron»)</span></label>
          <label class="ds-doc__casilla"><input type="checkbox" data-cambio="ds-opcion" data-campo="porcentajes" ${x.opciones.porcentajes ? 'checked' : ''}> Mostrar el porcentaje de cada contenido <span>(si no, los contenidos van en lista, de más a menos elegidos)</span></label>
        </section>

        <section class="ds-doc__bloque">
          <h2 class="t-seg-titulo">Criterios de la propuesta</h2>
          <p class="ds-doc__ayuda">Con estos números el panel arma la propuesta de cada año a partir de las cargas. Valen para los años que todavía nadie tocó${tocados ? ` (los ${tocados} que ya se revisaron conservan los suyos; para aplicarles estos, «Volver a armar desde las cargas» en cada uno)` : ''}.</p>
          <div class="ds-doc__criterios">
            ${numeroCriterio('saber', 'Un saber queda en el diseño si lo trabaja al menos', 'de los docentes que lo informaron. Si no, queda «para revisar».', 100)}
            ${numeroCriterio('contenido', 'Un contenido entra si lo eligió al menos', 'de los docentes que trabajan el saber. Si ninguno llega, entra el más elegido.', 100)}
            ${numeroCriterio('minimo', 'Docentes mínimos para decidir', 'Un saber que informaron menos docentes queda «para revisar».', 1000)}
          </div>
        </section>
      </div></div>`;
  }

  /* ---------- Descargar: qué materias y en qué formato ---------- */

  // La ventana de descargar. Con una materia elegida (desde adentro de ella),
  // viene solo esa y sin carátula; desde el resumen, todas y con carátula.
  function abrirDescargar(espacio) {
    const todas = new Set(Catalogo.areas().flatMap((a) => Catalogo.espaciosPorArea(a.id).map((e) => e.id)));
    st.descargar = espacio
      ? { todas: false, elegidas: new Set([espacio]), conMarco: false, formato: 'pdf', progreso: null, error: null, descargando: false }
      : { todas: true, elegidas: todas, conMarco: true, formato: 'pdf', progreso: null, error: null, descargando: false };
    d.render();
  }

  function panelDescargar() {
    const x = st.descargar;
    if (!x) return '';
    const opcion = (grupo, valor, elegido, titulo, sub) => `
      <label class="t-formato ${elegido ? 't-formato--elegido' : ''}" for="${grupo}-${valor}">
        <span class="t-formato__cabeza"><input type="radio" id="${grupo}-${valor}" name="${grupo}" value="${valor}" ${elegido ? 'checked' : ''} data-cambio="${grupo}"${x.descargando ? ' disabled' : ''}><span class="t-formato__titulo">${titulo}</span></span>
        <span class="t-formato__sub">${sub}</span>
      </label>`;
    const cuantas = x.todas ? 16 : x.elegidas.size;
    const lista = x.todas ? '' : `
      <div class="ds-desc__materias">
        <div class="ds-desc__atajos">
          <button type="button" class="t-seg-enlace" data-accion="ds-desc-todas">Tildar todas</button>
          <button type="button" class="t-seg-enlace" data-accion="ds-desc-ninguna">Ninguna</button>
        </div>
        ${Catalogo.areas().map((a) => `
          <fieldset class="ds-desc__area">
            <legend>${esc(a.nombre)}</legend>
            ${Catalogo.espaciosPorArea(a.id).map((e) => `
              <label class="ds-doc__casilla"><input type="checkbox" data-cambio="ds-desc-materia" value="${esc(e.id)}" ${x.elegidas.has(e.id) ? 'checked' : ''}${x.descargando ? ' disabled' : ''}> ${esc(nombreMateria(e))}</label>`).join('')}
          </fieldset>`).join('')}
      </div>`;
    const nota = x.error ? `<p class="t-panel__nota t-panel__nota--error" role="alert">${esc(x.error)}</p>`
      : x.progreso ? `<p class="t-panel__nota" role="status">${esc(x.progreso)}</p>`
      : `<p class="t-panel__nota">${x.formato === 'pdf'
        ? 'Se abre la ventana de impresión: elegí <strong>«Guardar como PDF»</strong>.'
        : 'Se baja un archivo <strong>.docx</strong> que se abre con Word (o Google Docs, o LibreOffice) para retocar el texto antes de entregarlo.'}
        ${cuantas ? ` Van ${x.todas ? 'las 16 materias' : `${cuantas} ${plural(cuantas, 'materia', 'materias')}`}${x.conMarco ? ', con la carátula, el índice y el marco' : ''}.` : ''}</p>`;
    return `<div class="t-velo" data-accion="ds-desc-cerrar"></div>
    <div class="t-panel t-panel--ancho ds-desc" role="dialog" aria-modal="true" aria-labelledby="ds-desc-titulo">
      <div class="t-panel__cabecera">
        <h2 class="t-panel__titulo" id="ds-desc-titulo">Descargar el diseño</h2>
        <button type="button" class="t-panel__cerrar" data-accion="ds-desc-cerrar" aria-label="Cerrar">${Icono.cerrar}</button>
      </div>
      <div class="t-panel__grupo">
        <div class="t-panel__etiqueta">Qué materias</div>
        <div class="t-formatos">
          ${opcion('ds-desc-que', 'todas', x.todas, 'Todas', 'el diseño completo, las 16 materias')}
          ${opcion('ds-desc-que', 'elegir', !x.todas, 'Elegir materias', x.todas ? 'una o varias' : `${cuantas} ${plural(cuantas, 'elegida', 'elegidas')}`)}
        </div>
        ${lista}
      </div>
      <label class="ds-doc__casilla"><input type="checkbox" data-cambio="ds-desc-marco" ${x.conMarco ? 'checked' : ''}${x.descargando ? ' disabled' : ''}> Con la carátula, el índice y el marco argumentativo</label>
      <div class="t-panel__grupo">
        <div class="t-panel__etiqueta">En qué formato</div>
        <div class="t-formatos">
          ${opcion('ds-desc-formato', 'pdf', x.formato === 'pdf', 'PDF', 'para imprimir y entregar')}
          ${opcion('ds-desc-formato', 'word', x.formato === 'word', 'Word', 'para retocar el texto')}
        </div>
      </div>
      ${nota}
      <div class="t-panel__acciones">
        <button type="button" class="t-descargar" data-accion="ds-desc-ir"${x.descargando || !cuantas ? ' disabled' : ''}>${x.descargando ? 'Armando…' : cuantas ? 'Descargar' : 'Elegí al menos una materia'}</button>
        <button type="button" class="t-cancelar" data-accion="ds-desc-cerrar"${x.descargando ? ' disabled' : ''}>Cancelar</button>
      </div>
    </div>`;
  }

  /* ---------- El documento ---------- */

  async function descargar() {
    const x = st.descargar;
    if (!x || x.descargando) return;
    const elegidas = x.todas ? null : x.elegidas;
    if (elegidas && !elegidas.size) return;
    await guardarDoc();
    const progreso = (texto) => { x.progreso = texto; d.render(); };
    x.descargando = true;
    x.error = null;
    progreso('Trayendo lo que revisó el equipo…');
    try {
      const { data: filas, error } = await sb.from('diseno_materias').select('espacio_id, anio, datos, estado');
      if (error) throw new Error('No pudimos traer lo que guardó el equipo. Revisá la conexión y volvé a intentar.');
      const guardadas = new Map((filas || []).map((f) => [clave(f.espacio_id, f.anio), f]));
      const lista = unidades().filter((u) => u.conSaberes && (!elegidas || elegidas.has(u.esp.id)));
      const crit = criterios();
      // Los que nadie tocó salen de la propuesta de hoy: se piden de a cuatro
      const faltan = lista.filter((u) => !guardadas.has(clave(u.esp.id, u.anio)));
      let hechas = 0;
      const propuestas = new Map();
      const cola = faltan.slice();
      const trabajar = async () => {
        while (cola.length) {
          const u = cola.shift();
          const crudo = await traerPropuesta(u.esp.id, u.anio);
          propuestas.set(clave(u.esp.id, u.anio), { datos: armar(crudo, crit), estado: 'propuesta' });
          hechas += 1;
          progreso(`Armando la propuesta de los años que nadie revisó (${hechas} de ${faltan.length})…`);
        }
      };
      await Promise.all([trabajar(), trabajar(), trabajar(), trabajar()]);
      const partes = lista.map((u) => Object.assign({ u }, guardadas.get(clave(u.esp.id, u.anio)) || propuestas.get(clave(u.esp.id, u.anio))));
      const modelo = prepararDocumento(partes, x.conMarco);
      const nombre = nombreArchivo(modelo);
      if (x.formato === 'word') {
        progreso('Armando el Word…');
        await bajarWord(modelo, nombre);
        st.descargar = null;
        st.aviso = `Se bajó «${nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '')}.docx». Abrilo con Word para retocarlo.`;
        d.render();
        return;
      }
      st.descargar = null;
      d.imprimir(documento(modelo), nombre);
    } catch (e) {
      x.descargando = false;
      x.progreso = null;
      x.error = (e && e.message) || 'No pudimos armar el documento. Volvé a intentar.';
      d.render();
    }
  }

  function nombreArchivo(modelo) {
    const fecha = new Date().toISOString().slice(0, 10);
    if (modelo.materias.length === 16) return `Diseño Curricular Unificado - Ciclo Básico - ${fecha}`;
    if (modelo.materias.length === 1) return `Diseño unificado - ${nombreMateria(modelo.materias[0].esp)} - ${fecha}`;
    return `Diseño unificado - ${modelo.materias.length} materias - ${fecha}`;
  }

  // Lo mismo para el PDF y el Word: las materias elegidas, cada una con sus
  // años, y de cada año los saberes que quedaron en el diseño, numerados
  function prepararDocumento(partes, conMarco) {
    const x = datosDocumento();
    const sinCerrar = partes.filter((p) => p.estado !== 'cerrada').length;
    const porMateria = new Map();
    for (const p of partes) {
      if (!porMateria.has(p.u.esp.id)) porMateria.set(p.u.esp.id, { esp: p.u.esp, area: p.u.area, anios: [] });
      const quedan = p.datos.saberes.filter((s) => s.estado !== 'fuera');
      let n = 0;
      porMateria.get(p.u.esp.id).anios.push({ u: p.u, estado: p.estado, base: p.datos.base || {}, quedan,
        numerados: new Map(quedan.map((s) => [s.id, ++n])) });
    }
    return { x, conMarco, total: partes.length, sinCerrar, borrador: sinCerrar > 0, materias: [...porMateria.values()] };
  }

  const textoBorrador = (mo) => `Borrador · ${mo.sinCerrar === mo.total ? 'todavía sin cerrar' : `faltan cerrar ${mo.sinCerrar} de ${mo.total}`}`;
  const autoridades = (x) => String(x.caratula.autoridades || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const subtituloMateria = (m) => (m.esp.saberes_por_ciclo ? 'Ciclo Básico · los mismos saberes para 1°, 2° y 3° año' : textoAniosDe(m.anios));
  const cuentaAnio = (a) => `${a.quedan.length} ${plural(a.quedan.length, 'saber', 'saberes')}${a.base.docentes ? ` · basado en ${numero(a.base.docentes)} ${plural(a.base.docentes, 'docente', 'docentes')} de ${numero(a.base.escuelas)} ${plural(a.base.escuelas, 'escuela', 'escuelas')}` : ''}`;
  const estadoAnio = (mo, a) => (mo.borrador && a.estado !== 'cerrada' ? (a.estado === 'propuesta' ? 'propuesta sin revisar' : 'en revisión') : '');
  function acuerdoSaber(s, x) {
    if (!x.opciones.consenso) return '';
    if (s.origen === 'equipo') return 'Incorporado por el equipo técnico.';
    if (s.informan) return `Lo trabaja el ${Math.round((100 * s.trabajan) / s.informan)} % de los ${numero(s.informan)} docentes que lo informaron.`;
    return '';
  }
  const pctContenido = (s, c) => (s.trabajan ? Math.round((100 * c.docentes) / s.trabajan) : 0);
  const conPorcentaje = (s, c, x) => x.opciones.porcentajes && c.docentes && c.origen !== 'equipo';

  // «Cómo leer este diseño», escrito con los criterios
  function cuerpoLectura(x) {
    const crit = x.criterios;
    return `<p>Cada materia presenta, año por año y trimestre por trimestre, los <strong>saberes</strong> que todo estudiante de la provincia debe aprender, en el orden en que se enseñan. Debajo de cada saber van sus <strong>contenidos priorizados</strong>.</p>
      <p>Saberes y contenidos salen de lo que cargaron los docentes en ReSaP, materia por materia y año por año, y de la revisión del equipo técnico de la Dirección de Educación Secundaria.</p>
      <ul>
        <li>Un saber quedó en la propuesta cuando lo trabaja al menos el ${crit.saber} % de los docentes que lo informaron. Los de menos acuerdo, o informados por menos de ${crit.minimo} docentes, los revisó uno por uno el equipo técnico y decidió si quedaban.</li>
        <li>Los contenidos van <strong>de más a menos elegidos</strong> por los docentes que trabajan el saber. Entraron los que eligió al menos el ${crit.contenido} % de ellos, más los que sumó el equipo técnico.</li>
        ${x.opciones.consenso ? '<li>Debajo de cada saber dice qué parte de los docentes que lo informaron lo trabaja: es la medida del acuerdo.</li>' : ''}
        ${x.opciones.porcentajes ? '<li>Al lado de cada contenido, el porcentaje de los docentes que trabajan el saber y lo eligieron.</li>' : ''}
      </ul>`;
  }

  /* ---------- El PDF ---------- */

  function documento(mo) {
    const x = mo.x;
    const marcaBorrador = mo.borrador ? `<div class="t-dis__borrador">${esc(textoBorrador(mo))}</div>` : '';

    if (!mo.conMarco) {
      return `<article class="t-doc t-dis">
        <div class="t-dis__encabezado">${marcaChica()}${marcaBorrador}</div>
        <p class="t-dis__institucion">${esc(conCampos(x.caratula.titulo))} · ${esc(conCampos(x.caratula.subtitulo))}</p>
        ${mo.materias.map((m, i) => materiaDocumento(m, mo, i === 0)).join('')}
      </article>`;
    }

    const auts = autoridades(x);
    const caratula = `<section class="t-dis__caratula">
      <div class="t-dis__logos">
        <img src="${LOGO_MINISTERIO}" alt="Ministerio de Cultura y Educación — Provincia de Formosa">
        <img src="${LOGO_DES}" alt="Dirección de Educación Secundaria">
      </div>
      <div class="t-dis__caratula-centro">
        ${marcaBorrador}
        <h1 class="t-dis__titulo">${esc(conCampos(x.caratula.titulo))}</h1>
        <p class="t-dis__subtitulo">${esc(conCampos(x.caratula.subtitulo))}</p>
        <div class="t-dis__filete" aria-hidden="true"><span></span><span></span><span></span></div>
        <p class="t-dis__bajada">${esc(conCampos(x.caratula.bajada))}</p>
      </div>
      <div class="t-dis__caratula-pie">
        ${auts.length ? `<div class="t-dis__autoridades">${auts.map((l) => `<p>${esc(l)}</p>`).join('')}</div>` : ''}
        <div class="t-dis__resap">
          <img class="t-dis__resap-simbolo" src="${RESAP_SIMBOLO}" alt="">
          <img class="t-dis__resap-palabra" src="${RESAP_PALABRA}" alt="ReSaP">
          <span>Relevamiento y Sistematización de Saberes Prioritarios del Nivel Secundario</span>
        </div>
        <p class="t-dis__lugar">${esc(conCampos(x.caratula.lugar))}${x.caratula.vigencia ? ` · ${esc(conCampos(x.caratula.vigencia))}` : ''}</p>
      </div>
    </section>`;

    const indice = `<section class="t-dis__indice">
      <h2 class="t-dis__seccion">Contenido</h2>
      <ol class="t-dis__indice-lista">
        <li>Marco argumentativo</li>
        <li>Cómo leer este diseño</li>
        ${Catalogo.areas().map((a) => {
          const ms = mo.materias.filter((m) => m.area.id === a.id);
          if (!ms.length) return '';
          return `<li>${esc(a.nombre)}<ul>${ms.map((m) => `<li>${esc(nombreMateria(m.esp))} <span>${esc(m.esp.saberes_por_ciclo ? 'todo el ciclo' : textoAniosDe(m.anios))}</span></li>`).join('')}</ul></li>`;
        }).join('')}
      </ol>
    </section>`;

    return `<article class="t-doc t-dis">
      ${caratula}
      ${indice}
      <section class="t-dis__marco">${limpiarHTML(conCampos(x.marco))}</section>
      <section class="t-dis__lectura"><h2 class="t-dis__seccion">Cómo leer este diseño</h2>${cuerpoLectura(x)}</section>
      ${mo.materias.map((m) => materiaDocumento(m, mo, false)).join('')}
    </article>`;
  }

  const marcaChica = () => `<div class="t-doc__marca">
      <img class="t-doc__marca-simbolo" src="${RESAP_SIMBOLO}" alt="">
      <img class="t-doc__marca-palabra" src="${RESAP_PALABRA}" alt="ReSaP">
      <span class="t-doc__marca-nombre">Relevamiento y Sistematización de Saberes Prioritarios del Nivel Secundario</span>
    </div>`;

  function textoAniosDe(anios) {
    const t = anios.map((p) => `${p.u.anio}°`);
    return (t.length > 1 ? `${t.slice(0, -1).join(', ')} y ${t[t.length - 1]}` : t[0]) + ' año';
  }

  // primera: la primera materia de un documento sin carátula, que no salta de hoja
  function materiaDocumento(m, mo, primera) {
    const pres = (st.general.presentaciones || {})[m.esp.id];
    return `<section class="t-dis__materia${primera ? ' t-dis__materia--suelta' : ''}">
      <p class="t-dis__area">${esc(m.area.nombre)}</p>
      <h2 class="t-dis__materia-titulo">${esc(m.esp.nombre)}</h2>
      <p class="t-dis__materia-sub">${esc(subtituloMateria(m))}</p>
      ${pres ? `<div class="t-dis__presentacion">${pres.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}</div>` : ''}
      ${m.anios.map((a, i) => anioDocumento(a, mo, i)).join('')}
    </section>`;
  }

  function anioDocumento(a, mo, i) {
    const estado = estadoAnio(mo, a);
    const trimestres = [1, 2, 3].map((t) => {
      const lista = a.quedan.filter((s) => s.trimestre === t);
      if (!lista.length) return '';
      const titulo = `<h4 class="t-dis__trimestre">${ORDINAL[t]} trimestre</h4>`;
      return lista.map((s, j) => saberDocumento(s, a.numerados.get(s.id), mo.x, j === 0 ? titulo : '')).join('');
    }).join('');
    return `<div class="t-dis__anio${i > 0 ? ' t-dis__anio--nueva' : ''}">
      <h3 class="t-dis__anio-titulo">${esc(textoAnio(a.u.anio))}
        <span>· ${esc(cuentaAnio(a))}${estado ? ` · <em>${estado}</em>` : ''}</span></h3>
      ${trimestres || '<p class="t-dis__vacio">Sin saberes.</p>'}
    </div>`;
  }

  // El encabezado del saber y su primer contenido van en un bloque que no se
  // parte (como en el reporte de la materia): un saber largo sigue en la hoja
  // siguiente, pero su encabezado nunca queda solo al pie.
  function saberDocumento(s, n, x, antes) {
    const info = nombreEje(s.eje_id);
    const incluidos = s.contenidos.filter((c) => c.incluido);
    const item = (c) => `<li>${esc(c.texto)}${conPorcentaje(s, c, x) ? ` <span class="t-dis__pct">${pctContenido(s, c)} %</span>` : ''}</li>`;
    const acuerdo = acuerdoSaber(s, x);
    const revisar = s.estado === 'revisar' ? ' <em class="t-dis__revisar">(para revisar)</em>' : '';
    return `<div class="t-dis__saber">
      <div class="t-dis__saber-cabeza">
        ${antes}
        <div class="t-dis__rotulo">Saber ${n} · ${esc(info.rotulo)} — ${esc(info.nombre)}${revisar}</div>
        <div class="t-dis__texto">${esc(s.texto)}</div>
        ${acuerdo ? `<div class="t-dis__acuerdo">${esc(acuerdo)}</div>` : ''}
        ${incluidos.length ? `<ul class="t-dis__contenidos">${item(incluidos[0])}</ul>` : ''}
      </div>
      ${incluidos.length > 1 ? `<ul class="t-dis__contenidos t-dis__contenidos--sigue">${incluidos.slice(1).map(item).join('')}</ul>` : ''}
    </div>`;
  }

  /* ---------- El Word (.docx) ---------- */

  // Lo arma la librería docx en el navegador, con la misma estructura que el
  // PDF. Los títulos son estilos de Word (Título 1, 2 y 3): en Word se ve el
  // panel de navegación y se puede insertar un índice automático.
  async function bajarWord(mo, nombre) {
    await cargarScript(URL_DOCX, 'docx');
    const D = window.docx;
    const x = mo.x;
    const AZUL = '003380';
    const LADRILLO = 'B14A12';
    const GRIS = '5A6377';
    const TINTA = '151C2B';
    const run = (text, o = {}) => new D.TextRun(Object.assign({ text }, o));
    const parrafo = (hijos, o = {}) => new D.Paragraph(Object.assign({ children: Array.isArray(hijos) ? hijos : [hijos] }, o));
    const bytes = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error('No se pudo leer un logo.'); return r.arrayBuffer(); };
    const sinBordes = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const bordesNinguno = { top: sinBordes, bottom: sinBordes, left: sinBordes, right: sinBordes, insideHorizontal: sinBordes, insideVertical: sinBordes };

    // Lo escrito en el marco (HTML limpio) en párrafos de Word
    let listasNumeradas = 0;
    function deHTML(html) {
      const raiz = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstElementChild;
      const corridas = (nodo, f = {}) => {
        const r = [];
        for (const h of nodo.childNodes) {
          if (h.nodeType === 3) {
            const t = h.textContent.replace(/\s+/g, ' ');
            if (t.trim() || (t === ' ' && r.length)) r.push(run(t, { bold: f.b, italics: f.i, underline: f.u ? {} : undefined }));
          } else if (h.nodeType === 1) {
            const tag = h.tagName;
            if (tag === 'BR') r.push(run('', { break: 1 }));
            else r.push(...corridas(h, { b: f.b || tag === 'STRONG' || tag === 'B', i: f.i || tag === 'EM' || tag === 'I', u: f.u || tag === 'U' }));
          }
        }
        return r;
      };
      const salida = [];
      for (const nodo of raiz.childNodes) {
        if (nodo.nodeType === 3) {
          if (nodo.textContent.trim()) salida.push(parrafo(run(nodo.textContent.trim()), { style: 'Texto' }));
          continue;
        }
        if (nodo.nodeType !== 1) continue;
        const tag = nodo.tagName;
        if (tag === 'H2') salida.push(parrafo(corridas(nodo), { heading: D.HeadingLevel.HEADING_1 }));
        else if (tag === 'H3') salida.push(parrafo(corridas(nodo), { style: 'Subtitulo' }));
        else if (tag === 'UL') for (const li of nodo.querySelectorAll(':scope > li')) salida.push(parrafo(corridas(li), { style: 'Texto', bullet: { level: 0 } }));
        else if (tag === 'OL') {
          listasNumeradas += 1;
          for (const li of nodo.querySelectorAll(':scope > li')) salida.push(parrafo(corridas(li), { style: 'Texto', numbering: { reference: 'numerada', level: 0, instance: listasNumeradas } }));
        } else if (tag === 'BLOCKQUOTE') {
          const partes = nodo.querySelectorAll('p').length ? [...nodo.querySelectorAll('p')] : [nodo];
          for (const p of partes) {
            salida.push(parrafo(corridas(p, { i: true }), {
              style: 'Texto', indent: { left: 400 },
              border: { left: { style: D.BorderStyle.SINGLE, size: 18, color: AZUL, space: 10 } },
              shading: { type: D.ShadingType.CLEAR, fill: 'E8EEF8', color: 'auto' },
            }));
          }
        } else salida.push(parrafo(corridas(nodo), { style: 'Texto' }));
      }
      return salida;
    }

    const hijos = [];

    if (mo.conMarco) {
      const [ministerio, des, simbolo, palabra] = await Promise.all([LOGO_MINISTERIO_JPG, LOGO_DES_PNG, RESAP_SIMBOLO, RESAP_PALABRA].map(bytes));
      const celdaLogo = (img, ancho, alto, alinear) => new D.TableCell({
        borders: bordesNinguno, width: { size: 50, type: D.WidthType.PERCENTAGE },
        children: [parrafo(new D.ImageRun({ data: img, transformation: { width: ancho, height: alto } }), { alignment: alinear })],
      });
      hijos.push(new D.Table({
        width: { size: 100, type: D.WidthType.PERCENTAGE }, borders: bordesNinguno,
        rows: [new D.TableRow({ children: [celdaLogo(ministerio, 180, 97, D.AlignmentType.LEFT), celdaLogo(des, 150, 98, D.AlignmentType.RIGHT)] })],
      }));
      hijos.push(parrafo(run(''), { spacing: { before: 2600 } }));
      if (mo.borrador) hijos.push(parrafo(run(textoBorrador(mo).toUpperCase(), { bold: true, color: LADRILLO, size: 18 }), { spacing: { after: 240 } }));
      hijos.push(parrafo(run(conCampos(x.caratula.titulo), { bold: true, color: AZUL, size: 64 }), { spacing: { after: 160 } }));
      hijos.push(parrafo(run(conCampos(x.caratula.subtitulo), { color: '3A4356', size: 32 }), { spacing: { after: 280 } }));
      // El filete tricolor: tres celdas de color, finitas
      const franja = (color) => new D.TableCell({
        borders: bordesNinguno, shading: { type: D.ShadingType.CLEAR, fill: color, color: 'auto' },
        width: { size: 1350, type: D.WidthType.DXA }, children: [parrafo(run('', { size: 2 }))],
      });
      hijos.push(new D.Table({
        width: { size: 4050, type: D.WidthType.DXA }, borders: bordesNinguno,
        rows: [new D.TableRow({ height: { value: 90, rule: D.HeightRule.EXACT }, children: ['0094F9', '49A830', 'FEB501'].map(franja) })],
      }));
      hijos.push(parrafo(run(conCampos(x.caratula.bajada), { color: '3A4356', size: 24 }), { spacing: { before: 320 } }));
      hijos.push(parrafo(run(''), { spacing: { before: 3000 } }));
      for (const l of autoridades(x)) hijos.push(parrafo(run(l, { size: 22 }), { spacing: { after: 80 } }));
      hijos.push(parrafo([
        new D.ImageRun({ data: simbolo, transformation: { width: 44, height: 46 } }),
        run('  '),
        new D.ImageRun({ data: palabra, transformation: { width: 102, height: 26 } }),
        run('   Relevamiento y Sistematización de Saberes Prioritarios del Nivel Secundario', { bold: true, color: AZUL, size: 16 }),
      ], { spacing: { before: 300, after: 160 }, border: { top: { style: D.BorderStyle.SINGLE, size: 4, color: 'D5DCE6', space: 8 } } }));
      hijos.push(parrafo(run(`${conCampos(x.caratula.lugar)}${x.caratula.vigencia ? ` · ${conCampos(x.caratula.vigencia)}` : ''}`, { bold: true, color: '3A4356', size: 22 })));

      // Índice
      hijos.push(parrafo(run('Contenido'), { heading: D.HeadingLevel.HEADING_1, pageBreakBefore: true }));
      hijos.push(parrafo(run('Marco argumentativo', { bold: true }), { style: 'Texto' }));
      hijos.push(parrafo(run('Cómo leer este diseño', { bold: true }), { style: 'Texto' }));
      for (const a of Catalogo.areas()) {
        const ms = mo.materias.filter((m) => m.area.id === a.id);
        if (!ms.length) continue;
        hijos.push(parrafo(run(a.nombre, { bold: true }), { style: 'Texto', spacing: { before: 160, after: 40 } }));
        for (const m of ms) {
          hijos.push(parrafo([run(nombreMateria(m.esp)), run(`  ${m.esp.saberes_por_ciclo ? 'todo el ciclo' : textoAniosDe(m.anios)}`, { color: GRIS, size: 18 })],
            { style: 'Texto', indent: { left: 400 }, spacing: { after: 40 } }));
        }
      }

      // Marco argumentativo
      const marco = deHTML(limpiarHTML(conCampos(x.marco)));
      hijos.push(parrafo(run(''), { pageBreakBefore: true, spacing: { after: 0 } }));
      hijos.push(...marco);

      // Cómo leer
      hijos.push(parrafo(run('Cómo leer este diseño'), { heading: D.HeadingLevel.HEADING_1, pageBreakBefore: true }));
      hijos.push(...deHTML(cuerpoLectura(x)));
    } else {
      hijos.push(parrafo(run(`${conCampos(x.caratula.titulo)} · ${conCampos(x.caratula.subtitulo)}`.toUpperCase(), { bold: true, color: AZUL, size: 16 }),
        { spacing: { after: 80 } }));
      if (mo.borrador) hijos.push(parrafo(run(textoBorrador(mo).toUpperCase(), { bold: true, color: LADRILLO, size: 16 }), { spacing: { after: 200 } }));
    }

    // Las materias: cada una en hoja nueva, cada año también
    mo.materias.forEach((m, mi) => {
      hijos.push(parrafo(run(m.area.nombre.toUpperCase(), { bold: true, color: LADRILLO, size: 16 }),
        { pageBreakBefore: mo.conMarco || mi > 0, keepNext: true, spacing: { after: 40 } }));
      hijos.push(parrafo(run(m.esp.nombre), { heading: D.HeadingLevel.HEADING_1 }));
      hijos.push(parrafo(run(subtituloMateria(m), { color: '3A4356', size: 22 }),
        { spacing: { after: 200 }, border: { bottom: { style: D.BorderStyle.SINGLE, size: 12, color: AZUL, space: 6 } } }));
      const pres = (st.general.presentaciones || {})[m.esp.id];
      if (pres) for (const p of pres.split(/\n{2,}/)) hijos.push(parrafo(run(p.replace(/\n/g, ' ')), { style: 'Texto' }));
      m.anios.forEach((a, ai) => {
        const estado = estadoAnio(mo, a);
        hijos.push(parrafo([
          run(textoAnio(a.u.anio)),
          run(`  · ${cuentaAnio(a)}`, { bold: false, color: GRIS, size: 18 }),
          ...(estado ? [run(` · ${estado}`, { bold: true, color: LADRILLO, size: 18 })] : []),
        ], { heading: D.HeadingLevel.HEADING_2, pageBreakBefore: ai > 0 }));
        if (!a.quedan.length) hijos.push(parrafo(run('Sin saberes.', { italics: true, color: GRIS }), { style: 'Texto' }));
        for (const t of [1, 2, 3]) {
          const lista = a.quedan.filter((s) => s.trimestre === t);
          if (!lista.length) continue;
          hijos.push(parrafo(run(`${ORDINAL[t]} trimestre`), { heading: D.HeadingLevel.HEADING_3 }));
          for (const s of lista) {
            const info = nombreEje(s.eje_id);
            const incluidos = s.contenidos.filter((c) => c.incluido);
            const acuerdo = acuerdoSaber(s, x);
            hijos.push(parrafo([
              run(`SABER ${a.numerados.get(s.id)} · ${info.rotulo} — ${info.nombre.toUpperCase()}`, { bold: true, color: LADRILLO, size: 15 }),
              ...(s.estado === 'revisar' ? [run(' (para revisar)', { bold: true, color: '7A4E00', size: 15 })] : []),
            ], { keepNext: true, spacing: { before: 200, after: 20 } }));
            hijos.push(parrafo(run(s.texto, { font: 'Cambria', size: 22, color: TINTA }), { keepNext: true, keepLines: true, spacing: { after: 40 } }));
            if (acuerdo) hijos.push(parrafo(run(acuerdo, { color: GRIS, size: 16 }), { keepNext: incluidos.length > 0, spacing: { after: 40 } }));
            for (const c of incluidos) {
              hijos.push(parrafo([
                run(c.texto, { size: 20 }),
                ...(conPorcentaje(s, c, x) ? [run(`  ${pctContenido(s, c)} %`, { bold: true, color: AZUL, size: 17 })] : []),
              ], { bullet: { level: 0 }, keepLines: true, spacing: { after: 20 } }));
            }
          }
        }
      });
    });

    const pie = new D.Footer({ children: [parrafo([
      run(`${conCampos(x.caratula.titulo)} · ${conCampos(x.caratula.subtitulo)} · `, { color: GRIS, size: 16 }),
      new D.TextRun({ children: [D.PageNumber.CURRENT], color: GRIS, size: 16 }),
    ], { alignment: D.AlignmentType.RIGHT })] });

    const doc = new D.Document({
      creator: 'ReSaP — Dirección de Educación Secundaria',
      title: conCampos(x.caratula.titulo),
      styles: {
        default: {
          document: { run: { font: 'Arial', size: 22, color: TINTA } },
          heading1: { run: { font: 'Arial', size: 36, bold: true, color: AZUL }, paragraph: { spacing: { before: 120, after: 200 }, keepNext: true } },
          heading2: { run: { font: 'Arial', size: 30, bold: true, color: AZUL }, paragraph: { spacing: { before: 200, after: 120 }, keepNext: true } },
          heading3: { run: { font: 'Arial', size: 21, bold: true, color: AZUL, allCaps: true }, paragraph: { spacing: { before: 260, after: 60 }, keepNext: true,
            border: { bottom: { style: D.BorderStyle.SINGLE, size: 4, color: 'D5DCE6', space: 3 } } } },
        },
        paragraphStyles: [
          { id: 'Texto', name: 'Texto', basedOn: 'Normal', run: { size: 22 }, paragraph: { spacing: { after: 120, line: 300 } } },
          { id: 'Subtitulo', name: 'Subtítulo del marco', basedOn: 'Normal', next: 'Texto', run: { size: 26, bold: true, color: AZUL },
            paragraph: { spacing: { before: 240, after: 80 }, keepNext: true } },
        ],
      },
      numbering: { config: [{ reference: 'numerada', levels: [{ level: 0, format: D.LevelFormat.DECIMAL, text: '%1.', alignment: D.AlignmentType.START,
        style: { paragraph: { indent: { left: 400, hanging: 300 } } } }] }] },
      sections: [{
        properties: { titlePage: mo.conMarco, page: { margin: { top: 1000, bottom: 1000, left: 1050, right: 1050 } } },
        footers: mo.conMarco ? { default: pie, first: new D.Footer({ children: [parrafo(run(''))] }) } : { default: pie },
        children: hijos,
      }],
    });
    const blob = await D.Packer.toBlob(doc);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    // Sin acentos ni eñes: con ellos, algunos Chrome lo bajan como «download»
    a.download = `${nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '')}.docx`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }


  /* ---------- Eventos ---------- */

  function manejar(accion, ds, el) {
    switch (accion) {
      case 'ds-reintentar': cargarGeneral(); break;
      case 'ds-resumen': irAlResumen(); break;
      case 'ds-abrir': abrirMateria(ds.espacio, Number(ds.anio)); break;
      case 'ds-documento': irAlDocumento(); break;
      case 'ds-descargar': abrirDescargar(ds.espacio || null); break;
      case 'ds-desc-cerrar': if (st.descargar && !st.descargar.descargando) { st.descargar = null; d.render(); } break;
      case 'ds-desc-ir': descargar(); break;
      case 'ds-desc-todas':
        if (st.descargar) { st.descargar.elegidas = new Set(Catalogo.areas().flatMap((a) => Catalogo.espaciosPorArea(a.id).map((e) => e.id))); st.descargar.error = null; d.render(); }
        break;
      case 'ds-desc-ninguna': if (st.descargar) { st.descargar.elegidas = new Set(); d.render(); } break;
      case 'ds-traer':
        if (st.vista === 'materia') { st.conflicto = false; st.errorAccion = null; cargarGeneral().then(() => abrirMateria(st.espacio_id, st.anio)); }
        break;
      case 'ds-traer-doc': st.doc = null; cargarGeneral(); break;
      case 'ds-filtro': st.filtro = ds.filtro; st.errorAccion = null; d.render(); break;
      case 'ds-cerrar': cerrar(true); break;
      case 'ds-reabrir': cerrar(false); break;
      case 'ds-volver': st.confirmar = 'volver'; d.render(); break;
      case 'ds-volver-si': volverAArmar(); break;
      case 'ds-cancelar': st.editando = null; st.confirmar = null; st.errorAccion = st.conflicto ? st.errorAccion : null; d.render(); break;
      case 'ds-estado': {
        const s = saberPorId(ds.id);
        cambiar(() => { s.estado = ds.estado; });
        break;
      }
      case 'ds-mover': moverSaber(ds.id, Number(ds.hacia)); break;
      case 'ds-mover-c': moverContenido(ds.saber, ds.clave, Number(ds.hacia)); break;
      case 'ds-editar-s': st.editando = `s:${ds.id}`; st.errorAccion = null; d.render(); enfocar('#ds-saber-texto'); break;
      case 'ds-nuevo-saber': st.editando = `ns:${ds.trimestre}`; st.errorAccion = null; d.render(); enfocar('#ds-saber-texto'); break;
      case 'ds-editar-c': st.editando = `c:${ds.saber}:${ds.clave}`; st.errorAccion = null; d.render(); enfocar('[data-form="ds-contenido"] textarea'); break;
      case 'ds-nuevo-c': st.editando = `nc:${ds.saber}`; st.errorAccion = null; d.render(); enfocar('[data-form="ds-contenido"] textarea'); break;
      case 'ds-quitar-c': quitarContenido(ds.saber, ds.clave); break;
      case 'ds-quitar-saber': quitarSaber(ds.id); break;
      case 'ds-otros':
        if (st.otros.has(ds.saber)) st.otros.delete(ds.saber); else st.otros.add(ds.saber);
        d.render();
        break;
      case 'ds-todos': st.todos.add(ds.saber); d.render(); break;
      case 'ds-editar-pres': st.editando = 'pres'; d.render(); enfocar('[data-form="ds-presentacion"] textarea'); break;
      case 'ds-formato': {
        const ed = document.getElementById('ds-marco');
        if (!ed) break;
        ed.focus();
        document.execCommand(ds.cmd, false, ds.valor || null);
        cambiarDoc((x) => { x.marco = limpiarHTML(ed.innerHTML); });
        break;
      }
      case 'ds-marco-original':
        cambiarDoc((x) => { x.marco = MARCO_INICIAL; }, { ya: true });
        d.render();
        break;
      default: break;
    }
  }

  function enfocar(selector) {
    const el = document.querySelector(selector);
    if (el) { el.focus(); if (el.setSelectionRange && el.value) el.setSelectionRange(el.value.length, el.value.length); }
  }

  function cambio(el) {
    const ds = el.dataset;
    switch (ds.cambio) {
      case 'ds-materia': {
        const esp = Catalogo.espacio(el.value);
        abrirMateria(el.value, esp && esp.saberes_por_ciclo ? 0 : (esp.anios_dictados.includes(st.anio) ? st.anio : esp.anios_dictados[0]));
        break;
      }
      case 'ds-anio': abrirMateria(st.espacio_id, Number(el.value)); break;
      case 'ds-incluir': incluir(ds.saber, ds.clave, el.checked); break;
      case 'ds-word': subirWord(el); break;
      case 'ds-opcion': cambiarDoc((x) => { x.opciones[ds.campo] = el.checked; }, { ya: true }); break;
      case 'ds-desc-que':
        if (st.descargar) {
          st.descargar.todas = el.value === 'todas';
          // Al elegir, arranca con la materia que se está mirando (o ninguna)
          if (!st.descargar.todas) st.descargar.elegidas = new Set(st.vista === 'materia' && st.espacio_id ? [st.espacio_id] : []);
          st.descargar.conMarco = st.descargar.todas;
          st.descargar.error = null;
          d.render();
        }
        break;
      case 'ds-desc-materia':
        if (st.descargar) { if (el.checked) st.descargar.elegidas.add(el.value); else st.descargar.elegidas.delete(el.value); st.descargar.error = null; d.render(); }
        break;
      case 'ds-desc-marco': if (st.descargar) { st.descargar.conMarco = el.checked; d.render(); } break;
      case 'ds-desc-formato': if (st.descargar) { st.descargar.formato = el.value; st.descargar.error = null; d.render(); } break;
      default: break;
    }
  }

  function entrada(el) {
    const ds = el.dataset;
    if (ds.entrada === 'ds-caratula') cambiarDoc((x) => { x.caratula[ds.campo] = el.value; });
    else if (ds.entrada === 'ds-marco') cambiarDoc((x) => { x.marco = limpiarHTML(el.innerHTML); });
    else if (ds.entrada === 'ds-criterio') {
      const v = Math.round(Number(el.value));
      if (!Number.isFinite(v) || v < 0) return;
      cambiarDoc((x) => { x.criterios[ds.campo] = Math.min(ds.campo === 'minimo' ? 1000 : 100, v); });
    }
  }

  function enviarForm(form) {
    if (form.dataset.form === 'ds-saber') guardarSaber(form);
    else if (form.dataset.form === 'ds-contenido') guardarContenido(form);
    else if (form.dataset.form === 'ds-presentacion') guardarPresentacion(form);
  }

  function escape() {
    if (st.descargar) { if (!st.descargar.descargando) { st.descargar = null; d.render(); } return true; }
    if (st.editando || st.confirmar) { st.editando = null; st.confirmar = null; d.render(); return true; }
    return false;
  }

  /* ---------- Entrar y salir ---------- */

  function irAlResumen() {
    Object.assign(st, { vista: 'resumen', m: null, editando: null, confirmar: null, errorAccion: null, conflicto: false });
    d.escribirHash();
    d.render();
    window.scrollTo(0, 0);
  }
  function irAlDocumento() {
    Object.assign(st, { vista: 'documento', m: null, editando: null, confirmar: null, errorAccion: null, aviso: null });
    d.escribirHash();
    d.render();
    window.scrollTo(0, 0);
  }

  // Cada vez que se entra, se trae cómo va: así se ve lo que cerraron los demás
  async function entrar(hash) {
    st.activo = true;
    st.aviso = null;
    st.errorAccion = null;
    st.descargar = null;
    if (hash) {
      const materia = hash.get('diseno');
      if (hash.get('documento') === '1') st.vista = 'documento';
      else if (materia && Catalogo.espacio(materia)) { st.vista = 'materia'; st.espacio_id = materia; st.anio = Number(hash.get('anio')) || 0; }
      else st.vista = 'resumen';
    }
    await cargarGeneral();
    if (st.general && st.vista === 'materia') abrirMateria(st.espacio_id, st.anio);
  }

  function salir() {
    if (st.doc && st.doc.sucio) guardarDoc();
    st.activo = false;
  }

  function escribirHash(h) {
    h.set('diseno', st.vista === 'materia' ? st.espacio_id : '');
    if (st.vista === 'materia') h.set('anio', String(st.anio));
    if (st.vista === 'documento') h.set('documento', '1');
  }

  function iniciar(cliente, deps) {
    sb = cliente;
    d = deps;
  }

  window.addEventListener('beforeunload', (e) => {
    if ((st.doc && (st.doc.sucio || st.doc.guardando)) || st.guardando) { e.preventDefault(); e.returnValue = ''; }
  });

  return {
    iniciar, entrar, salir, pantalla, manejar, cambio, entrada, enviarForm, escape, escribirHash,
    activo: () => st.activo,
    estado: st,
    // Para probar la propuesta sin la base
    armar,
  };
})();
