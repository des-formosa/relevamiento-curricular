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
    pantalla: 'cargando',     // cargando | ingreso | sin-permiso | inicio | panel | seguimiento
    nombre: null,             // el de equipo_planificacion, para saludar
    inicio: null,             // { cargas } para la pantalla de inicio
    // Seguimiento de la carga: cuántos docentes cargaron en cada escuela, de
    // todas las materias. lugar = null (toda la provincia), el id de un
    // departamento o el de una escuela (no hay ids repetidos entre los dos).
    // soloFaltan: mostrar solo las escuelas que todavía no cargaron;
    // agregadas: las que escribieron los docentes, para unificarlas con la nómina
    // contactos: Map escuela_id → [contacto], o null si la base todavía no los tiene
    seguimiento: { lugar: null, soloFaltan: false, agregadas: false, datos: null, contactos: null, sedes: null, cargando: false, error: null },
    // Unificar una agregada con la de la nómina: elegidas (id → destino que
    // se eligió en la lista), confirmando ({ id, destino }), aviso del último
    // editando: la escrita que se está corrigiendo (nombre, localidad, departamento)
    unificar: { elegidas: new Map(), confirmando: null, editando: null, guardando: false, error: null, aviso: null },
    usuario: null,
    espacio_id: null,
    anio: 1,
    alcance: { tipo: 'provincia' },   // | { tipo: 'departamento', id } | { tipo: 'escuela', id }
    vista: 'detalle',                 // detalle | mapa
    modo: 'resultados',               // resultados | catalogo (editar el diseño);
                                      //   no se guarda: siempre se entra por resultados
    datos: null,
    cargandoDatos: false,
    errorDatos: null,
    abiertos: new Set(),
    // Escuelas: editar la nómina (sql/16). lista y departamentos, de la base
    escuelasEd: { lista: null, departamentos: null, publicacion: null, sedes: null, cargando: false, error: null,
      texto: '', dep: '', editando: null, quitando: null, editandoDepto: null, guardando: false, publicando: false,
      errorForm: null, errorAccion: null, aviso: null, verBajas: false },
    escuelasAgregadas: [],            // las que escribieron los docentes y no se unificaron
    unificadas: null,                 // [{ agregada, destino_id, … }], o null sin sql/15
    unificadasError: null,            // por qué no se pudo leer escuelas_unificadas
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
    history.replaceState(null, '', '#' + h.toString());
  }
  // El seguimiento tiene su propio hash («#seguimiento=pirane», «#seguimiento=epes-10»), así se puede
  // dejar marcado y recargar sin volver al inicio
  function escribirHashSeguimiento() {
    const h = new URLSearchParams();
    h.set('seguimiento', estado.seguimiento.lugar || '');
    if (estado.seguimiento.soloFaltan) h.set('faltan', '1');
    if (estado.seguimiento.agregadas) h.set('agregadas', '1');
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
      p_ejemplo: false,   // solo envíos reales (ver sql/mantenimiento/2026-10-27_sin_datos_de_ejemplo.sql)
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

  // Las que escribieron los docentes. Las ya unificadas con una de la nómina
  // (sql/15) no se ofrecen: sus cargas están en la otra.
  async function cargarEscuelasAgregadas() {
    const [{ data }, unif] = await Promise.all([
      sb.from('escuelas').select('id, nombre, localidad, departamento_id').eq('origen', 'agregada_por_docente').order('nombre'),
      sb.from('escuelas_unificadas').select('agregada_id, destino_id, cargas_movidas, unificada_en').order('unificada_en', { ascending: false }),
    ]);
    const todas = data || [];
    const porId = new Map(todas.map((e) => [e.id, e]));
    estado.unificadasError = unif.error ? (unif.error.message || String(unif.error)) : null;
    estado.unificadas = unif.error ? null : (unif.data || []).map((u) => Object.assign({ agregada: porId.get(u.agregada_id) || { id: u.agregada_id, nombre: u.agregada_id } }, u));
    const unidas = new Set((estado.unificadas || []).map((u) => u.agregada_id));
    estado.escuelasAgregadas = todas.filter((e) => !unidas.has(e.id));
  }

  /* ---------- Seguimiento de la carga ---------- */

  // Los envíos, con lo justo para contar: escuela, docente, materia y fecha.
  // Sin nombres de docentes. La primera página dice cuántos son y las demás
  // se piden juntas; se pagina con la medida que devuelva la base, por si
  // entrega menos filas que las pedidas.
  async function traerEnvios() {
    const pagina = (desde, hasta, conteo) => sb.from('aportes')
      .select('escuela_id, docente_id, espacio_id, enviado_en', conteo ? { count: 'exact' } : {})
      .eq('es_ejemplo', false).order('id').range(desde, hasta);
    const fallo = 'No pudimos traer las cargas. Revisá la conexión y volvé a intentar.';
    const primera = await pagina(0, FILAS_POR_PAGINA - 1, true);
    if (primera.error) throw new Error(fallo);
    const filas = primera.data || [];
    const total = typeof primera.count === 'number' ? primera.count : filas.length;
    const paso = filas.length;
    const pedidos = [];
    for (let desde = paso; paso && desde < total; desde += paso) pedidos.push(pagina(desde, desde + paso - 1, false));
    for (const r of await Promise.all(pedidos)) {
      if (r.error) throw new Error(fallo);
      filas.push(...r.data);
    }
    return filas;
  }

  // Cuenta por escuela y por departamento. Las escuelas son las de la nómina,
  // en el orden oficial; las que no tienen envíos son las que faltan. Las que
  // agregaron los docentes (o una que salió de la nómina) van al final de su
  // departamento y no cuentan entre las que faltan.
  async function contarSeguimiento(envios) {
    const porEscuela = new Map();
    for (const a of envios) {
      let e = porEscuela.get(a.escuela_id);
      if (!e) porEscuela.set(a.escuela_id, (e = { docentes: new Set(), porMateria: new Map(), cargas: 0, ultimo: 0 }));
      const cuando = Date.parse(a.enviado_en) || 0;
      e.docentes.add(a.docente_id);
      e.cargas += 1;
      e.ultimo = Math.max(e.ultimo, cuando);
      // Por materia: cuántas cargas (una por docente y año) y de cuántos docentes
      let m = e.porMateria.get(a.espacio_id);
      if (!m) e.porMateria.set(a.espacio_id, (m = { cargas: 0, docentes: new Set(), ultimo: 0 }));
      m.cargas += 1;
      m.docentes.add(a.docente_id);
      m.ultimo = Math.max(m.ultimo, cuando);
    }
    const fila = (escuela, extra) => {
      const e = porEscuela.get(escuela.id);
      return { id: escuela.id, nombre: escuela.nombre, localidad: escuela.localidad || '', extra,
        docentes: e ? e.docentes.size : 0, materias: e ? e.porMateria.size : 0, cargas: e ? e.cargas : 0,
        ultimo: e ? e.ultimo : 0, idsDocentes: e ? e.docentes : null, porMateria: e ? e.porMateria : new Map() };
    };

    const grupos = Catalogo.departamentos().map((d) => ({
      id: d.id, nombre: d.nombre,
      escuelas: ((Catalogo.buscarEscuelas('', d.id).grupos[0] || {}).escuelas || []).map((es) => fila(es, null)),
      extras: [],
    }));
    const porDepartamento = new Map(grupos.map((g) => [g.id, g]));

    // Las que no están en la nómina: primero las que el panel ya conoce, y las
    // que no (agregadas después de entrar, o que salieron), se piden a la base
    const nomina = new Set(grupos.flatMap((g) => g.escuelas.map((e) => e.id)));
    const conocidas = new Map(estado.escuelasAgregadas.map((e) => [e.id, Object.assign({ origen: 'agregada_por_docente' }, e)]));
    const faltanDatos = [...porEscuela.keys()].filter((id) => !nomina.has(id) && !conocidas.has(id));
    if (faltanDatos.length) {
      const { data } = await sb.from('escuelas').select('id, nombre, localidad, departamento_id, origen').in('id', faltanDatos);
      for (const e of data || []) conocidas.set(e.id, e);
    }
    for (const id of porEscuela.keys()) {
      if (nomina.has(id)) continue;
      const e = conocidas.get(id) || { id, nombre: id, localidad: '', departamento_id: null, origen: null };
      let g = porDepartamento.get(e.departamento_id);
      if (!g) {
        g = porDepartamento.get('') || { id: '', nombre: 'Sin departamento', escuelas: [], extras: [] };
        if (!porDepartamento.has('')) { porDepartamento.set('', g); grupos.push(g); }
      }
      g.extras.push(Object.assign(fila(e, e.origen === 'agregada_por_docente' ? 'la agregó un docente' : 'ya no está en la nómina'),
        { agregada: e.origen === 'agregada_por_docente' }));
    }

    for (const g of grupos) {
      g.extras.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      g.total = g.escuelas.length;
      g.cargaron = g.escuelas.filter((e) => e.docentes > 0).length;
      g.faltan = g.total - g.cargaron;
      const docentes = new Set();
      for (const e of g.escuelas.concat(g.extras)) if (e.idsDocentes) e.idsDocentes.forEach((id) => docentes.add(id));
      g.docentes = docentes.size;
    }
    const suma = (k) => grupos.reduce((n, g) => n + g[k], 0);
    return {
      grupos,
      provincia: { total: suma('total'), cargaron: suma('cargaron'), faltan: suma('faltan'),
        docentes: new Set(envios.map((a) => a.docente_id)).size },
    };
  }

  // Los contactos de las escuelas (sql/13). Son pocos y se traen de una vez.
  // Si la tabla todavía no existe, el seguimiento anda igual y la ficha lo dice.
  async function traerContactos() {
    const { data, error } = await sb.from('contactos_escuela').select('id, escuela_id, nombre, cargo, celular, correo').order('id');
    if (error) return null;
    const porEscuela = new Map();
    for (const c of data || []) {
      if (!porEscuela.has(c.escuela_id)) porEscuela.set(c.escuela_id, []);
      porEscuela.get(c.escuela_id).push(c);
    }
    return porEscuela;
  }

  // Las sedes que corrigió el equipo (sql/14): anexo → E.P.E.S., o null si no
  // depende de ninguna. Sin la tabla, vale la de la nómina y no se puede cambiar.
  async function traerSedes() {
    const { data, error } = await sb.from('sedes_anexos').select('anexo_id, sede_id');
    if (error) return null;
    return new Map((data || []).map((x) => [x.anexo_id, x.sede_id]));
  }

  async function cargarSeguimiento() {
    const s = estado.seguimiento;
    Ficha.cerrar();
    s.cargando = true;
    s.error = null;
    render();
    let datos = null;
    let error = null;
    let contactos = null;
    let sedes = null;
    try {
      const [envios, c, x] = await Promise.all([traerEnvios(), traerContactos(), traerSedes()]);
      contactos = c;
      sedes = x;
      datos = await contarSeguimiento(envios);
    } catch (e) {
      error = (e && e.message) || 'No pudimos traer las cargas. Volvé a intentar.';
    }
    s.cargando = false;
    s.datos = datos;
    s.contactos = contactos;
    s.sedes = sedes;
    s.error = error;
    if (estado.pantalla === 'seguimiento') render();
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
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (hash.has('escuelas')) { irAEscuelas(hash.get('escuelas')); return; }
    if (hash.has('seguimiento')) {
      estado.seguimiento.soloFaltan = hash.get('faltan') === '1';
      estado.seguimiento.agregadas = hash.get('agregadas') === '1';
      irAlSeguimiento(hash.get('seguimiento'));
      return;
    }
    if (hash.has('materia')) { irAlPanel('resultados'); return; }
    irAlInicio();
  }

  // El inicio: el nombre del sistema, una línea de cómo va la carga y los tres
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

  // Las cargas se cuentan de nuevo cada vez que se entra: así está al día
  function irAlSeguimiento(lugar) {
    estado.pantalla = 'seguimiento';
    estado.modo = 'resultados';
    estado.exportar = null;
    Editor.limpiar();
    if (lugar !== undefined) estado.seguimiento.lugar = lugar || null;
    escribirHashSeguimiento();
    render();
    window.scrollTo(0, 0);
    cargarSeguimiento();
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
    estado.seguimiento = { lugar: null, soloFaltan: false, agregadas: false, datos: null, contactos: null, sedes: null, cargando: false, error: null };
    Ficha.cerrar();
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
        ${['inicio', 'panel', 'seguimiento', 'escuelas'].includes(estado.pantalla) ? navegacion() : ''}
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

  // La cabecera solo lleva por dónde moverse: Inicio, Resultados, Catálogo,
  // Seguimiento y Escuelas, con el lugar actual marcado, y la ayuda y la salida. Las
  // acciones de cada pantalla van en su propia barra, al lado de lo que afectan.
  function navegacion() {
    const actual = ['inicio', 'seguimiento', 'escuelas'].includes(estado.pantalla) ? estado.pantalla : estado.modo === 'catalogo' ? 'catalogo' : 'resultados';
    const enlace = (id, accion, texto) =>
      `<button type="button" class="t-enlace-cab ${actual === id ? 't-enlace-cab--actual' : ''}" data-accion="${accion}" ${actual === id ? 'aria-current="page"' : ''}>${texto}</button>`;
    return `<nav class="t-nav" aria-label="Secciones">
        ${enlace('inicio', 'ir-inicio', 'Inicio')}
        ${enlace('resultados', 'ir-resultados', 'Resultados')}
        ${enlace('catalogo', 'ir-catalogo', 'Catálogo')}
        ${enlace('seguimiento', 'ir-seguimiento', 'Seguimiento')}
        ${enlace('escuelas', 'ir-escuelas', 'Escuelas')}
      </nav>
      <span class="t-nav__separador" aria-hidden="true"></span>
      ${estado.pantalla === 'panel' ? '<button type="button" class="t-enlace-cab t-ayuda" data-accion="tour" title="Ver cómo se usa esta pantalla">¿Cómo se usa?</button>' : ''}
      <button type="button" class="t-enlace-cab" data-accion="salir">Salir</button>`;
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
        <div class="t-estado__texto">Cuando los docentes envíen esta materia y año, los resultados aparecen acá solos. Mientras tanto, probá con otra materia, otro año u otro alcance.</div>
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
      const a = alcanceSeguimiento();
      if (a.soloFaltan) return 'Una hoja con cada escuela, su localidad y su contacto (o el de su sede, si es un anexo), para llamarlas. <strong>Trae nombres y celulares de directivos: es de uso interno, no para repartir.</strong>';
      return a.tipo === 'escuela'
        ? 'Tres hojas: <strong>por materia</strong>, sus <strong>envíos</strong> (uno por fila) y el <strong>detalle</strong> de cada envío. <strong>Trae nombre y apellido de cada docente: es de uso interno, no para repartir.</strong>'
        : 'Tres hojas: <strong>por escuela</strong> (con su contacto, también las que todavía no cargaron), los <strong>envíos</strong> (uno por fila) y el <strong>detalle</strong> de cada envío. <strong>Trae nombres de docentes y contactos de directivos: es de uso interno, no para repartir.</strong>';
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

  // El Excel del seguimiento de la carga (uso interno, trae nombres). Se abre
  // desde la pantalla de Seguimiento y baja lo que se está mirando ahí: el
  // alcance elegido y, si está puesta, la solapa «Solo las que no cargaron».
  function panelControl(x) {
    const a = alcanceSeguimiento();
    return `<div class="t-velo" data-accion="cerrar-exportar"></div>
    <div class="t-panel" role="dialog" aria-modal="true" aria-labelledby="control-titulo">
      <div class="t-panel__cabecera">
        <h2 class="t-panel__titulo" id="control-titulo">Seguimiento de la carga</h2>
        <button type="button" class="t-panel__cerrar" data-accion="cerrar-exportar" aria-label="Cerrar">${Icono.cerrar}</button>
      </div>
      <p class="t-panel__bajada">Baja lo que estás mirando: <strong>${esc(a.nombre)}</strong>${a.soloFaltan ? `, solo las <strong>${numero(a.faltan)} ${plural(a.faltan, 'escuela que todavía no cargó', 'escuelas que todavía no cargaron')}</strong>` : ''}. De todas las materias. Para bajar otra cosa, cerrá esta ventana y cambiá el alcance o la solapa.</p>
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
        p_ejemplo: false,   // solo envíos reales (ver sql/mantenimiento/2026-10-27_sin_datos_de_ejemplo.sql)
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
        const a = alcanceSeguimiento();
        window.XLSX.writeFile(await libroControl(a), `seguimiento-${limpioArchivo(a.nombre)}${a.soloFaltan ? '-sin-cargas' : ''}-${hoyArchivo()}.xlsx`);
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

  // Baja una vista entera de a páginas, avisando cuánto lleva. Solo envíos
  // reales; «filtrar» achica la consulta (un departamento, una escuela).
  async function traerTodo(vista, columnas, orden, aviso, filtrar = (q) => q) {
    const filas = [];
    let desde = 0;
    for (;;) {
      let q = filtrar(sb.from(vista).select(columnas.join(',')).eq('es_ejemplo', false));
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

  // Lo que se está mirando en Seguimiento, para que el Excel baje eso mismo
  function alcanceSeguimiento() {
    const s = estado.seguimiento;
    const d = s.datos;
    const g = s.lugar && d ? d.grupos.find((x) => x.id === s.lugar) : null;
    const una = s.lugar && !g ? escuelaSeg(s.lugar) : null;
    if (una) return { tipo: 'escuela', nombre: una.escuela.nombre, escuela: una.escuela, grupo: una.grupo, soloFaltan: false, faltan: 0 };
    if (g) return { tipo: 'departamento', nombre: `Departamento ${g.nombre}`, grupo: g, soloFaltan: s.soloFaltan, faltan: g.faltan };
    return { tipo: 'provincia', nombre: 'Toda la provincia', soloFaltan: s.soloFaltan, faltan: d ? d.provincia.faltan : 0 };
  }

  // El contacto de una escuela en columnas de Excel; si es un anexo sin
  // contacto propio, el de su sede, dicho. Varios contactos van con « / ».
  function contactoParaExcel(id) {
    const todos = estado.seguimiento.contactos;
    if (!todos) return ['', '', '', ''];
    let lista = todos.get(id) || [];
    let deLaSede = '';
    if (!lista.length) {
      const sede = sedeDe(id);
      lista = sede ? todos.get(sede.id) || [] : [];
      if (lista.length) deLaSede = ` (de la sede: ${sede.nombre}, ${dondeSede(sede, id)})`;
    }
    const unir = (f) => lista.map(f).filter(Boolean).join(' / ');
    return [unir((c) => c.nombre) + (lista.length ? deLaSede : ''), unir((c) => c.cargo), unir((c) => (c.celular ? celularLegible(c.celular) : '')), unir((c) => c.correo)];
  }

  const nombreEspacio = (id) => {
    const esp = Catalogo.espacio(id);
    return esp ? (Catalogo.esArtistica(esp) ? esp.nombre : Catalogo.nombreCorto(esp)) : id;
  };
  const fechaExcel = (ms) => (ms ? new Date(ms).toLocaleString('es-AR') : '');

  // Seguimiento de la carga (uso interno). Baja lo que se está mirando:
  //   - solo las que no cargaron: una hoja con cada escuela y su contacto;
  //   - toda la provincia o un departamento: por escuela (con contacto), los
  //     envíos y el detalle;
  //   - una escuela: por materia, sus envíos y su detalle.
  // Las cuentas por escuela salen de las mismas que muestra la pantalla.
  async function libroControl(a) {
    const X = window.XLSX;
    const s = estado.seguimiento;
    if (!s.datos) throw new Error('Esperá a que termine de contar las cargas y volvé a intentar.');
    const fecha = `${a.nombre} · todas las materias · Datos al ${fechaLarga(new Date())}. Es para uso interno, no para repartir.`;
    const libro = X.utils.book_new();
    const grupos = a.tipo === 'provincia' ? s.datos.grupos.filter((g) => g.total || g.extras.length) : [a.grupo];

    // Solo las que no cargaron: la lista para llamar
    if (a.soloFaltan) {
      const filas = grupos.flatMap((g) => g.escuelas.filter((e) => !e.docentes)
        .map((e) => [g.nombre, e.nombre, e.localidad].concat(contactoParaExcel(e.id))));
      X.utils.book_append_sheet(libro, hojaConTitulo(X, 'Escuelas que todavía no cargaron — uso interno',
        [`${numero(filas.length)} ${plural(filas.length, 'escuela', 'escuelas')}, en el orden de la nómina. El contacto es el de la escuela o, si es un anexo sin contacto propio, el de su sede.`, fecha],
        ['Departamento', 'Escuela', 'Localidad', 'Contacto', 'Cargo', 'Celular', 'Correo'],
        filas, [16, 44, 22, 30, 20, 16, 30]), 'Sin cargas');
      return libro;
    }

    // Los envíos y su detalle, solo del alcance elegido
    let filtroAportes = (q) => q;
    let filtroDetalle = (q) => q;
    if (a.tipo === 'departamento') {
      filtroAportes = (q) => q.eq('departamento_id', a.grupo.id);
      filtroDetalle = (q) => q.eq('departamento', a.grupo.nombre);   // los nombres de departamento no se repiten
    } else if (a.tipo === 'escuela') {
      filtroAportes = (q) => q.eq('escuela_id', a.escuela.id);
    }
    const aportes = await traerTodo('v_aportes',
      ['aporte_id', 'enviado_en', 'docente_id', 'apellido', 'nombre', 'escuela_id', 'escuela', 'localidad', 'departamento', 'espacio', 'anio'],
      ['aporte_id'], 'Trayendo los envíos', filtroAportes);
    // Se piden las columnas de orden solo para ordenar; en el archivo van las que lee una persona
    const columnasDetalle = ['aporte_id', 'enviado_en', 'departamento', 'escuela', 'localidad', 'apellido', 'nombre', 'espacio', 'anio', 'trimestre', 'eje', 'saber', 'saber_id', 'estado', 'tipo', 'contenido'];
    const ordenDetalle = ['aporte_id', 'saber_id', 'contenido_orden'];
    let respuestas = [];
    if (a.tipo === 'escuela') {
      // Una escuela: por sus envíos (el nombre de la escuela se repite en la nómina)
      const ids = aportes.map((x) => x.aporte_id);
      for (let i = 0; i < ids.length; i += 150) {
        const tanda = ids.slice(i, i + 150);
        respuestas = respuestas.concat(await traerTodo('v_relevamiento', columnasDetalle, ordenDetalle, 'Trayendo el detalle de cada envío', (q) => q.in('aporte_id', tanda)));
      }
    } else {
      respuestas = await traerTodo('v_relevamiento', columnasDetalle, ordenDetalle, 'Trayendo el detalle de cada envío', filtroDetalle);
    }
    if (estado.exportar) { estado.exportar.progreso = 'Armando el Excel…'; render(); }

    // Cuánto contestó cada envío
    const cuenta = new Map();
    for (const f of respuestas) {
      if (!cuenta.has(f.aporte_id)) cuenta.set(f.aporte_id, { trabaja: new Set(), noTrabaja: new Set(), contenidos: 0 });
      const c = cuenta.get(f.aporte_id);
      if (f.estado === 'no_trabaja') c.noTrabaja.add(f.saber_id);
      else { c.trabaja.add(f.saber_id); c.contenidos += 1; }
    }

    // 1 · Por escuela (o por materia, si es una escuela): las mismas cuentas
    // que la pantalla, en su mismo orden, con el contacto al lado
    if (a.tipo === 'escuela') {
      const e = a.escuela;
      const filas = Catalogo.areas().flatMap((ar) => Catalogo.espaciosPorArea(ar.id)).map((esp) => {
        const m = e.porMateria.get(esp.id);
        return [nombreEspacio(esp.id), m ? m.cargas : 0, m ? m.docentes.size : 0, m ? fechaExcel(m.ultimo) : '', m ? '' : 'Sin cargas todavía'];
      });
      const [contacto, cargo, celular, correo] = contactoParaExcel(e.id);
      X.utils.book_append_sheet(libro, hojaConTitulo(X, `${e.nombre} — por materia — uso interno`,
        [`${e.localidad ? `${e.localidad} · ` : ''}${numero(e.docentes)} ${plural(e.docentes, 'docente', 'docentes')}, ${numero(e.cargas)} ${plural(e.cargas, 'carga', 'cargas')} en ${numero(e.materias)} ${plural(e.materias, 'materia', 'materias')}.`,
          `Contacto: ${[contacto, cargo, celular, correo].filter(Boolean).join(' · ') || 'sin contacto cargado'}`, fecha],
        ['Materia', 'Cargas', 'Docentes', 'Último envío', 'Estado'], filas, [36, 9, 10, 18, 20]), 'Por materia');
    } else {
      const filas = grupos.flatMap((g) => g.escuelas.filter((e) => !e.docentes).concat(g.escuelas.filter((e) => e.docentes), g.extras)
        .map((e) => [g.nombre, e.nombre + (e.extra ? ` (${e.extra})` : ''), e.localidad, e.docentes, e.cargas,
          [...e.porMateria.keys()].map(nombreEspacio).sort((x, y) => x.localeCompare(y, 'es')).join(', '),
          fechaExcel(e.ultimo), e.docentes ? '' : 'Sin cargas todavía'].concat(contactoParaExcel(e.id))));
      const total = grupos.reduce((n, g) => n + g.total, 0);
      const faltan = grupos.reduce((n, g) => n + g.faltan, 0);
      X.utils.book_append_sheet(libro, hojaConTitulo(X, 'Por escuela — uso interno',
        [`${numero(total)} escuelas de la nómina; ${numero(faltan)} ${plural(faltan, 'todavía no cargó', 'todavía no cargaron')} y van primero en cada departamento.`, fecha],
        ['Departamento', 'Escuela', 'Localidad', 'Docentes que cargaron', 'Cargas', 'Materias cargadas', 'Último envío', 'Estado', 'Contacto', 'Cargo', 'Celular', 'Correo'],
        filas, [16, 40, 20, 12, 9, 50, 18, 20, 28, 18, 16, 28]), 'Por escuela');
    }

    // 2 · Envíos: uno por fila
    const orden = (x, y) => ['departamento', 'escuela', 'apellido', 'nombre', 'espacio'].reduce((r, k) => r || String(x[k] || '').localeCompare(String(y[k] || ''), 'es'), 0) || (x.anio - y.anio);
    const envios = aportes.slice().sort(orden).map((x) => {
      const c = cuenta.get(x.aporte_id) || { trabaja: new Set(), noTrabaja: new Set(), contenidos: 0 };
      return [x.apellido || '', x.nombre || '', x.escuela || '', x.localidad || '', x.departamento || '', x.espacio || '', x.anio == null ? '' : `${x.anio}°`,
        x.enviado_en ? new Date(x.enviado_en).toLocaleString('es-AR') : '', c.trabaja.size, c.noTrabaja.size, c.contenidos];
    });
    const docentes = new Set(aportes.map((x) => x.docente_id)).size;
    X.utils.book_append_sheet(libro, hojaConTitulo(X, 'Envíos — uso interno',
      [`${numero(aportes.length)} ${plural(aportes.length, 'envío', 'envíos')} de ${numero(docentes)} ${plural(docentes, 'docente', 'docentes')}. Un envío por fila: quien cargó dos materias aparece dos veces.`, fecha],
      ['Apellido', 'Nombre', 'Escuela', 'Localidad', 'Departamento', 'Materia', 'Año', 'Enviado', 'Saberes que trabaja', 'Saberes que no trabaja', 'Contenidos elegidos'],
      envios, [18, 18, 34, 20, 16, 30, 6, 18, 12, 12, 12]), 'Envíos');

    // 3 · Detalle: una fila por contenido elegido o saber que no trabaja
    const detalle = respuestas.map((f) => [
      f.enviado_en ? new Date(f.enviado_en).toLocaleString('es-AR') : '',
      f.departamento || '', f.escuela || '', f.localidad || '', f.apellido || '', f.nombre || '',
      f.espacio || '', f.anio == null ? '' : f.anio, f.trimestre == null ? '' : f.trimestre, f.eje || '', f.saber || '',
      f.estado === 'no_trabaja' ? 'no' : 'sí',
      f.contenido || '',
      f.tipo === 'libre' ? 'agregado por el docente' : (f.tipo === 'catalogo' ? 'sugerido' : ''),
    ]);
    X.utils.book_append_sheet(libro, hojaConTitulo(X, 'Detalle de cada envío — uso interno',
      ['Una fila por contenido elegido y por saber que el docente dijo que no trabaja.', fecha],
      ['Enviado', 'Departamento', 'Escuela', 'Localidad', 'Apellido', 'Nombre', 'Materia', 'Año', 'Trimestre', 'Eje', 'Saber', 'Lo trabaja', 'Contenido', 'Origen del contenido'],
      detalle, [18, 16, 36, 20, 18, 18, 28, 5, 9, 40, 70, 10, 60, 22]), 'Detalle');
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
            ${opcion('ir-seguimiento',
              svg('<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/><path d="M17 16l2 2 3-4"/>', { tam: 28, color: '#003380', grosor: 2 }),
              'Seguir la carga',
              'Qué escuelas cargaron y a cuáles hay que llamar.')}
            ${opcion('ir-catalogo',
              svg('<path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>', { tam: 28, color: '#003380', grosor: 2 }),
              'Editar el catálogo',
              'Los saberes y contenidos que ven los docentes.')}
          </div>
        </div>
      </main>
    </div>`;
  }

  /* ---------- Seguimiento de la carga ---------- */

  // Cuántos docentes cargaron en cada escuela, de todas las materias, para ver
  // a qué escuelas hay que llamar antes del cierre. No muestra nombres de
  // docentes: eso queda en el Excel de uso interno, que se baja desde acá.

  // El último envío de una escuela: «hoy», «ayer» o «12 oct»
  function cuandoFue(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const h = new Date();
    const dias = Math.round((new Date(h.getFullYear(), h.getMonth(), h.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    if (dias === 0) return 'hoy';
    if (dias === 1) return 'ayer';
    return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  }

  function barraSeguimiento() {
    const s = estado.seguimiento;
    const opcion = (id, texto) => `<option value="${esc(id)}" ${(s.lugar || '') === id ? 'selected' : ''}>${esc(texto)}</option>`;
    // Las escuelas que no están en la nómina (agregadas por docentes) solo
    // se conocen después de contar
    const extras = s.datos ? s.datos.grupos.flatMap((g) => g.extras) : estado.escuelasAgregadas;
    const opciones = [
      opcion('', 'Toda la provincia'),
      `<optgroup label="Por departamento">${Catalogo.departamentos().map((d) => opcion(d.id, `Departamento ${d.nombre}`)).join('')}</optgroup>`,
      ...Catalogo.departamentos().map((d) => {
        const grupo = Catalogo.buscarEscuelas('', d.id).grupos[0];
        return grupo ? `<optgroup label="Escuelas · ${esc(d.nombre)}">${grupo.escuelas.map((e) => opcion(e.id, e.nombre)).join('')}</optgroup>` : '';
      }),
      extras.length ? `<optgroup label="Escuelas agregadas por docentes">${extras.map((e) => opcion(e.id, e.nombre)).join('')}</optgroup>` : '',
    ].join('');
    return `<div class="t-selectores">
      <div class="t-selector">
        <label class="t-selector__etiqueta" for="s-seg-lugar">Alcance</label>
        <select class="t-select t-select--alcance" id="s-seg-lugar" data-cambio="seg-lugar">${opciones}</select>
      </div>
      <div class="espaciador"></div>
      <div class="t-selectores__acciones">
        <button type="button" class="t-exportar" data-accion="abrir-control">${Icono.descargar}Descargar el Excel</button>
      </div>
    </div>`;
  }

  // «Cargaron 1.234 docentes de 180 de las 288 escuelas. 108 escuelas todavía no cargaron.»
  function contextoSeguimiento(d, g) {
    const c = g || d.provincia;
    let texto;
    if (!c.docentes) {
      texto = g ? `Todavía no cargó ningún docente del departamento ${esc(g.nombre)}.` : 'Todavía no cargó ningún docente.';
    } else {
      texto = `${g ? `En el departamento ${esc(g.nombre)} cargaron` : 'Cargaron'} <strong>${numero(c.docentes)} ${plural(c.docentes, 'docente', 'docentes')}</strong> de <strong>${numero(c.cargaron)} ${g ? 'de sus' : 'de las'} ${numero(c.total)} escuelas</strong>. `
        + (c.faltan
          ? `<strong>${numero(c.faltan)} ${plural(c.faltan, 'escuela todavía no cargó', 'escuelas todavía no cargaron')}</strong>.`
          : 'Ya cargaron todas las escuelas.');
    }
    // Dos formas de ver la misma lista, como Detalle y Mapa de calor, y las
    // que escribieron los docentes, si hay alguna para unificar o ya unificada
    const s = estado.seguimiento;
    const vista = s.agregadas ? 'agregadas' : s.soloFaltan ? '1' : '';
    const solapa = (valor, titulo) =>
      `<button type="button" class="t-vista ${vista === valor ? 't-vista--activa' : ''}" data-accion="seg-solo" data-solo="${valor}" aria-pressed="${vista === valor}">${titulo}</button>`;
    const agregadas = agregadasPendientes(g ? [g] : d.grupos).length;
    // Aparece con alguna escrita a mano aunque la base todavía no deje
    // unificar: la vista dice por qué, en vez de que la solapa falte sin más
    const conAgregadas = agregadas || unificadasDe(g).length || s.agregadas;
    return `<div class="t-contexto">
      <div class="t-contexto__texto">${texto}</div>
      <div class="t-vistas">
        ${solapa('', 'Todas las escuelas')}
        ${solapa('1', `Solo las que no cargaron (${numero(c.faltan)})`)}
        ${conAgregadas ? solapa('agregadas', `Agregadas por docentes (${numero(agregadas)})`) : ''}
      </div>
    </div>`;
  }

  /* ---------- Unificar las agregadas con la nómina ---------- */

  const agregadasPendientes = (grupos) => grupos.flatMap((g) => g.extras.filter((e) => e.agregada).map((e) => ({ e, g })));
  const unificadasDe = (g) => (estado.unificadas || []).filter((u) => !g || u.agregada.departamento_id === g.id);

  // Cuál de la nómina parece ser, para que venga elegida (se puede cambiar).
  // Con número («epes 41», «escuela n° 41»): la E.P.E.S. con ese número del
  // mismo departamento, y entre la común, la E.I.B. y la agraria, la que diga
  // el texto. Sin número: la única de la nómina en esa localidad, o la que
  // comparta casi todas las palabras del nombre. Si no hay una clara, ninguna.
  const PALABRAS_VACIAS = new Set(['e', 'p', 's', 'n', 'nro', 'numero', 'de', 'del', 'la', 'el', 'los', 'las', 'escuela', 'epes', 'colegio', 'secundaria', 'provincial', 'educacion', 'anexo', 'y']);
  // Las palabras que distinguen un nombre: sin «escuela», «de», «n°»…
  const palabrasDe = (t) => new Set(normalizarTexto(t).split(' ').filter((w) => w && !PALABRAS_VACIAS.has(w)));

  // Si no hay una de la nómina clara, otra escrita a mano que parezca la
  // misma («instituto san martin» e «Inst. Gral. San Martín»), aunque esté en
  // otro departamento: el docente pudo elegirlo mal. Las abreviaturas cuentan
  // por la palabra entera («inst» por «instituto»).
  function sugerirOtraEscrita(e, depId) {
    const p = palabrasDe(e.nombre);
    if (!p.size) return null;
    const coincide = (w, q) => q.has(w) || [...q].some((x) => x.length >= 3 && w.length >= 3 && (x.startsWith(w) || w.startsWith(x)));
    let mejor = null;
    let puntaje = 0;
    for (const x of estado.escuelasAgregadas) {
      if (x.id === e.id) continue;
      const q = palabrasDe(x.nombre);
      if (!q.size) continue;
      const comunes = [...p].filter((w) => coincide(w, q)).length;
      const valor = comunes / Math.max(p.size, q.size) + (x.departamento_id === depId ? 0.05 : 0);
      if (valor > puntaje) { puntaje = valor; mejor = x; }
    }
    return puntaje >= 0.75 ? mejor : null;
  }

  function sugerirDestino(e, depId) {
    return sugerirDeLaNomina(e, depId) || sugerirOtraEscrita(e, depId);
  }

  function sugerirDeLaNomina(e, depId) {
    const texto = normalizarTexto(e.nombre);
    const delDep = ((Catalogo.buscarEscuelas('', depId).grupos[0] || {}).escuelas || []);
    const num = (texto.match(/\b(\d{1,3})\b/) || [])[1];
    if (num) {
      const tipo = /\b(eib|bilingue|intercultural)\b/.test(texto) ? 'EPES EIB' : /\bagraria\b/.test(texto) ? 'EPES AGRARIA' : 'EPES';
      const conNumero = delDep.filter((x) => !esAnexo(x) && x.numero === num);
      return conNumero.find((x) => x.tipo === tipo) || (conNumero.length === 1 ? conNumero[0] : null);
    }
    const loc = normalizarTexto(e.localidad || '');
    if (loc) {
      const enLaLocalidad = delDep.filter((x) => normalizarTexto(x.localidad || '') === loc);
      if (enLaLocalidad.length === 1) return enLaLocalidad[0];
    }
    const p = palabrasDe(e.nombre);
    if (!p.size) return null;
    const parecidas = delDep.filter((x) => {
      const q = palabrasDe(`${x.nombre} ${x.localidad || ''}`);
      return [...p].filter((w) => q.has(w)).length / p.size >= 0.8;
    });
    return parecidas.length === 1 ? parecidas[0] : null;
  }

  // La lista para elegir: la sugerida arriba; después las otras escritas a
  // mano (para juntar dos que escribieron distinto la misma escuela que falta
  // en la nómina), las de su departamento primero; y la nómina, su
  // departamento primero.
  function opcionesDestino(e, depId, elegida, sugerida) {
    const opcion = (x, extra) => `<option value="${esc(x.id)}" ${x.id === elegida ? 'selected' : ''}>${esc(x.nombre)}${x.localidad ? ` · ${esc(x.localidad)}` : ''}${extra || ''}</option>`;
    const grupos = Catalogo.buscarEscuelas('').grupos;
    const orden = grupos.filter((g) => g.departamento.id === depId).concat(grupos.filter((g) => g.departamento.id !== depId));
    const otra = (x) => x.id !== e.id && (!sugerida || x.id !== sugerida.id);
    const otras = estado.escuelasAgregadas.filter((x) => otra(x) && x.departamento_id === depId)
      .concat(estado.escuelasAgregadas.filter((x) => otra(x) && x.departamento_id !== depId));
    const escrita = (x) => !Catalogo.escuela(x.id);
    return `<option value="" ${elegida ? '' : 'selected'}>Elegí cuál es…</option>
      ${sugerida ? `<optgroup label="Parece ser">${opcion(sugerida, escrita(sugerida) ? ' (también escrita a mano)' : '')}</optgroup>` : ''}
      ${otras.length ? `<optgroup label="Otras escritas a mano">${otras.map((x) => opcion(x, ` (${esc(nombreDepartamento(x.departamento_id))})`)).join('')}</optgroup>` : ''}
      ${orden.map((g) => `<optgroup label="Nómina · ${esc(g.departamento.nombre)}">${g.escuelas.filter((x) => !sugerida || x.id !== sugerida.id).map((x) => opcion(x)).join('')}</optgroup>`).join('')}`;
  }

  const nombreDepartamento = (id) => { const d = Catalogo.departamento(id); return d ? d.nombre : 'sin departamento'; };

  function nombreEscuela(id) {
    const e = Catalogo.escuela(id) || estado.escuelasAgregadas.find((x) => x.id === id);
    return e ? e.nombre : id;
  }

  function vistaAgregadas(grupos, g) {
    const u = estado.unificar;
    const pendientes = agregadasPendientes(grupos);
    const aviso = u.aviso ? `<p class="t-unif-aviso" role="status"><span>${u.aviso.texto}</span>
        ${u.aviso.agregada_id ? `<button type="button" class="t-ficha__enlace" data-accion="unif-deshacer" data-id="${esc(u.aviso.agregada_id)}" ${u.guardando ? 'disabled' : ''}>Deshacer</button>` : ''}</p>` : '';
    const error = u.error ? `<p class="t-ficha__error" role="alert">${esc(u.error)}</p>` : '';
    const puede = !!estado.unificadas;
    const sinBase = puede ? '' : `<p class="t-unif-aviso" role="alert"><span><strong>Todavía no se puede unificar:</strong> la base no tiene lo necesario o no lo ve todavía. Si recién se corrió <em>sql/15_unificar_escuelas.sql</em>, volvé a correrlo entero, esperá un minuto y recargá. ${estado.unificadasError ? `Lo que respondió la base: «${esc(estado.unificadasError)}».` : ''}</span></p>`;
    const filas = pendientes.map(({ e, g: suGrupo }) => {
      const cargas = `${numero(e.cargas)} ${plural(e.cargas, 'carga', 'cargas')} de ${numero(e.docentes)} ${plural(e.docentes, 'docente', 'docentes')}`;
      const donde = [e.localidad, suGrupo.id ? `departamento ${suGrupo.nombre}` : ''].filter(Boolean).join(' · ');
      const lapiz = puede && !u.confirmando && !u.editando
        ? `<button type="button" class="t-ficha__icono" data-accion="unif-editar" data-id="${esc(e.id)}" title="Corregir cómo quedó escrita" aria-label="Corregir «${esc(e.nombre)}»">${IconoFicha.corregir}</button>` : '';
      const escrita = `<div class="t-unif__escrita"><div class="t-unif__nombre"><strong>«${esc(e.nombre)}»</strong>${lapiz}</div><span>${esc(donde)}${donde ? ' · ' : ''}${cargas}</span></div>`;
      if (!puede) return `<li class="t-unif__fila" data-agregada="${esc(e.id)}">${escrita}</li>`;
      if (u.editando === e.id) {
        const depActual = suGrupo.id || '';
        return `<li class="t-unif__fila t-unif__fila--confirmando" data-agregada="${esc(e.id)}">
          <form class="t-ficha__form t-unif__editar" data-form="unif-editar" data-id="${esc(e.id)}" novalidate aria-label="Corregir la escuela escrita a mano">
            <label class="t-ficha__campo t-unif__editar-nombre"><span>Nombre de la escuela</span><input name="nombre" type="text" value="${esc(e.nombre)}" autocomplete="off"></label>
            <label class="t-ficha__campo"><span>Localidad</span><input name="localidad" type="text" value="${esc(e.localidad || '')}" autocomplete="off"></label>
            <label class="t-ficha__campo"><span>Departamento</span><select name="departamento">${Catalogo.departamentos().map((d) =>
              `<option value="${esc(d.id)}" ${d.id === depActual ? 'selected' : ''}>${esc(d.nombre)}</option>`).join('')}</select></label>
            <div class="t-ficha__form-acciones">
              <button type="submit" class="t-ficha__si" ${u.guardando ? 'disabled' : ''}>${u.guardando ? 'Guardando…' : 'Guardar'}</button>
              <button type="button" class="t-ficha__enlace" data-accion="unif-cancelar">Cancelar</button>
              <span class="t-unif__editar-nota">${cargas}. Si es la misma que otra, mejor unificalas.</span>
            </div>
          </form></li>`;
      }
      if (u.confirmando && u.confirmando.id === e.id) {
        return `<li class="t-unif__fila t-unif__fila--confirmando" data-agregada="${esc(e.id)}">${escrita}
          <div class="t-unif__confirmar">
            <p>${plural(e.cargas, 'Su carga pasa', `Sus ${numero(e.cargas)} cargas pasan`)} a <strong>${esc(nombreEscuela(u.confirmando.destino))}</strong>${Catalogo.escuela(u.confirmando.destino) ? '' : ' (también escrita a mano)'} y «${esc(e.nombre)}» deja de aparecer aparte. Si alguien vuelve a escribirla así, su carga va directo ahí.</p>
            <div class="t-ficha__form-acciones">
              <button type="button" class="t-ficha__si" data-accion="unif-confirmar" ${u.guardando ? 'disabled' : ''}>${u.guardando ? 'Unificando…' : 'Unificar'}</button>
              <button type="button" class="t-ficha__enlace" data-accion="unif-cancelar">Cancelar</button>
            </div>
          </div></li>`;
      }
      const sugerida = sugerirDestino(e, suGrupo.id);
      const elegida = u.elegidas.has(e.id) ? u.elegidas.get(e.id) : (sugerida ? sugerida.id : '');
      return `<li class="t-unif__fila" data-agregada="${esc(e.id)}">${escrita}
        <div class="t-unif__elegir">
          <label class="t-ficha__campo"><span>Es la misma que${sugerida && elegida === sugerida.id ? ' (sugerida, revisala)' : ''}</span>
            <select data-cambio="unif-destino" data-id="${esc(e.id)}">${opcionesDestino(e, suGrupo.id, elegida, sugerida)}</select></label>
          <button type="button" class="t-ficha__si" data-accion="unif-pedir" data-id="${esc(e.id)}" ${u.confirmando || u.editando || u.guardando ? 'disabled' : ''}>Unificar</button>
        </div></li>`;
    }).join('');
    const hechas = unificadasDe(g);
    return `<section class="t-seg-bloque">
        <h2 class="t-seg-titulo">Agregadas por docentes <span>${pendientes.length ? `${numero(pendientes.length)} ${plural(pendientes.length, 'escrita', 'escritas')} a mano${g ? ` en el departamento ${esc(g.nombre)}` : ''}` : ''}</span></h2>
        ${sinBase}${aviso}${error}
        ${pendientes.length
          ? `<p class="t-seg-nota">Si una ya está en la nómina, o si dos docentes escribieron distinto la misma escuela, elegí cuál es y unificalas: las cargas pasan a esa. Con el lápiz se corrige cómo quedó escrita.</p>
        <ul class="t-unif">${filas}</ul>`
          : `<p class="t-seg-vacia">No queda ninguna escuela escrita a mano${g ? ` en el departamento ${esc(g.nombre)}` : ''} para revisar.</p>`}
      </section>
      ${hechas.length ? `<section class="t-seg-bloque">
        <h2 class="t-seg-titulo">Ya unificadas <span>${numero(hechas.length)}</span></h2>
        <ul class="t-unif t-unif--hechas">${hechas.map((x) => `<li class="t-unif__hecha">
          <span>«${esc(x.agregada.nombre)}» → <strong>${esc(nombreEscuela(x.destino_id))}</strong> · ${esc(cuandoFue(Date.parse(x.unificada_en)))}</span>
          <button type="button" class="t-ficha__enlace" data-accion="unif-deshacer" data-id="${esc(x.agregada_id)}" ${u.guardando ? 'disabled' : ''}>Deshacer</button></li>`).join('')}</ul>
      </section>` : ''}`;
  }

  async function unificar() {
    const u = estado.unificar;
    const { id, destino } = u.confirmando;
    const agregada = estado.escuelasAgregadas.find((x) => x.id === id) || { nombre: id };
    u.guardando = true; u.error = null; render();
    const { data, error } = await sb.rpc('unificar_escuela', { p_agregada_id: id, p_destino_id: destino });
    u.guardando = false;
    if (error || !data || data.error) {
      u.error = (data && data.error) || 'No pudimos unificar la escuela. Revisá la conexión y volvé a intentar.';
      render();
      return;
    }
    u.confirmando = null;
    u.elegidas.delete(id);
    const repetidas = data.reemplazadas
      ? ` ${numero(data.reemplazadas)} ${plural(data.reemplazadas, 'docente había', 'docentes habían')} cargado la misma materia en las dos: quedó su envío más nuevo.` : '';
    u.aviso = { agregada_id: id, texto: `Listo: «${esc(agregada.nombre)}» quedó unificada con <strong>${esc(nombreEscuela(destino))}</strong>.${repetidas}` };
    await cargarEscuelasAgregadas();
    await cargarSeguimiento();
  }

  async function editarAgregada(form) {
    const u = estado.unificar;
    const datos = Object.fromEntries(new FormData(form).entries());
    u.guardando = true; u.error = null; render();
    const { data, error } = await sb.rpc('editar_escuela_agregada', {
      p_id: form.dataset.id, p_nombre: datos.nombre, p_localidad: datos.localidad, p_departamento_id: datos.departamento,
    });
    u.guardando = false;
    if (error || !data || data.error) {
      u.error = (data && data.error)
        || (error && /editar_escuela_agregada/.test(error.message || '') ? 'Para corregir falta un paso en la base: volvé a correr sql/15_unificar_escuelas.sql entero.' : 'No pudimos guardar la corrección. Revisá la conexión y volvé a intentar.');
      render();
      return;
    }
    u.editando = null;
    u.aviso = { agregada_id: null, texto: `Corregida: ahora dice «${esc(data.nombre)}»${data.localidad ? `, ${esc(data.localidad)}` : ''}, departamento ${esc(nombreDepartamento(data.departamento_id))}.` };
    await cargarEscuelasAgregadas();
    await cargarSeguimiento();
  }

  async function deshacerUnificacion(id) {
    const u = estado.unificar;
    const hecha = (estado.unificadas || []).find((x) => x.agregada_id === id);
    u.guardando = true; u.error = null; render();
    const { data, error } = await sb.rpc('separar_escuela', { p_agregada_id: id });
    u.guardando = false;
    if (error || !data || data.error) {
      u.error = (data && data.error) || 'No pudimos deshacerlo. Revisá la conexión y volvé a intentar.';
      render();
      return;
    }
    u.aviso = { agregada_id: null, texto: `Deshecho: «${esc(hecha ? hecha.agregada.nombre : id)}» vuelve a estar aparte, con sus cargas.` };
    await cargarEscuelasAgregadas();
    await cargarSeguimiento();
  }

  // Solo las que todavía no cargaron: el nombre y la localidad, nada más. Que
  // no tienen cargas ya lo dice el título; repetirlo en cada fila sobraba.
  function tablaFaltan(g) {
    const lista = g.escuelas.filter((e) => !e.docentes);
    return `<section class="t-seg-bloque">
      <h2 class="t-seg-titulo">Departamento ${esc(g.nombre)} <span>${numero(lista.length)} de sus ${numero(g.total)} escuelas todavía no ${plural(lista.length, 'cargó', 'cargaron')}</span></h2>
      <table class="t-seg-tabla t-seg-tabla--faltan">
        <thead><tr><th scope="col">Escuela</th><th scope="col">Localidad</th></tr></thead>
        <tbody>${lista.map((e) => `
          <tr>
            <th scope="row" class="t-seg-escuela"><button type="button" class="t-seg-enlace" data-accion="seg-lugar" data-id="${esc(e.id)}" data-ficha="${esc(e.id)}">${esc(e.nombre)}</button></th>
            <td class="t-seg-localidad">${esc(e.localidad)}</td>
          </tr>`).join('')}</tbody>
      </table>
    </section>`;
  }

  // Un renglón por departamento, en el orden de la nómina: la barra es la
  // parte de sus escuelas que ya cargó
  function tablaDepartamentos(d) {
    const filas = d.grupos.filter((g) => g.total).map((g) => `
        <tr>
          <th scope="row"><button type="button" class="t-seg-enlace" data-accion="seg-lugar" data-id="${esc(g.id)}">${esc(g.nombre)}</button></th>
          <td class="t-seg-avance">
            <div class="t-fila__barra"><div class="t-pista"><div class="t-barra" style="width:${Math.round(100 * g.cargaron / g.total)}%"></div></div><span class="t-seg-de">${numero(g.cargaron)} de ${numero(g.total)}</span></div>
          </td>
          <td class="t-seg-num" data-etiqueta="Docentes">${numero(g.docentes)}</td>
          <td class="t-seg-num" data-etiqueta="Escuelas sin cargas">${g.faltan ? `<strong>${numero(g.faltan)}</strong>` : '—'}</td>
        </tr>`).join('');
    return `<section class="t-seg-bloque">
      <h2 class="t-seg-titulo">Por departamento</h2>
      <table class="t-seg-tabla t-seg-tabla--deptos">
        <thead><tr><th scope="col">Departamento</th><th scope="col">Escuelas que cargaron</th><th scope="col" class="t-seg-num">Docentes</th><th scope="col" class="t-seg-num">Escuelas sin cargas</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </section>`;
  }

  // Una sola lista por departamento: primero las que todavía no cargaron (a
  // las que hay que llamar), después las que ya cargaron. Dentro de cada parte,
  // el orden de la nómina. Al final, las que no son de la nómina.
  function tablaEscuelas(g) {
    const lista = g.escuelas.filter((e) => !e.docentes)
      .concat(g.escuelas.filter((e) => e.docentes), g.extras);
    const resumen = g.total ? `cargaron ${numero(g.cargaron)} de ${numero(g.total)} escuelas${g.faltan ? ` · ${numero(g.faltan)} sin cargas todavía` : ''}` : '';
    const filas = lista.map((e) => `
        <tr class="${e.docentes ? '' : 't-seg-fila--falta'}">
          <th scope="row" class="t-seg-escuela"><button type="button" class="t-seg-enlace" data-accion="seg-lugar" data-id="${esc(e.id)}" data-ficha="${esc(e.id)}">${esc(e.nombre)}</button>${e.extra ? ` <span class="t-seg-extra">(${esc(e.extra)})</span>` : ''}</th>
          <td class="t-seg-localidad">${esc(e.localidad)}</td>
          ${e.docentes
            ? `<td class="t-seg-num" data-etiqueta="Docentes">${numero(e.docentes)}</td>
          <td class="t-seg-num" data-etiqueta="Materias">${numero(e.materias)}</td>
          <td class="t-seg-fecha" data-etiqueta="Último envío">${esc(cuandoFue(e.ultimo))}</td>`
            : '<td class="t-seg-sin" colspan="3">Sin cargas todavía</td>'}
        </tr>`).join('');
    return `<section class="t-seg-bloque">
      <h2 class="t-seg-titulo">${g.id ? `Departamento ${esc(g.nombre)}` : esc(g.nombre)}${resumen ? ` <span>${resumen}</span>` : ''}</h2>
      ${lista.length ? `
      <table class="t-seg-tabla">
        <thead><tr><th scope="col">Escuela</th><th scope="col">Localidad</th><th scope="col" class="t-seg-num">Docentes</th><th scope="col" class="t-seg-num">Materias</th><th scope="col" class="t-seg-fecha">Último envío</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>` : ''}
    </section>`;
  }

  // Una escuela: cuántos docentes cargaron y, materia por materia, cuántas
  // cargas hay. Están todas las materias, también las que no tienen ninguna,
  // para ver qué falta en esa escuela.
  function vistaEscuela(e, g) {
    const donde = [e.localidad, g && g.id ? `departamento ${g.nombre}` : ''].filter(Boolean).join(', ');
    const texto = e.docentes
      ? `En <strong>${esc(e.nombre)}</strong>${donde ? ` (${esc(donde)})` : ''} cargaron <strong>${numero(e.docentes)} ${plural(e.docentes, 'docente', 'docentes')}</strong>: <strong>${numero(e.cargas)} ${plural(e.cargas, 'carga', 'cargas')}</strong> en ${numero(e.materias)} ${plural(e.materias, 'materia', 'materias')}.`
      : `<strong>${esc(e.nombre)}</strong>${donde ? ` (${esc(donde)})` : ''} <strong>todavía no cargó</strong>.`;
    const nombre = (esp) => (Catalogo.esArtistica(esp) ? esp.nombre : Catalogo.nombreCorto(esp));
    const filas = Catalogo.areas().flatMap((a) => Catalogo.espaciosPorArea(a.id)).map((esp) => {
      const m = e.porMateria.get(esp.id);
      return `
        <tr class="${m ? '' : 't-seg-fila--falta'}">
          <th scope="row">${esc(nombre(esp))}</th>
          ${m
            ? `<td class="t-seg-num" data-etiqueta="Cargas">${numero(m.cargas)}</td>
          <td class="t-seg-num" data-etiqueta="Docentes">${numero(m.docentes.size)}</td>
          <td class="t-seg-fecha" data-etiqueta="Último envío">${esc(cuandoFue(m.ultimo))}</td>`
            : '<td class="t-seg-sin" colspan="3">Sin cargas todavía</td>'}
        </tr>`;
    }).join('');
    const volver = g && g.id
      ? `<button type="button" class="t-seg-enlace t-seg-volver" data-accion="seg-lugar" data-id="${esc(g.id)}">← Departamento ${esc(g.nombre)}</button>`
      : '<button type="button" class="t-seg-enlace t-seg-volver" data-accion="seg-lugar" data-id="">← Toda la provincia</button>';
    return `<div class="t-contexto"><div class="t-contexto__texto">${texto}</div>${volver}</div>
      <div class="t-cuerpo t-seg">
        <section class="t-seg-bloque">
          <h2 class="t-seg-titulo">Contacto</h2>
          <div class="t-seg-contacto">
            ${contactosHTML(e.id, false)}
            <button type="button" class="t-seg-enlace" data-accion="abrir-ficha" data-id="${esc(e.id)}">Editar contactos</button>
          </div>
        </section>
        <section class="t-seg-bloque">
          <h2 class="t-seg-titulo">Por materia</h2>
          <table class="t-seg-tabla t-seg-tabla--materias">
            <thead><tr><th scope="col">Materia</th><th scope="col" class="t-seg-num">Cargas</th><th scope="col" class="t-seg-num">Docentes</th><th scope="col" class="t-seg-fecha">Último envío</th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
        </section>
      </div>`;
  }

  /* ---------- Ficha de la escuela: contacto y cargas ---------- */

  // Una escuela de las contadas, con su departamento
  function escuelaSeg(id) {
    const d = estado.seguimiento.datos;
    for (const g of (d ? d.grupos : [])) {
      const e = g.escuelas.concat(g.extras).find((x) => x.id === id);
      if (e) return { escuela: e, grupo: g };
    }
    return null;
  }

  // La sede de un anexo: la E.P.E.S. que lo precede en la nómina, que lo deja
  // seguido de su escuela. En la nómina entera, no dentro del departamento: un
  // anexo puede estar en otro (los diez de la E.P.E.S. N° 39, de Patiño, están
  // en Bermejo), y buscando por departamento quedaban con la N° 25. Coincide
  // con la delegación zonal de la nómina en los 175 anexos, con el CUE en los
  // 59 que comparten el de su sede y con las planillas de directivos en los 37
  // que traen. «E.P.E.S. E.I.B. N° 3 Anexo 11» viene rotulada como E.P.E.S. en
  // la nómina: por eso también cuenta como anexo el que lo dice en el nombre.
  // Si aun así no acierta, el equipo la corrige desde la ficha (sql/14), y
  // esa corrección manda.
  let sedesNomina = null;
  const esAnexo = (e) => /^ANEXO/.test(e.tipo || '') || /\banexo\b/i.test(e.nombre || '');
  const anexoDeLaNomina = (id) => { const e = Catalogo.escuela(id); return !!(e && esAnexo(e)); };
  function sedeDeLaNomina(id) {
    if (!sedesNomina) {
      sedesNomina = new Map();
      let sede = null;
      for (const e of nominaOrdenada()) {
        if (!esAnexo(e)) sede = e;
        else if (sede) sedesNomina.set(e.id, sede);
      }
    }
    return sedesNomina.get(id) || null;
  }
  const nominaOrdenada = () => Catalogo.buscarEscuelas('').grupos.flatMap((g) => g.escuelas)
    .sort((a, b) => (a.orden || 0) - (b.orden || 0));
  const sedeCorregida = (id) => !!(estado.seguimiento.sedes && estado.seguimiento.sedes.has(id));
  function sedeDe(id) {
    if (sedeCorregida(id)) {
      const otra = estado.seguimiento.sedes.get(id);
      return otra ? Catalogo.escuela(otra) : null;
    }
    return sedeDeLaNomina(id);
  }

  // Dónde queda la sede: su localidad, y el departamento si no es el del anexo
  function dondeSede(sede, id) {
    const anexo = Catalogo.escuela(id);
    const dep = Catalogo.departamento(sede.departamento_id);
    return sede.localidad + (dep && (!anexo || anexo.departamento_id !== sede.departamento_id) ? `, departamento ${dep.nombre}` : '');
  }

  // «3704123456» → «370 412-3456»; los enlaces para llamar y por WhatsApp
  // llevan el 54 (y el 9 de celular) adelante
  const celularLegible = (d) => (d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6)}` : d);
  const celularInternacional = (d) => (d.length === 10 ? `54${d}` : d.replace(/^0+/, ''));
  const enlaceWhatsApp = (d) => `https://wa.me/${d.length === 10 ? `549${d}` : d.replace(/^0+/, '')}`;

  // Íconos chicos y grises, como los del editor del catálogo: el contacto se
  // lee primero y las acciones quedan a un costado, sin ocupar un renglón
  const IconoFicha = {
    corregir: svg('<path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>', { tam: 18, color: '#535D71', grosor: 2.2 }),
    quitar: svg('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>', { tam: 18, color: '#535D71', grosor: 2.2 }),
  };

  // Los contactos de una escuela; con «editable», con el lápiz y el tacho al
  // costado de cada uno. Un anexo sin contacto propio muestra el de su sede.
  function contactosHTML(id, editable) {
    const todos = estado.seguimiento.contactos;
    if (!todos) return '<p class="t-ficha__nota">Los contactos de las escuelas todavía no están cargados en la base. Avisale a quien administra el sistema.</p>';
    const f = Ficha.estado;
    const uno = (c, propio) => {
      if (editable && propio && f.editando === c.id) return formularioContacto(c);
      const quien = esc(c.nombre || 'este contacto');
      const acciones = !(editable && propio) ? ''
        : f.quitando === c.id
          ? `<div class="t-ficha__confirmar" role="group" aria-label="Confirmar">¿Quitar a ${quien}?
              <button type="button" class="t-ficha__si" data-ficha-accion="quitar" data-id="${c.id}" ${f.guardando ? 'disabled' : ''}>Quitar</button>
              <button type="button" class="t-ficha__enlace" data-ficha-accion="cancelar">No</button></div>`
          : `<div class="t-ficha__iconos">
              <button type="button" class="t-ficha__icono" data-ficha-accion="corregir" data-id="${c.id}" title="Corregir" aria-label="Corregir a ${quien}">${IconoFicha.corregir}</button>
              <button type="button" class="t-ficha__icono" data-ficha-accion="pedir-quitar" data-id="${c.id}" title="Quitar" aria-label="Quitar a ${quien}">${IconoFicha.quitar}</button>
            </div>`;
      const medios = [
        c.celular ? `<a href="tel:+${esc(celularInternacional(c.celular))}">${esc(celularLegible(c.celular))}</a> · <a href="${esc(enlaceWhatsApp(c.celular))}" target="_blank" rel="noopener">WhatsApp</a>` : '',
        c.correo ? `<a href="mailto:${esc(c.correo)}">${esc(c.correo)}</a>` : '',
      ].filter(Boolean);
      return `<div class="t-ficha__contacto ${f.quitando === c.id && propio ? 't-ficha__contacto--quitando' : ''}">
        <div class="t-ficha__contacto-cabeza">
          <div class="t-ficha__nombre">${esc(c.nombre || 'Sin nombre')}${c.cargo ? ` <span>${esc(c.cargo)}</span>` : ''}</div>
          ${f.quitando === c.id ? '' : acciones}
        </div>
        ${medios.length ? medios.map((m) => `<div class="t-ficha__medio">${m}</div>`).join('') : '<div class="t-ficha__medio t-ficha__medio--falta">Sin celular ni correo</div>'}
        ${f.quitando === c.id ? acciones : ''}
      </div>`;
    };
    const propios = todos.get(id) || [];
    let html = propios.map((c) => uno(c, true)).join('');
    if (!propios.length && f.editando !== 'nuevo') {
      const sede = sedeDe(id);
      const deLaSede = sede ? todos.get(sede.id) || [] : [];
      const nota = editable ? 'No tiene contacto propio. Este es el de su sede:'
        : `No tiene contacto propio. Depende de la <strong>${esc(sede && sede.nombre)}</strong> (${esc(sede && dondeSede(sede, id))}):`;
      html = deLaSede.length
        ? `<p class="t-ficha__nota">${nota}</p>${deLaSede.map((c) => uno(c, false)).join('')}`
        : '<p class="t-ficha__nota">No tiene ningún contacto cargado.</p>';
    }
    if (editable) {
      if (f.editando === 'nuevo') html += formularioContacto(null);
      if (f.error) html += `<p class="t-ficha__error" role="alert">${esc(f.error)}</p>`;
    }
    return html;
  }

  // De qué E.P.E.S. depende un anexo, con «Cambiar» a la derecha del rótulo,
  // como «+ Agregar». Al cambiar, una lista de las E.P.E.S. por departamento.
  function sedeHTML(id) {
    const f = Ficha.estado;
    const puede = !!estado.seguimiento.sedes;
    const sede = sedeDe(id);
    const corregida = sedeCorregida(id);
    if (puede && f.cambiandoSede) {
      const actual = sede ? sede.id : '';
      const opciones = Catalogo.buscarEscuelas('').grupos.map((g) => {
        const epes = g.escuelas.filter((e) => !esAnexo(e) && e.id !== id)
          .sort((a, b) => (a.orden || 0) - (b.orden || 0));
        return epes.length ? `<optgroup label="Departamento ${esc(g.departamento.nombre)}">${epes.map((e) =>
          `<option value="${esc(e.id)}" ${e.id === actual ? 'selected' : ''}>${esc(e.nombre)} · ${esc(e.localidad || '')}</option>`).join('')}</optgroup>` : '';
      }).join('');
      const nomina = sedeDeLaNomina(id);
      const g = f.guardando;
      return `<div class="t-ficha__rotulo-linea"><h3 class="t-ficha__rotulo">Sede</h3></div>
        <form class="t-ficha__form t-ficha__form--sede" data-ficha-sede novalidate aria-label="Cambiar la sede">
          <label class="t-ficha__campo"><span>¿De qué E.P.E.S. depende?</span>
            <select name="sede"><option value="" ${actual ? '' : 'selected'}>De ninguna: tiene dirección propia</option>${opciones}</select></label>
          <div class="t-ficha__form-acciones">
            <button type="submit" class="t-ficha__si" ${g ? 'disabled' : ''}>${g ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" class="t-ficha__enlace" data-ficha-accion="cancelar">Cancelar</button>
            ${corregida && nomina ? `<button type="button" class="t-ficha__enlace" data-ficha-accion="sede-nomina" ${g ? 'disabled' : ''}>Volver a la de la nómina (${esc(nomina.nombre)})</button>` : ''}
          </div>
        </form>
        ${f.errorSede ? `<p class="t-ficha__error" role="alert">${esc(f.errorSede)}</p>` : ''}`;
    }
    const cambiar = puede && f.editando == null && f.quitando == null
      ? `<button type="button" class="t-ficha__enlace" data-ficha-accion="cambiar-sede">Cambiar</button>` : '';
    const texto = sede
      ? `<strong>${esc(sede.nombre)}</strong> · ${esc(dondeSede(sede, id))}`
      : 'No depende de ninguna E.P.E.S.';
    return `<div class="t-ficha__rotulo-linea"><h3 class="t-ficha__rotulo">Sede</h3>${cambiar}</div>
      <p class="t-ficha__nota">${texto}${corregida ? ' <span class="t-ficha__marca">corregida por el equipo</span>' : ''}</p>
      ${f.errorSede ? `<p class="t-ficha__error" role="alert">${esc(f.errorSede)}</p>` : ''}`;
  }

  // El rótulo «Contacto» con «+ Agregar» a la derecha, chico, en vez de un
  // botón más al final de la lista
  function rotuloContacto(editable) {
    const f = Ficha.estado;
    const agregar = editable && estado.seguimiento.contactos && f.editando == null && f.quitando == null && !f.cambiandoSede
      ? '<button type="button" class="t-ficha__enlace" data-ficha-accion="agregar">+ Agregar</button>' : '';
    return `<div class="t-ficha__rotulo-linea"><h3 class="t-ficha__rotulo">Contacto</h3>${agregar}</div>`;
  }

  // Compacto: los cuatro campos de a dos (en el teléfono, uno debajo del otro);
  // «Guardar» chico y «Cancelar» como enlace
  function formularioContacto(c) {
    const v = (k) => esc(c && c[k] ? (k === 'celular' ? celularLegible(c[k]) : c[k]) : '');
    const g = Ficha.estado.guardando;
    return `<form class="t-ficha__form" data-ficha-form="${c ? c.id : 'nuevo'}" novalidate aria-label="${c ? 'Corregir el contacto' : 'Nuevo contacto'}">
      <label class="t-ficha__campo"><span>Nombre y apellido</span><input name="nombre" type="text" value="${v('nombre')}" autocomplete="off"></label>
      <label class="t-ficha__campo"><span>Cargo <em>(opcional)</em></span><input name="cargo" type="text" value="${v('cargo')}" placeholder="Dirección…" autocomplete="off"></label>
      <label class="t-ficha__campo"><span>Celular</span><input name="celular" type="tel" inputmode="tel" value="${v('celular')}" placeholder="3704 123456" autocomplete="off"></label>
      <label class="t-ficha__campo"><span>Correo</span><input name="correo" type="email" inputmode="email" value="${v('correo')}" placeholder="nombre@gmail.com" autocomplete="off"></label>
      <div class="t-ficha__form-acciones">
        <button type="submit" class="t-ficha__si" ${g ? 'disabled' : ''}>${g ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" class="t-ficha__enlace" data-ficha-accion="cancelar">Cancelar</button>
      </div>
    </form>`;
  }

  // Las cargas de la escuela en pocas líneas: lo que se mira al pasar
  function cargasHTML(e) {
    if (!e.docentes) return '<p class="t-ficha__nota"><strong>Todavía no cargó.</strong></p>';
    const materias = Catalogo.areas().flatMap((a) => Catalogo.espaciosPorArea(a.id))
      .filter((esp) => e.porMateria.has(esp.id))
      .map((esp) => `<li>${esc(Catalogo.esArtistica(esp) ? esp.nombre : Catalogo.nombreCorto(esp))} <strong>${numero(e.porMateria.get(esp.id).cargas)}</strong></li>`).join('');
    return `<p class="t-ficha__nota">${numero(e.docentes)} ${plural(e.docentes, 'docente', 'docentes')} · ${numero(e.cargas)} ${plural(e.cargas, 'carga', 'cargas')} en ${numero(e.materias)} ${plural(e.materias, 'materia', 'materias')} · último envío ${esc(cuandoFue(e.ultimo))}</p>
      <ul class="t-ficha__materias">${materias}</ul>`;
  }

  // La ficha vive fuera de #app (el panel se redibuja entero en cada acción y
  // se la llevaría puesta), como el recorrido. Con el mouse aparece al pasar
  // por el nombre y se va al salir; si se entra a ella o se toca algo adentro,
  // queda fija hasta cerrarla. En el teléfono se abre al tocar el nombre, como
  // una hoja desde abajo.
  const Ficha = (() => {
    const caja = document.createElement('div');
    caja.className = 't-ficha';
    caja.setAttribute('role', 'dialog');
    caja.setAttribute('aria-label', 'Contacto y cargas de la escuela');
    caja.hidden = true;
    const velo = document.createElement('div');
    velo.className = 't-ficha-velo';
    velo.hidden = true;
    document.body.append(velo, caja);
    const f = { id: null, fija: false, editando: null, quitando: null, error: null, guardando: false, cambiandoSede: false, errorSede: null };
    let ancla = null;
    let reloj = null;

    function dibujar() {
      const dato = f.id && escuelaSeg(f.id);
      if (!dato) { cerrar(); return; }
      const { escuela: e, grupo: g } = dato;
      const enSuVista = estado.seguimiento.lugar === e.id;
      caja.innerHTML = `
        <div class="t-ficha__cabeza">
          <div>
            <div class="t-ficha__titulo">${esc(e.nombre)}</div>
            <div class="t-ficha__sub">${esc([e.localidad, g && g.id ? `departamento ${g.nombre}` : ''].filter(Boolean).join(' · '))}</div>
          </div>
          <button type="button" class="t-ficha__cerrar" data-ficha-accion="cerrar" aria-label="Cerrar" ${f.fija ? '' : 'hidden'}>${Icono.cerrar}</button>
        </div>
        <div class="t-ficha__cuerpo">
          ${anexoDeLaNomina(e.id) ? `<section>${sedeHTML(e.id)}</section>` : ''}
          <section>${rotuloContacto(true)}${contactosHTML(e.id, true)}</section>
          ${e.agregada ? `<section><h3 class="t-ficha__rotulo">Agregada por un docente</h3>
            <p class="t-ficha__nota">La escribió un docente a mano. Si ya está en la nómina, unificala para que sus cargas sumen ahí.</p>
            <button type="button" class="t-seg-enlace t-ficha__ir" data-ficha-accion="unificar" data-id="${esc(g && g.id ? g.id : '')}">Unificarla con una de la nómina →</button></section>` : ''}
          <section><h3 class="t-ficha__rotulo">Cargas</h3>${cargasHTML(e)}
            ${enSuVista ? '' : `<button type="button" class="t-seg-enlace t-ficha__ir" data-ficha-accion="ir" data-id="${esc(e.id)}">Ver todas sus materias →</button>`}
          </section>
        </div>`;
      caja.classList.toggle('t-ficha--fija', f.fija);
      velo.hidden = !f.fija;
      ubicar();
    }

    // Debajo del nombre (o arriba, si no entra), sin salirse de la pantalla.
    // En el teléfono la ubica el CSS, abajo de todo.
    function ubicar() {
      caja.style.left = caja.style.top = '';
      if (window.matchMedia('(max-width: 899px)').matches || !ancla || !ancla.isConnected) return;
      const r = ancla.getBoundingClientRect();
      const ancho = caja.offsetWidth;
      const alto = caja.offsetHeight;
      const izq = Math.max(16, Math.min(r.left, window.innerWidth - ancho - 16));
      const abajo = window.innerHeight - r.bottom;
      const arriba = abajo < alto + 16 && r.top > abajo ? Math.max(16, r.top - alto - 8) : r.bottom + 8;
      caja.style.left = `${izq + window.scrollX}px`;
      caja.style.top = `${arriba + window.scrollY}px`;
    }

    function abrir(id, el, fija) {
      clearTimeout(reloj);
      const otra = f.id !== id;
      if (otra) Object.assign(f, { editando: null, quitando: null, error: null, guardando: false, cambiandoSede: false, errorSede: null });
      f.id = id;
      f.fija = f.fija && !otra ? true : fija;
      ancla = el;
      caja.hidden = false;
      dibujar();
      if (fija) { const x = caja.querySelector('.t-ficha__cerrar'); if (x) x.focus(); }
    }
    function cerrar() {
      clearTimeout(reloj);
      const habia = f.id && f.fija;
      f.id = null; f.fija = false; f.editando = null; f.quitando = null; f.error = null; f.cambiandoSede = false; f.errorSede = null;
      caja.hidden = true; velo.hidden = true; caja.innerHTML = '';
      if (habia && ancla && ancla.isConnected) ancla.focus();
      ancla = null;
    }
    // Fijarla no la redibuja: si lo hiciera al tomar el foco, el botón que se
    // está tocando desaparecería antes del clic. Solo muestra la cruz, que ya
    // tenía su lugar guardado: si apareciera de la nada, un título largo
    // pasaría a dos renglones y correría hacia abajo lo que se estaba tocando.
    function fijar() {
      if (f.fija || !f.id) return;
      f.fija = true;
      caja.classList.add('t-ficha--fija');
      velo.hidden = false;
      const x = caja.querySelector('.t-ficha__cerrar');
      if (x) x.hidden = false;
    }

    async function guardar(form) {
      const datos = Object.fromEntries(new FormData(form).entries());
      const id = form.dataset.fichaForm === 'nuevo' ? null : Number(form.dataset.fichaForm);
      f.guardando = true; f.error = null; dibujar();
      const { data, error } = await sb.rpc('guardar_contacto', {
        p_id: id, p_escuela_id: f.id, p_nombre: datos.nombre, p_cargo: datos.cargo, p_celular: datos.celular, p_correo: datos.correo,
      });
      f.guardando = false;
      if (error || !data || data.error) {
        f.error = (data && data.error) || 'No pudimos guardar el contacto. Revisá la conexión y volvé a intentar.';
        dibujar();
        return;
      }
      const lista = estado.seguimiento.contactos.get(data.escuela_id) || [];
      const i = lista.findIndex((c) => c.id === data.id);
      if (i >= 0) lista[i] = data; else lista.push(data);
      estado.seguimiento.contactos.set(data.escuela_id, lista);
      f.editando = null;
      despuesDeCambiar();
    }
    async function quitar(id) {
      f.guardando = true; f.error = null; dibujar();
      const { data, error } = await sb.rpc('quitar_contacto', { p_id: id });
      f.guardando = false;
      f.quitando = null;
      if (error || !data || data.error) {
        f.error = (data && data.error) || 'No pudimos quitar el contacto. Revisá la conexión y volvé a intentar.';
        dibujar();
        return;
      }
      const lista = (estado.seguimiento.contactos.get(f.id) || []).filter((c) => c.id !== id);
      estado.seguimiento.contactos.set(f.id, lista);
      despuesDeCambiar();
    }
    // La sede: guardar la elegida (o ninguna), o volver a la de la nómina
    async function guardarSede(form, nomina) {
      const sede = nomina ? null : new FormData(form).get('sede') || null;
      f.guardando = true; f.errorSede = null; dibujar();
      const { data, error } = nomina
        ? await sb.rpc('restaurar_sede', { p_anexo_id: f.id })
        : await sb.rpc('guardar_sede', { p_anexo_id: f.id, p_sede_id: sede });
      f.guardando = false;
      if (error || !data || data.error) {
        f.errorSede = (data && data.error) || 'No pudimos guardar la sede. Revisá la conexión y volvé a intentar.';
        dibujar();
        return;
      }
      if (nomina) estado.seguimiento.sedes.delete(f.id);
      else estado.seguimiento.sedes.set(f.id, data.sede_id || null);
      f.cambiandoSede = false;
      despuesDeCambiar();
    }

    // La vista de la escuela muestra los mismos contactos: se redibuja detrás
    function despuesDeCambiar() {
      const id = f.id;
      if (estado.seguimiento.lugar === id) render();
      f.id = id;
      dibujar();
    }

    caja.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ficha-accion]');
      if (!b) { fijar(); return; }
      const id = b.dataset.id;
      switch (b.dataset.fichaAccion) {
        case 'cerrar': cerrar(); break;
        case 'agregar': f.fija = true; f.editando = 'nuevo'; f.quitando = null; f.error = null; dibujar(); focoPrimerCampo(); break;
        case 'corregir': f.fija = true; f.editando = Number(id); f.quitando = null; f.error = null; dibujar(); focoPrimerCampo(); break;
        case 'pedir-quitar': f.fija = true; f.quitando = Number(id); f.editando = null; f.error = null; dibujar(); break;
        case 'quitar': quitar(Number(id)); break;
        case 'cancelar': f.editando = null; f.quitando = null; f.error = null; f.cambiandoSede = false; f.errorSede = null; dibujar(); break;
        case 'cambiar-sede': f.fija = true; f.cambiandoSede = true; f.editando = null; f.quitando = null; f.errorSede = null; dibujar(); { const c = caja.querySelector('.t-ficha__form--sede select'); if (c) c.focus(); } break;
        case 'sede-nomina': guardarSede(null, true); break;
        case 'unificar': {
          cerrar();
          Object.assign(estado.seguimiento, { lugar: id || null, soloFaltan: false, agregadas: true });
          escribirHashSeguimiento();
          render();
          window.scrollTo(0, 0);
          break;
        }
        case 'ir': {
          cerrar();
          estado.seguimiento.lugar = id;
          escribirHashSeguimiento();
          render();
          window.scrollTo(0, 0);
          break;
        }
        default: break;
      }
    });
    const focoPrimerCampo = () => { const c = caja.querySelector('.t-ficha__form input'); if (c) c.focus(); };
    caja.addEventListener('submit', (e) => { e.preventDefault(); if ('fichaSede' in e.target.dataset) guardarSede(e.target, false); else guardar(e.target); });
    caja.addEventListener('focusin', fijar);
    caja.addEventListener('pointerenter', () => clearTimeout(reloj));
    caja.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !f.fija) reloj = setTimeout(cerrar, 250); });
    velo.addEventListener('click', cerrar);

    // Al pasar el mouse por un nombre: un instante de espera para que recorrer
    // la lista no abra una ficha por fila; si ya hay una abierta, cambia enseguida
    app.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse') return;
      const el = e.target.closest('[data-ficha]');
      if (!el || (f.fija && f.id)) return;
      clearTimeout(reloj);
      reloj = setTimeout(() => abrir(el.dataset.ficha, el, false), f.id ? 60 : 350);
    });
    app.addEventListener('pointerout', (e) => {
      if (e.pointerType !== 'mouse' || f.fija) return;
      const el = e.target.closest('[data-ficha]');
      if (!el || el.contains(e.relatedTarget)) return;
      clearTimeout(reloj);
      reloj = setTimeout(() => { if (!caja.matches(':hover')) cerrar(); }, 250);
    });
    // Con la ficha fija, tocar afuera la cierra
    document.addEventListener('pointerdown', (e) => {
      if (f.fija && f.id && !caja.contains(e.target) && !e.target.closest('[data-ficha], [data-accion="abrir-ficha"]') && e.target !== velo) cerrar();
    });
    window.addEventListener('resize', () => { if (f.id) ubicar(); });

    return { abrir, cerrar, abierta: () => !!f.id, estado: f };
  })();

  /* ---------- Escuelas: editar la nómina (sql/16) ----------

     La nómina de escuelas y departamentos, para corregirla, agregar o dar de
     baja. Se lee de la base, no del archivo: así se ve lo editado aunque no
     esté publicado. Como el catálogo, editar no publica: «Publicar» sube
     escuelas.json al bucket que lee el formulario. */

  const TIPOS_ESCUELA = [
    ['EPES', 'E.P.E.S.'], ['EPES EIB', 'E.P.E.S. E.I.B.'], ['EPES AGRARIA', 'E.P.E.S. Agraria'],
    ['ANEXO RURAL', 'Anexo rural'], ['ANEXO EIB', 'Anexo E.I.B.'], ['ANEXO AGRARIA', 'Anexo agrario'],
    ['ANEXO EPES EIB', 'Anexo de E.P.E.S. E.I.B.'],
  ];
  const nombreTipo = (t) => (TIPOS_ESCUELA.find(([v]) => v === t) || [t, t || '—'])[1];

  function irAEscuelas(dep) {
    estado.pantalla = 'escuelas';
    estado.modo = 'resultados';
    estado.exportar = null;
    Editor.limpiar();
    const s = estado.escuelasEd;
    if (dep !== undefined) s.dep = dep || '';
    Object.assign(s, { editando: null, quitando: null, editandoDepto: null, errorForm: null });
    escribirHashEscuelas();
    render();
    window.scrollTo(0, 0);
    cargarEscuelasEd();
  }

  function escribirHashEscuelas() {
    history.replaceState(null, '', '#' + new URLSearchParams({ escuelas: estado.escuelasEd.dep || '' }).toString());
  }

  const enfocarEscuelaEd = () => { const c = app.querySelector('.t-esc-form input[name="nombre"], .t-esc-depto input'); if (c) c.focus(); };

  async function cargarEscuelasEd({ silencioso = false } = {}) {
    const s = estado.escuelasEd;
    if (!silencioso) { s.cargando = true; s.error = null; render(); }
    const [lista, deptos, pub, sedes] = await Promise.all([
      sb.from('escuelas').select('id, nombre, localidad, departamento_id, tipo, numero, cue, orden, vigente')
        .eq('origen', 'oficial').order('orden', { ascending: true, nullsFirst: false }),
      sb.from('departamentos').select('id, nombre, orden').order('orden', { ascending: true, nullsFirst: false }),
      sb.rpc('estado_escuelas'),
      traerSedes(),
    ]);
    s.cargando = false;
    if (lista.error || deptos.error) {
      const mensaje = (lista.error || deptos.error).message || '';
      s.error = /tipo|orden|cue|does not exist|no existe/i.test(mensaje)
        ? 'Para editar la nómina falta un paso en la base: correr sql/16_editar_escuelas.sql entero en el SQL Editor de Supabase.'
        : 'No pudimos traer la nómina. Revisá la conexión y volvé a intentar.';
      render();
      return;
    }
    s.lista = lista.data || [];
    s.departamentos = deptos.data || [];
    s.publicacion = pub.error ? null : pub.data;
    s.sedes = sedes;
    estado.seguimiento.sedes = sedes;
    render();
  }

  const esAnexoEd = (e) => /^ANEXO/i.test(e.tipo || '') || /\banexo\b/i.test(e.nombre || '');

  // La sede de cada anexo con la nómina de la base (puede tener escuelas que
  // todavía no se publicaron): la E.P.E.S. que lo precede, o la que corrigió
  // el equipo
  function sedesDeLaLista() {
    const s = estado.escuelasEd;
    const porId = new Map(s.lista.map((e) => [e.id, e]));
    const deLaNomina = new Map();
    let sede = null;
    for (const e of s.lista) {
      if (!esAnexoEd(e)) sede = e;
      else if (sede) deLaNomina.set(e.id, sede);
    }
    const sedeDe = (id) => {
      if (s.sedes && s.sedes.has(id)) { const otra = s.sedes.get(id); return otra ? porId.get(otra) || null : null; }
      return deLaNomina.get(id) || null;
    };
    return { sedeDe, deLaNomina: (id) => deLaNomina.get(id) || null, corregida: (id) => !!(s.sedes && s.sedes.has(id)) };
  }

  function barraEscuelas() {
    const s = estado.escuelasEd;
    const deps = s.departamentos || Catalogo.departamentos();
    return `<div class="t-selectores">
      <div class="t-selector t-selector--buscar">
        <label class="t-selector__etiqueta" for="s-esc-buscar">Buscar</label>
        <input class="t-esc-buscar" id="s-esc-buscar" type="search" data-entrada="esc-buscar" value="${esc(s.texto)}" placeholder="Nombre, número, localidad o CUE" autocomplete="off">
      </div>
      <div class="t-selector">
        <label class="t-selector__etiqueta" for="s-esc-dep">Departamento</label>
        <select class="t-select" id="s-esc-dep" data-cambio="esc-dep">
          <option value="">Todos</option>
          ${deps.map((d) => `<option value="${esc(d.id)}" ${s.dep === d.id ? 'selected' : ''}>${esc(d.nombre)}</option>`).join('')}
        </select>
      </div>
      <div class="espaciador"></div>
      <div class="t-selectores__acciones">
        <button type="button" class="t-exportar t-exportar--claro" data-accion="esc-agregar" ${s.lista && !s.editando ? '' : 'disabled'}>+ Agregar una escuela</button>
        <button type="button" class="t-exportar" data-accion="esc-publicar" ${s.lista && !s.publicando ? '' : 'disabled'}>${s.publicando ? 'Publicando…' : 'Publicar'}</button>
      </div>
    </div>`;
  }

  // «Hay 3 cambios sin publicar» o «Todo publicado»: lo que ve el docente
  function lineaPublicacionEscuelas() {
    const p = estado.escuelasEd.publicacion;
    if (!p) return '';
    const pendientes = Number(p.cambios_sin_publicar || 0);
    if (!p.publicado_en) {
      return pendientes
        ? `Hay <strong>${numero(pendientes)} ${plural(pendientes, 'cambio sin publicar', 'cambios sin publicar')}</strong>. Los docentes todavía ven la nómina original: tocá «Publicar» para que vean la corregida.`
        : 'Los docentes ven la nómina original del Ministerio. Lo que corrijas acá les llega cuando toques «Publicar».';
    }
    const cuando = `${cuandoFue(Date.parse(p.publicado_en))}, ${esc(p.publicado_por || 'alguien del equipo')}`;
    return pendientes
      ? `Hay <strong>${numero(pendientes)} ${plural(pendientes, 'cambio sin publicar', 'cambios sin publicar')}</strong>: los docentes ven la versión que se publicó (${cuando}).`
      : `Todo publicado: los docentes ven esta nómina (publicada ${cuando}).`;
  }

  function opcionesTipo(actual) {
    const tipos = TIPOS_ESCUELA.slice();
    if (actual && !tipos.some(([v]) => v === actual)) tipos.push([actual, actual]);
    return tipos.map(([v, t]) => `<option value="${esc(v)}" ${v === actual ? 'selected' : ''}>${esc(t)}</option>`).join('');
  }

  function opcionesDepartamento(actual) {
    return (estado.escuelasEd.departamentos || []).map((d) =>
      `<option value="${esc(d.id)}" ${d.id === actual ? 'selected' : ''}>${esc(d.nombre)}</option>`).join('');
  }

  // Las E.P.E.S. vigentes por departamento, para elegir la sede de un anexo
  function opcionesSedes(elegida, sinElegir) {
    const s = estado.escuelasEd;
    return `${sinElegir}
      ${(s.departamentos || []).map((d) => {
        const epes = s.lista.filter((e) => e.vigente && !esAnexoEd(e) && e.departamento_id === d.id);
        return epes.length ? `<optgroup label="${esc(d.nombre)}">${epes.map((e) =>
          `<option value="${esc(e.id)}" ${e.id === elegida ? 'selected' : ''}>${esc(e.nombre)}${e.localidad ? ` · ${esc(e.localidad)}` : ''}</option>`).join('')}</optgroup>` : '';
      }).join('')}`;
  }

  // Corregir una escuela, o agregar una (e = null)
  function formularioEscuela(e) {
    const s = estado.escuelasEd;
    const v = (k) => esc(e && e[k] != null ? e[k] : '');
    const g = s.guardando;
    const sedes = sedesDeLaLista();
    let sede = '';
    if (!e) {
      sede = `<label class="t-ficha__campo t-esc-form__ancho"><span>Si es un anexo, ¿de qué E.P.E.S. depende? <em>(queda en la nómina después de ella y de sus anexos)</em></span>
        <select name="sede">${opcionesSedes('', '<option value="">No es un anexo: va al final de su departamento</option>')}</select></label>`;
    } else if (esAnexoEd(e) && s.sedes) {
      const actual = sedes.sedeDe(e.id);
      const nomina = sedes.deLaNomina(e.id);
      const elegida = !sedes.corregida(e.id) ? '' : actual ? actual.id : '-';
      sede = `<label class="t-ficha__campo t-esc-form__ancho"><span>¿De qué E.P.E.S. depende?</span>
        <select name="sede">${opcionesSedes(elegida, `<option value="" ${elegida === '' ? 'selected' : ''}>La de la nómina${nomina ? ` (${esc(nomina.nombre)})` : ''}</option>
          <option value="-" ${elegida === '-' ? 'selected' : ''}>De ninguna: tiene dirección propia</option>`)}</select></label>`;
    }
    return `<form class="t-ficha__form t-esc-form" data-form="esc-escuela" data-id="${e ? esc(e.id) : ''}" novalidate aria-label="${e ? 'Corregir la escuela' : 'Agregar una escuela'}">
      <label class="t-ficha__campo t-esc-form__ancho"><span>Nombre</span><input name="nombre" type="text" value="${v('nombre')}" placeholder="E.P.E.S. N° 41 · Anexo de Educación Rural – El Corralito" autocomplete="off"></label>
      <label class="t-ficha__campo"><span>Tipo</span><select name="tipo">${opcionesTipo(e ? e.tipo : 'EPES')}</select></label>
      <label class="t-ficha__campo"><span>Número <em>(si tiene)</em></span><input name="numero" type="text" inputmode="numeric" value="${v('numero')}" autocomplete="off"></label>
      <label class="t-ficha__campo"><span>CUE <em>(9 números)</em></span><input name="cue" type="text" inputmode="numeric" value="${v('cue')}" autocomplete="off"></label>
      <label class="t-ficha__campo"><span>Localidad</span><input name="localidad" type="text" value="${v('localidad')}" autocomplete="off"></label>
      <label class="t-ficha__campo"><span>Departamento</span><select name="departamento">${opcionesDepartamento(e ? e.departamento_id : (s.dep || ((s.departamentos || [])[0] || {}).id))}</select></label>
      ${sede}
      ${s.errorForm ? `<p class="t-ficha__error t-esc-form__ancho" role="alert">${esc(s.errorForm)}</p>` : ''}
      <div class="t-ficha__form-acciones">
        <button type="submit" class="t-ficha__si" ${g ? 'disabled' : ''}>${g ? 'Guardando…' : e ? 'Guardar' : 'Agregar'}</button>
        <button type="button" class="t-ficha__enlace" data-accion="esc-cancelar">Cancelar</button>
        ${e ? '' : '<span class="t-unif__editar-nota">El id se arma con el nombre y no cambia más.</span>'}
      </div>
    </form>`;
  }

  // Coincide si cada palabra buscada empieza alguna palabra de la escuela, en
  // cualquier orden. Por palabra entera y no por pedazo: si no, «41» daría
  // todas las que tienen 41 en el medio del CUE. La sigla entra con y sin
  // puntos, como en el buscador del docente («epes 41» y «e.p.e.s. 41»).
  function coincideEscuela(e, texto) {
    const palabras = normalizarTexto(texto).split(' ').filter(Boolean);
    if (!palabras.length) return true;
    const sinPuntos = e.nombre.replace(/\b((?:[A-Za-z]\.){2,})/g, (m) => m.replace(/\./g, ''));
    const suyas = normalizarTexto(`${e.nombre} ${sinPuntos} ${e.localidad || ''} ${e.numero || ''} ${e.cue || ''} ${nombreTipo(e.tipo)}`).split(' ');
    return palabras.every((p) => suyas.some((w) => w.startsWith(p)));
  }

  function tablaDepartamentosEd() {
    const s = estado.escuelasEd;
    const filas = s.departamentos.map((d) => {
      const cuantas = s.lista.filter((e) => e.vigente && e.departamento_id === d.id).length;
      if (s.editandoDepto === d.id) {
        return `<tr><td colspan="3"><form class="t-esc-depto" data-form="esc-depto" data-id="${esc(d.id)}" novalidate aria-label="Renombrar el departamento">
          <label class="t-ficha__campo"><span>Nombre del departamento</span><input name="nombre" type="text" value="${esc(d.nombre)}" autocomplete="off"></label>
          <button type="submit" class="t-ficha__si" ${s.guardando ? 'disabled' : ''}>Guardar</button>
          <button type="button" class="t-ficha__enlace" data-accion="esc-cancelar">Cancelar</button>
          ${s.errorForm ? `<p class="t-ficha__error" role="alert">${esc(s.errorForm)}</p>` : ''}
        </form></td></tr>`;
      }
      return `<tr>
        <th scope="row" class="t-seg-escuela"><button type="button" class="t-seg-enlace" data-accion="esc-ver-dep" data-id="${esc(d.id)}">${esc(d.nombre)}</button></th>
        <td class="t-seg-num" data-etiqueta="Escuelas">${numero(cuantas)}</td>
        <td class="t-esc-acciones">${s.editando || s.editandoDepto ? '' : `<button type="button" class="t-ficha__icono" data-accion="esc-editar-dep" data-id="${esc(d.id)}" title="Renombrar" aria-label="Renombrar el departamento ${esc(d.nombre)}">${IconoFicha.corregir}</button>`}</td>
      </tr>`;
    }).join('');
    return `<section class="t-seg-bloque">
      <h2 class="t-seg-titulo">Departamentos <span>${numero(s.departamentos.length)}</span></h2>
      <table class="t-seg-tabla t-esc-deptos">
        <thead><tr><th scope="col">Departamento</th><th scope="col" class="t-seg-num">Escuelas</th><th scope="col"><span class="visualmente-oculto">Acciones</span></th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </section>`;
  }

  function filaEscuela(e, sedes) {
    const s = estado.escuelasEd;
    if (s.editando === e.id) return `<tr class="t-esc-fila--editando"><td colspan="6">${formularioEscuela(e)}</td></tr>`;
    const sede = esAnexoEd(e) ? sedes.sedeDe(e.id) : null;
    const libre = !s.editando && !s.quitando && !s.editandoDepto;
    const acciones = !e.vigente
      ? `<button type="button" class="t-ficha__enlace" data-accion="esc-restaurar" data-id="${esc(e.id)}" ${s.guardando ? 'disabled' : ''}>Restaurar</button>`
      : libre ? `<button type="button" class="t-ficha__icono" data-accion="esc-editar" data-id="${esc(e.id)}" title="Corregir" aria-label="Corregir ${esc(e.nombre)}">${IconoFicha.corregir}</button>
          <button type="button" class="t-ficha__icono" data-accion="esc-pedir-baja" data-id="${esc(e.id)}" title="Dar de baja" aria-label="Dar de baja ${esc(e.nombre)}">${IconoFicha.quitar}</button>` : '';
    const fila = `<tr class="${e.vigente ? '' : 't-esc-fila--baja'}">
      <th scope="row" class="t-seg-escuela">${esc(e.nombre)}${e.vigente ? '' : ' <span class="t-seg-extra">(dada de baja)</span>'}
        <button type="button" class="t-seg-enlace t-esc-contacto" data-accion="esc-contacto" data-id="${esc(e.id)}">Contacto y cargas →</button></th>
      <td data-etiqueta="Tipo">${esc(nombreTipo(e.tipo))}</td>
      <td class="t-seg-localidad" data-etiqueta="Localidad">${esc(e.localidad || '')}</td>
      <td class="t-esc-cue" data-etiqueta="CUE">${esc(e.cue || '')}</td>
      ${esAnexoEd(e) ? `<td data-etiqueta="Depende de">${sede ? esc(sede.nombre) : 'De ninguna'}${sedes.corregida(e.id) ? ' <span class="t-ficha__marca">corregida</span>' : ''}</td>` : '<td></td>'}
      <td class="t-esc-acciones">${acciones}</td>
    </tr>`;
    if (s.quitando !== e.id) return fila;
    return `${fila}<tr class="t-esc-fila--editando"><td colspan="6"><div class="t-ficha__confirmar">¿Dar de baja «${esc(e.nombre)}»? Deja de ofrecerse a los docentes cuando publiques; sus cargas se conservan.
      <button type="button" class="t-ficha__si" data-accion="esc-baja" data-id="${esc(e.id)}" ${s.guardando ? 'disabled' : ''}>Dar de baja</button>
      <button type="button" class="t-ficha__enlace" data-accion="esc-cancelar">No</button></div></td></tr>`;
  }

  function tablaEscuelasEd(d, lista, sedes) {
    return `<section class="t-seg-bloque">
      <h2 class="t-seg-titulo">Departamento ${esc(d.nombre)} <span>${numero(lista.length)} ${plural(lista.length, 'escuela', 'escuelas')}</span></h2>
      <table class="t-seg-tabla t-esc-tabla">
        <thead><tr><th scope="col">Escuela</th><th scope="col">Tipo</th><th scope="col">Localidad</th><th scope="col">CUE</th><th scope="col">Depende de</th><th scope="col"><span class="visualmente-oculto">Acciones</span></th></tr></thead>
        <tbody>${lista.map((e) => filaEscuela(e, sedes)).join('')}</tbody>
      </table>
    </section>`;
  }

  function pantallaEscuelas() {
    const s = estado.escuelasEd;
    let contenido;
    if (s.cargando && !s.lista) {
      contenido = '<div class="t-cuerpo"><div class="t-estado"><div class="t-estado__texto">Trayendo la nómina…</div></div></div>';
    } else if (s.error) {
      contenido = `<div class="t-cuerpo"><div class="t-estado"><div class="t-estado__titulo">No se puede editar la nómina todavía</div><div class="t-estado__texto">${esc(s.error)}</div><button type="button" class="boton boton--primario boton--66" data-accion="esc-reintentar">Volver a intentar</button></div></div>`;
    } else if (s.lista) {
      const sedes = sedesDeLaLista();
      const deps = s.departamentos.filter((d) => !s.dep || d.id === s.dep);
      const visibles = (d, vigente) => s.lista.filter((e) => e.departamento_id === d.id && e.vigente === vigente && coincideEscuela(e, s.texto));
      const bloques = deps.map((d) => ({ d, lista: visibles(d, true) })).filter((b) => b.lista.length);
      const bajas = deps.flatMap((d) => visibles(d, false));
      const total = bloques.reduce((n, b) => n + b.lista.length, 0);
      contenido = `<div class="t-contexto"><div class="t-contexto__texto">${s.texto || s.dep
          ? `${numero(total)} ${plural(total, 'escuela', 'escuelas')}${s.texto ? ` con «${esc(s.texto)}»` : ''}${s.dep ? ` en el departamento ${esc((s.departamentos.find((d) => d.id === s.dep) || {}).nombre || '')}` : ''}.`
          : `La nómina tiene <strong>${numero(s.lista.filter((e) => e.vigente).length)} escuelas</strong> en ${numero(s.departamentos.length)} departamentos.`}
        <span class="t-esc-publicacion">${lineaPublicacionEscuelas()}</span></div></div>
        <div class="t-cuerpo t-seg">
          ${s.aviso ? `<p class="t-unif-aviso" role="status"><span>${s.aviso.texto}</span>${s.aviso.deshacer ? `<button type="button" class="t-ficha__enlace" data-accion="esc-restaurar" data-id="${esc(s.aviso.deshacer)}">Deshacer</button>` : ''}</p>` : ''}
          ${s.errorAccion ? `<p class="t-ficha__error" role="alert">${esc(s.errorAccion)}</p>` : ''}
          ${s.editando === 'nuevo' ? `<section class="t-seg-bloque"><h2 class="t-seg-titulo">Agregar una escuela</h2>${formularioEscuela(null)}</section>` : ''}
          ${s.dep || s.texto ? '' : tablaDepartamentosEd()}
          ${bloques.map((b) => tablaEscuelasEd(b.d, b.lista, sedes)).join('') || '<p class="t-seg-vacia">No hay ninguna escuela que coincida con la búsqueda.</p>'}
          ${bajas.length ? `<section class="t-seg-bloque">
            <button type="button" class="t-seg-enlace" data-accion="esc-ver-bajas" aria-expanded="${s.verBajas}">${s.verBajas ? 'Ocultar' : 'Ver'} las dadas de baja (${numero(bajas.length)})</button>
            ${s.verBajas ? `<table class="t-seg-tabla t-esc-tabla"><tbody>${bajas.map((e) => filaEscuela(e, sedes)).join('')}</tbody></table>` : ''}
          </section>` : ''}
        </div>`;
    } else {
      contenido = '';
    }
    return `<div class="tablero">
      ${cabecera()}
      ${barraEscuelas()}
      <div class="t-seg-marco">${contenido}</div>
    </div>`;
  }

  // Cada cambio se guarda y se vuelve a leer la nómina: así la pantalla
  // muestra lo que quedó en la base (y cuántos cambios hay sin publicar)
  async function guardarEscuelaEd(form) {
    const s = estado.escuelasEd;
    const datos = Object.fromEntries(new FormData(form).entries());
    const id = form.dataset.id || null;
    const actual = id ? s.lista.find((e) => e.id === id) : null;
    s.guardando = true; s.errorForm = null; render();
    const { data, error } = await sb.rpc('guardar_escuela', {
      p_id: id, p_nombre: datos.nombre, p_localidad: datos.localidad, p_departamento_id: datos.departamento,
      p_tipo: datos.tipo, p_numero: datos.numero, p_cue: datos.cue, p_despues_de: !id && datos.sede ? datos.sede : null,
    });
    if (error || !data || data.error) {
      s.guardando = false;
      s.errorForm = (data && data.error) || 'No pudimos guardar. Revisá la conexión y volvé a intentar.';
      render();
      return;
    }
    // La sede de un anexo se guarda aparte (sql/14)
    if (actual && esAnexoEd(actual) && 'sede' in datos && s.sedes) {
      const sedes = sedesDeLaLista();
      const antes = !sedes.corregida(id) ? '' : (sedes.sedeDe(id) || { id: '-' }).id;
      if (datos.sede !== antes) {
        const r = datos.sede === ''
          ? await sb.rpc('restaurar_sede', { p_anexo_id: id })
          : await sb.rpc('guardar_sede', { p_anexo_id: id, p_sede_id: datos.sede === '-' ? null : datos.sede });
        if (r.error || (r.data && r.data.error)) {
          s.guardando = false;
          s.errorForm = (r.data && r.data.error) || 'Se guardó la escuela, pero no de qué E.P.E.S. depende. Volvé a intentar.';
          render();
          return;
        }
      }
    }
    s.guardando = false;
    s.editando = null;
    s.aviso = { texto: `${id ? 'Guardado' : 'Agregada'}: «${esc(data.nombre)}». Tocá «Publicar» para que lo vean los docentes.` };
    await cargarEscuelasEd({ silencioso: true });
  }

  async function guardarDepartamentoEd(form) {
    const s = estado.escuelasEd;
    const nombre = new FormData(form).get('nombre');
    s.guardando = true; s.errorForm = null; render();
    const { data, error } = await sb.rpc('guardar_departamento', { p_id: form.dataset.id, p_nombre: nombre });
    s.guardando = false;
    if (error || !data || data.error) {
      s.errorForm = (data && data.error) || 'No pudimos guardar. Revisá la conexión y volvé a intentar.';
      render();
      return;
    }
    s.editandoDepto = null;
    s.aviso = { texto: `Ahora se llama «${esc(data.nombre)}». Tocá «Publicar» para que lo vean los docentes.` };
    await cargarEscuelasEd({ silencioso: true });
  }

  async function vigenciaEscuelaEd(id, vigente) {
    const s = estado.escuelasEd;
    const e = s.lista.find((x) => x.id === id) || { nombre: id };
    s.guardando = true; s.errorAccion = null; render();
    const { data, error } = await sb.rpc('cambiar_vigencia_escuela', { p_id: id, p_vigente: vigente });
    s.guardando = false;
    s.quitando = null;
    if (error || !data || data.error) {
      s.errorAccion = (data && data.error) || 'No pudimos hacerlo. Revisá la conexión y volvé a intentar.';
      render();
      return;
    }
    const cargas = Number(data.cargas || 0);
    s.aviso = vigente
      ? { texto: `«${esc(e.nombre)}» vuelve a estar en la nómina. Tocá «Publicar» para que se ofrezca de nuevo a los docentes.` }
      : { texto: `«${esc(e.nombre)}» quedó dada de baja${cargas ? ` (sus ${numero(cargas)} ${plural(cargas, 'carga se conserva', 'cargas se conservan')})` : ''}. Deja de ofrecerse cuando toques «Publicar».`, deshacer: id };
    await cargarEscuelasEd({ silencioso: true });
  }

  // Sube escuelas.json al bucket que lee el formulario, como el catálogo
  async function publicarEscuelas() {
    const s = estado.escuelasEd;
    s.publicando = true; s.errorAccion = null; s.aviso = null; render();
    try {
      const { data, error } = await sb.rpc('exportar_escuelas');
      if (error || (data && data.error)) throw new Error((data && data.error) || error.message);
      if (!data.escuelas || !data.escuelas.length || !data.departamentos || !data.departamentos.length) throw new Error('la nómina vendría vacía');
      const cuerpo = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const subida = await sb.storage.from('catalogo').upload('escuelas.json', cuerpo, {
        upsert: true, contentType: 'application/json', cacheControl: '300',
      });
      if (subida && subida.error) throw new Error(subida.error.message);
      await sb.rpc('registrar_publicacion_escuelas', { p_escuelas: data.escuelas.length });
      Catalogo.reemplazarEscuelas(data);
      s.publicando = false;
      s.aviso = { texto: `Publicado: ${numero(data.escuelas.length)} escuelas en ${numero(data.departamentos.length)} departamentos. Los docentes que entren de ahora en más ven esta nómina (tarda hasta cinco minutos en llegarles).` };
      await cargarEscuelasEd({ silencioso: true });
    } catch (e) {
      s.publicando = false;
      s.errorAccion = `No pudimos publicar: ${(e && e.message) || 'error desconocido'}. Volvé a intentar.`;
      render();
    }
  }

  function pantallaSeguimiento() {
    const s = estado.seguimiento;
    let contenido = '';
    if (s.cargando) {
      contenido = '<div class="t-cuerpo"><div class="t-estado"><div class="t-estado__texto">Contando las cargas de cada escuela…</div></div></div>';
    } else if (s.error) {
      contenido = `<div class="t-cuerpo"><div class="t-estado"><div class="t-estado__titulo">No pudimos contar las cargas</div><div class="t-estado__texto">${esc(s.error)}</div><button type="button" class="boton boton--primario boton--66" data-accion="seg-reintentar">Volver a intentar</button></div></div>`;
    } else if (s.datos) {
      const d = s.datos;
      // El lugar elegido: un departamento, una escuela o, si no es ninguno, la provincia
      const g = s.lugar ? d.grupos.find((x) => x.id === s.lugar) : null;
      let escuela = null;
      let suGrupo = null;
      if (s.lugar && !g) {
        for (const x of d.grupos) {
          escuela = x.escuelas.concat(x.extras).find((e) => e.id === s.lugar) || null;
          if (escuela) { suGrupo = x; break; }
        }
      }
      // El grupo «Sin departamento» (por si una escuela llega sin él) solo tiene agregadas
      const grupos = (g ? [g] : d.grupos).filter((x) => x.total || x.extras.length);
      contenido = `<div class="t-seg-marco">
        ${escuela ? vistaEscuela(escuela, suGrupo) : `${contextoSeguimiento(d, g)}
        <div class="t-cuerpo t-seg">
          ${s.agregadas ? vistaAgregadas(grupos, g) : s.soloFaltan
            ? (grupos.filter((x) => x.faltan).map(tablaFaltan).join('')
              || `<p class="t-seg-vacia">Ya cargaron todas las escuelas${g ? ` del departamento ${esc(g.nombre)}` : ''}.</p>`)
            : `${g ? '' : tablaDepartamentos(d)}${grupos.map(tablaEscuelas).join('')}`}
        </div>`}
      </div>`;
    }
    return `<div class="tablero">
      ${cabecera()}
      ${barraSeguimiento()}
      ${contenido}
      ${panelExportar()}
    </div>`;
  }

  function pantallaCargando() {
    return `<div class="tablero">${cabecera()}<div class="t-estado"><div class="t-estado__texto">Cargando…</div></div></div>`;
  }

  // Movimiento: el panel se redibuja entero en cada acción, así que cada
  // animación corre solo si hay algo nuevo: otra sección, otros datos u otra
  // vista, un panel que recién se abre. Con «reducir movimiento», nada (CSS).
  const previo = { seccion: null, datos: null, vista: null, editor: null, seguimiento: null };

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
    // En el seguimiento, al llegar las cuentas y al cambiar de departamento;
    // abrir la ventana del Excel no hace parpadear la lista
    const seg = estado.seguimiento;
    const vistaSeg = estado.pantalla === 'seguimiento' && seg.datos ? [seg.datos, seg.lugar, seg.soloFaltan] : null;
    if (vistaSeg && !(previo.seguimiento && vistaSeg.every((v, i) => v === previo.seguimiento[i]))) {
      const cuerpo = app.querySelector('.t-seg');
      if (cuerpo) {
        cuerpo.classList.add('t-entra');
        app.querySelectorAll('.t-barra').forEach((b) => b.classList.add('t-barra--crece'));
      }
    }
    previo.seguimiento = vistaSeg;
    if (!habiaPanel) app.querySelectorAll('.t-panel, .t-velo').forEach((el) => el.classList.add('t-panel--entra'));
    previo.seccion = seccion;
  }

  function render() {
    const fn = { ingreso: pantallaIngreso, 'sin-permiso': pantallaSinPermiso, inicio: pantallaInicio, panel: pantallaPanel, seguimiento: pantallaSeguimiento, escuelas: pantallaEscuelas }[estado.pantalla] || pantallaCargando;
    const habiaPanel = !!app.querySelector('.t-panel');
    app.innerHTML = fn();
    if (estado.pantalla !== 'seguimiento' && Ficha.abierta()) Ficha.cerrar();
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

  // En el teléfono, tocar el nombre de una escuela abre su ficha; con el mouse
  // o el teclado lleva a su detalle, porque la ficha ya se ve al pasar
  let conElDedo = false;
  document.addEventListener('pointerdown', (e) => { conElDedo = e.pointerType === 'touch' || e.pointerType === 'pen'; }, true);
  document.addEventListener('keydown', () => { conElDedo = false; }, true);

  app.addEventListener('click', (e) => {
    const objetivo = e.target.closest('[data-accion]');
    if (!objetivo) return;
    const d = objetivo.dataset;
    if (d.ficha && conElDedo) { Ficha.abrir(d.ficha, objetivo, true); return; }
    if (d.accion === 'abrir-ficha') { Ficha.abrir(d.id, objetivo, true); return; }
    if (d.accion.startsWith('ed-') || d.accion.startsWith('ar-')) { Editor.manejar(d.accion, d, objetivo); return; }
    switch (d.accion) {
      case 'salir': salir(); break;
      case 'reintentar-permiso': estado.pantalla = 'cargando'; render(); verificarSesion(); break;
      case 'reintentar': cargarDatos(); break;
      case 'tour': Tour.iniciar(estado.modo === 'catalogo' ? 'catalogo' : 'resultados'); break;
      case 'ir-inicio': irAlInicio(); break;
      case 'ir-resultados': irAlPanel('resultados'); break;
      case 'ir-catalogo': irAlPanel('catalogo'); break;
      case 'ir-seguimiento': irAlSeguimiento(); break;
      case 'ir-escuelas': irAEscuelas(); break;
      case 'esc-reintentar': cargarEscuelasEd(); break;
      case 'esc-agregar': Object.assign(estado.escuelasEd, { editando: 'nuevo', quitando: null, editandoDepto: null, errorForm: null, aviso: null }); render(); enfocarEscuelaEd(); break;
      case 'esc-editar': Object.assign(estado.escuelasEd, { editando: d.id, quitando: null, editandoDepto: null, errorForm: null, aviso: null }); render(); enfocarEscuelaEd(); break;
      case 'esc-editar-dep': Object.assign(estado.escuelasEd, { editandoDepto: d.id, editando: null, quitando: null, errorForm: null, aviso: null }); render(); enfocarEscuelaEd(); break;
      case 'esc-pedir-baja': Object.assign(estado.escuelasEd, { quitando: d.id, editando: null, editandoDepto: null, aviso: null }); render(); break;
      case 'esc-cancelar': Object.assign(estado.escuelasEd, { editando: null, quitando: null, editandoDepto: null, errorForm: null }); render(); break;
      case 'esc-baja': vigenciaEscuelaEd(d.id, false); break;
      case 'esc-restaurar': vigenciaEscuelaEd(d.id, true); break;
      case 'esc-publicar': publicarEscuelas(); break;
      case 'esc-ver-bajas': estado.escuelasEd.verBajas = !estado.escuelasEd.verBajas; render(); break;
      case 'esc-ver-dep': estado.escuelasEd.dep = d.id; escribirHashEscuelas(); render(); window.scrollTo(0, 0); break;
      case 'esc-contacto': irAlSeguimiento(d.id); break;
      case 'seg-reintentar': cargarSeguimiento(); break;
      case 'seg-solo': {
        const s = estado.seguimiento;
        const solo = d.solo === '1';
        const agregadas = d.solo === 'agregadas';
        if (s.soloFaltan !== solo || s.agregadas !== agregadas) {
          s.soloFaltan = solo; s.agregadas = agregadas;
          Object.assign(estado.unificar, { confirmando: null, editando: null, error: null, aviso: null });
          escribirHashSeguimiento(); render();
        }
        break;
      }
      case 'unif-pedir': {
        const u = estado.unificar;
        const sel = app.querySelector(`select[data-cambio="unif-destino"][data-id="${CSS.escape(d.id)}"]`);
        const destino = sel ? sel.value : '';
        u.aviso = null;
        if (!destino) { u.error = 'Elegí en la lista con qué escuela se unifica.'; render(); break; }
        u.error = null; u.elegidas.set(d.id, destino); u.confirmando = { id: d.id, destino };
        render();
        break;
      }
      case 'unif-cancelar': Object.assign(estado.unificar, { confirmando: null, editando: null, error: null }); render(); break;
      case 'unif-editar': {
        Object.assign(estado.unificar, { editando: d.id, confirmando: null, error: null, aviso: null });
        render();
        const campo = app.querySelector('.t-unif__editar input[name="nombre"]');
        if (campo) { campo.focus(); campo.select(); }
        break;
      }
      case 'unif-confirmar': unificar(); break;
      case 'unif-deshacer': deshacerUnificacion(d.id); break;
      case 'seg-lugar':
        Ficha.cerrar();
        estado.seguimiento.lugar = d.id || null;
        escribirHashSeguimiento();
        render();
        window.scrollTo(0, 0);
        break;
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
      case 'abrir-control': estado.exportar = { que: 'control', progreso: null, error: null, descargando: false }; render(); break;
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
      case 'unif-destino': estado.unificar.elegidas.set(el.dataset.id, el.value); break;
      case 'esc-dep':
        Object.assign(estado.escuelasEd, { dep: el.value, editando: null, quitando: null, editandoDepto: null });
        escribirHashEscuelas();
        render();
        break;
      case 'seg-lugar':
        Ficha.cerrar();
        estado.seguimiento.lugar = el.value || null;
        escribirHashSeguimiento();
        render();
        break;
      case 'ex-que': if (estado.exportar) { estado.exportar.que = el.value; estado.exportar.error = null; render(); } break;
      case 'ex-formato': if (estado.exportar) { estado.exportar.formato = el.value; estado.exportar.error = null; render(); } break;
      case 'ex-vista': if (estado.exportar) { estado.exportar.vista = el.value; estado.exportar.error = null; render(); } break;
      default: break;
    }
  });

  // Buscar en la nómina mientras se escribe: se redibuja y el cursor vuelve a su lugar
  app.addEventListener('input', (e) => {
    const el = e.target.closest('[data-entrada="esc-buscar"]');
    if (!el) return;
    const pos = el.selectionStart;
    estado.escuelasEd.texto = el.value;
    render();
    const nuevo = document.getElementById('s-esc-buscar');
    if (nuevo) { nuevo.focus(); try { nuevo.setSelectionRange(pos, pos); } catch (x) { /* type=search */ } }
  });

  app.addEventListener('submit', (e) => {
    const escuela = e.target.closest('[data-form="esc-escuela"]');
    if (escuela) { e.preventDefault(); guardarEscuelaEd(escuela); return; }
    const depto = e.target.closest('[data-form="esc-depto"]');
    if (depto) { e.preventDefault(); guardarDepartamentoEd(depto); return; }
    const correccion = e.target.closest('[data-form="unif-editar"]');
    if (correccion) { e.preventDefault(); editarAgregada(correccion); return; }
    const form = e.target.closest('[data-form="ingreso"]');
    if (!form) return;
    e.preventDefault();
    const email = form.email.value.trim();
    const clave = form.clave.value;
    if (!email || !clave) { estado.ingreso.error = 'Escribí tu correo y tu contraseña para entrar.'; estado.ingreso.email = email; render(); return; }
    ingresar(email, clave);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && Ficha.abierta()) { Ficha.cerrar(); return; }
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
