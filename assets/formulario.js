/* ============================================================================
   Formulario del docente — flujo completo, sin framework.

   Una pantalla por decisión. Todo el borrador vive en el navegador
   (localStorage) y nada se escribe en Supabase hasta que el docente confirma.
   ============================================================================ */

(function () {
  'use strict';

  const CLAVE_BORRADOR = 'relevamiento.borrador.v1';
  const RUTA_LOGO_MINISTERIO = 'assets/img/logo-ministerio.webp';
  const RUTA_LOGO_SECUNDARIA = 'assets/img/logo-secundaria.webp';

  const app = document.getElementById('app');
  const esEscritorio = () => window.matchMedia('(min-width: 1024px)').matches;

  const ORDINAL = { 1: '1er', 2: '2do', 3: '3er' };
  const TRIMESTRE_TITULO = { 1: 'Primer trimestre', 2: 'Segundo trimestre', 3: 'Tercer trimestre' };
  const TRIMESTRE_CORTO = { 1: '1er trimestre', 2: '2do trimestre', 3: '3er trimestre' };
  const TRIMESTRE_PALABRA = { 1: 'primer', 2: 'segundo', 3: 'tercer' };
  const TOTAL_PASOS = 6;

  // Pantallas en las que hay una carga a medio hacer que vale la pena retomar
  const PANTALLAS_EN_CURSO = new Set(['nombre', 'escuela', 'escuela-manual', 'anio', 'area', 'espacio', 'tramo', 'saber', 'resumen', 'sin-saberes']);

  /* ======================================================================
     Íconos (trazo, 24×24)
     ====================================================================== */

  const svg = (contenido, { tam = 22, color = '#0B4F4A', grosor = 2.4, extra = '' } = {}) =>
    `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${grosor}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${contenido}</svg>`;

  const Icono = {
    chevron: (o) => svg('<path d="M9 5l7 7-7 7"/>', o),
    volver: svg('<path d="M15 5l-7 7 7 7"/>', { tam: 20 }),
    check: (o) => svg('<path d="M20 6L9 17l-5-5"/>', o),
    mas: (o) => svg('<path d="M12 5v14"/><path d="M5 12h14"/>', Object.assign({ color: '#5C665F', grosor: 2.2 }, o)),
    lupa: (o) => svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4.2-4.2"/>', Object.assign({ color: '#5C665F', grosor: 2.2 }, o)),
    cerrar: (o) => svg('<path d="M6 6l12 12"/><path d="M18 6L6 18"/>', Object.assign({ tam: 20, color: '#3B453F' }, o)),
    flecha: (o) => svg('<path d="M5 12h13"/><path d="M12 5l7 7-7 7"/>', Object.assign({ color: '#FFFFFF' }, o)),
    menos: (o) => svg('<path d="M5 12h14"/>', Object.assign({ tam: 20, color: '#5C665F', grosor: 2.6 }, o)),
    escuela: svg('<path d="M3 10.5L12 5l9 5.5"/><path d="M5.5 12v7h13v-7"/><path d="M9.5 19v-4h5v4"/>', { tam: 20, grosor: 2, extra: ' style="flex-shrink:0"' }),
    reloj: (o) => svg('<circle cx="12" cy="12" r="9"/><path d="M12 6.8v5.4l3.4 2"/>', Object.assign({ tam: 23, grosor: 2 }, o)),
    llave: (o) => svg('<circle cx="8.6" cy="15.4" r="3.4"/><path d="M11 13L18.5 5.5"/><path d="M15.6 8.4l2.2 2.2"/><path d="M3.5 3.5l17 17"/>', Object.assign({ tam: 23, grosor: 2 }, o)),
    wifi: (o) => svg('<path d="M4.4 9.2a13 13 0 0 1 15.2 0"/><path d="M7.8 13.1a8.4 8.4 0 0 1 8.4 0"/><circle cx="12" cy="17.8" r="1.3"/><path d="M3.5 3.5l17 17"/>', Object.assign({ tam: 23, grosor: 2 }, o)),
  };

  const checkChico = Icono.check({ tam: 16, color: '#5C665F', grosor: 2.6 });

  /* ======================================================================
     Utilidades
     ====================================================================== */

  function esc(texto) {
    return String(texto == null ? '' : texto)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const plural = (n, uno, varios) => (n === 1 ? uno : varios);

  // Resalta las palabras buscadas dentro del texto original, respetando acentos y puntuación.
  function resaltar(texto, tokens) {
    if (!tokens || !tokens.length) return esc(texto);
    const mapa = [];
    let norm = '';
    for (let i = 0; i < texto.length; i++) {
      const n = texto[i].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ' ');
      for (const ch of n) { norm += ch; mapa.push(i); }
    }
    const rangos = [];
    for (const t of tokens) {
      if (!t) continue;
      let desde = 0;
      let pos;
      while ((pos = norm.indexOf(t, desde)) !== -1) {
        rangos.push([mapa[pos], mapa[pos + t.length - 1] + 1]);
        desde = pos + t.length;
      }
    }
    if (!rangos.length) return esc(texto);
    rangos.sort((a, b) => a[0] - b[0]);
    const unidos = [];
    for (const r of rangos) {
      const u = unidos[unidos.length - 1];
      if (u && r[0] <= u[1]) u[1] = Math.max(u[1], r[1]);
      else unidos.push(r.slice());
    }
    let salida = '';
    let cursor = 0;
    for (const [a, b] of unidos) {
      salida += esc(texto.slice(cursor, a)) + '<mark class="coincidencia">' + esc(texto.slice(a, b)) + '</mark>';
      cursor = b;
    }
    return salida + esc(texto.slice(cursor));
  }

  function resaltarFuerte(texto, tokens) {
    return resaltar(texto, tokens).replace(/<mark class="coincidencia">/g, '<strong>').replace(/<\/mark>/g, '</strong>');
  }

  /* ======================================================================
     Estado y borrador
     ====================================================================== */

  // Identifica a la persona en este dispositivo: agrupa sus materias bajo un solo
  // docente y hace que reenviar la misma materia reemplace el envío anterior.
  function generarClave() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  const estadoInicial = () => ({
    pantalla: 'bienvenida',
    clave: generarClave(),
    nombre: '',
    apellido: '',
    escuela: null,          // { id } | { manual: { nombre, departamento_id, localidad } }
    anio: null,
    area_id: null,
    espacio_id: null,
    tramo: 1,
    indice: 0,
    saberes: {},            // saber_id → { contenidos: [{ tipo, contenido_sugerido_id, texto }], noTrabajado }
    saberesDe: null,        // «espacio|año» al que pertenecen los saberes cargados
    volverA: null,          // 'resumen' | { tramo, indice } cuando se edita un saber puntual
    resumenDesde: null,     // { tramo } cuando se abrió «Ver lo que cargué hasta acá» a mitad de camino
    ultimoEnvio: null,      // lo que se muestra en la confirmación
    historial: [],          // aportes enviados en esta sesión
  });

  let estado = estadoInicial();

  // Estado de interfaz que no se guarda
  const ui = {
    pantallaReanudar: null,
    consultaEscuela: '',
    departamentoElegido: null,
    manual: { nombre: '', departamento_id: '', localidad: '' },
    textoContenido: '',
    sugerenciaActiva: -1,
    hojaAbierta: false,
    enviando: false,
    errorEnvio: null,
    errorAnio: null,
    espacioPendiente: null,
    errores: {},
  };

  function guardar() {
    try { localStorage.setItem(CLAVE_BORRADOR, JSON.stringify(estado)); } catch (e) { /* sin espacio o modo privado: seguimos igual */ }
  }
  function leerBorrador() {
    try {
      const crudo = localStorage.getItem(CLAVE_BORRADOR);
      if (!crudo) return null;
      const b = JSON.parse(crudo);
      return b && typeof b === 'object' ? b : null;
    } catch (e) { return null; }
  }
  function borrarBorrador() {
    try { localStorage.removeItem(CLAVE_BORRADOR); } catch (e) { /* nada */ }
  }

  /* ======================================================================
     Derivados del estado
     ====================================================================== */

  const espacioActual = () => (estado.espacio_id ? Catalogo.espacio(estado.espacio_id) : null);
  const areaActual = () => (estado.area_id ? Catalogo.area(estado.area_id) : null);
  const tramosActuales = () => Catalogo.saberesPorTramo(estado.espacio_id, estado.anio);
  const saberActual = () => (tramosActuales()[estado.tramo] || [])[estado.indice] || null;
  const registro = (saberId) => estado.saberes[saberId] || { contenidos: [], noTrabajado: false };
  const estaResuelto = (saberId) => { const r = registro(saberId); return r.noTrabajado || r.contenidos.length > 0; };

  function tramoNoVacioDesde(t) {
    const tr = tramosActuales();
    for (let k = t; k <= 3; k++) if (tr[k].length) return k;
    return null;
  }
  function tramoNoVacioAntes(t) {
    const tr = tramosActuales();
    for (let k = t - 1; k >= 1; k--) if (tr[k].length) return k;
    return null;
  }
  function totalSaberes() {
    const tr = tramosActuales();
    return tr[1].length + tr[2].length + tr[3].length;
  }
  function contarContenidos(saberes) {
    return saberes.reduce((n, s) => n + registro(s.id).contenidos.length, 0);
  }
  function saberesPendientes() {
    const tr = tramosActuales();
    const pendientes = [];
    for (const t of [1, 2, 3]) tr[t].forEach((s, i) => { if (!estaResuelto(s.id)) pendientes.push({ saber: s, tramo: t, indice: i }); });
    return pendientes;
  }

  // «E.P.E.S. N° 41 “Dr. Miguel Salvador Pereyra”» o la que escribió el docente
  function nombreEscuela({ corto = false } = {}) {
    const e = estado.escuela;
    if (!e) return '';
    if (e.manual) return e.manual.nombre;
    const esc_ = Catalogo.escuela(e.id);
    if (!esc_) return '';
    return corto ? `E.P.E.S. N° ${esc_.numero}` : nombreEscuelaOficial(esc_);
  }
  function nombreEscuelaOficial(e) {
    return `E.P.E.S. N° ${e.numero}` + (e.denominacion ? ` “${e.denominacion}”` : '');
  }
  const textoAnio = (a) => `${a}° año`;
  const etiquetaTramo = (t) => `${nombreEspacioCorto().toUpperCase()} · ${estado.anio}° AÑO · ${ORDINAL[t]} TRIMESTRE`;
  const nombreEspacioCorto = () => { const e = espacioActual(); return e ? Catalogo.nombreCorto(e) : ''; };

  // «E.P.E.S. N° 41 · Matemática · 1° año», con lo que ya se sabe
  function textoContexto() {
    const partes = [];
    if (estado.escuela) partes.push(nombreEscuela({ corto: true }));
    if (estado.espacio_id) partes.push(nombreEspacioCorto());
    if (estado.anio) partes.push(textoAnio(estado.anio));
    return partes.join(' · ');
  }

  /* ======================================================================
     Navegación
     ====================================================================== */

  function ir(pantalla) {
    estado.pantalla = pantalla;
    ui.hojaAbierta = false;
    ui.sugerenciaActiva = -1;
    ui.textoContenido = '';
    ui.errorEnvio = null;
    guardar();
    render();
    window.scrollTo(0, 0);
  }

  function irAEleccionDeEspacio() {
    const esp = estado.area_id ? Catalogo.espaciosPorArea(estado.area_id) : [];
    ir(esp.length > 1 ? 'espacio' : 'area');
  }

  function volver() {
    if (ui.hojaAbierta) { ui.hojaAbierta = false; render(); return; }
    const tr = estado.espacio_id ? tramosActuales() : null;
    switch (estado.pantalla) {
      case 'nombre': ir('bienvenida'); break;
      case 'escuela': ir('nombre'); break;
      case 'escuela-manual': ir('escuela'); break;
      case 'anio':
        ui.errorAnio = null;
        ui.espacioPendiente = null;
        ir(estado.escuela && estado.escuela.manual ? 'escuela-manual' : 'escuela');
        break;
      case 'area': ir('anio'); break;
      case 'espacio': ir('area'); break;
      case 'sin-saberes': irAEleccionDeEspacio(); break;
      case 'tramo': {
        const previo = tramoNoVacioAntes(estado.tramo);
        if (previo) { estado.tramo = previo; estado.indice = tr[previo].length - 1; ir('saber'); }
        else irAEleccionDeEspacio();
        break;
      }
      case 'saber':
        if (estado.volverA === 'resumen') { estado.volverA = null; ir('resumen'); }
        else if (estado.volverA && typeof estado.volverA === 'object') {
          estado.tramo = estado.volverA.tramo; estado.indice = estado.volverA.indice; estado.volverA = null; ir('saber');
        }
        else if (estado.indice > 0) { estado.indice -= 1; ir('saber'); }
        else ir('tramo');
        break;
      case 'resumen': {
        if (estado.resumenDesde) {
          estado.tramo = estado.resumenDesde.tramo;
          estado.indice = 0;
          estado.resumenDesde = null;
          ir('tramo');
          break;
        }
        const ultimo = tramoNoVacioAntes(4);
        if (ultimo) { estado.tramo = ultimo; estado.indice = tr[ultimo].length - 1; ir('saber'); }
        else irAEleccionDeEspacio();
        break;
      }
      default: break;
    }
  }

  // El botón «atrás» del navegador hace lo mismo que «Volver»
  history.replaceState({ ancla: true }, '');
  history.pushState({ app: true }, '');
  window.addEventListener('popstate', () => {
    if (estado.pantalla === 'bienvenida' || estado.pantalla === 'gracias') { history.back(); return; }
    volver();
    history.pushState({ app: true }, '');
  });

  /* ======================================================================
     Acciones del flujo
     ====================================================================== */

  function comenzar() {
    if (ui.pantallaReanudar) {
      // Empieza de cero: descarta el borrador anterior
      estado = estadoInicial();
      ui.pantallaReanudar = null;
    }
    ir('nombre');
  }

  function reanudar() {
    const destino = ui.pantallaReanudar || 'nombre';
    ui.pantallaReanudar = null;
    ir(destino);
  }

  function continuarNombre() {
    estado.nombre = estado.nombre.trim();
    estado.apellido = estado.apellido.trim();
    if (!estado.nombre || !estado.apellido) {
      ui.errores.nombre = !estado.nombre;
      ui.errores.apellido = !estado.apellido;
      render();
      const campo = document.getElementById(!estado.nombre ? 'nombre' : 'apellido');
      if (campo) campo.focus();
      return;
    }
    ui.errores = {};
    ir('escuela');
  }

  function elegirEscuela(id) {
    estado.escuela = { id };
    ui.consultaEscuela = '';
    ui.departamentoElegido = null;
    ir('anio');
  }

  function continuarEscuelaManual() {
    const m = ui.manual;
    m.nombre = m.nombre.trim();
    m.localidad = m.localidad.trim();
    ui.errores = {};
    if (!m.nombre) ui.errores.manualNombre = true;
    if (!m.departamento_id) ui.errores.manualDepartamento = true;
    if (Object.keys(ui.errores).length) { render(); return; }
    estado.escuela = { manual: { nombre: m.nombre, departamento_id: m.departamento_id, localidad: m.localidad } };
    ir('anio');
  }

  function elegirAnio(anio) {
    estado.anio = anio;
    ui.errorAnio = null;
    if (ui.espacioPendiente) {
      const pendiente = ui.espacioPendiente;
      ui.espacioPendiente = null;
      elegirEspacio(pendiente);
      return;
    }
    ir('area');
  }

  function elegirArea(areaId) {
    estado.area_id = areaId;
    const espacios = Catalogo.espaciosPorArea(areaId);
    if (espacios.length === 1) elegirEspacio(espacios[0].id);
    else ir('espacio');
  }

  function elegirEspacio(espacioId) {
    const esp = Catalogo.espacio(espacioId);
    if (!esp) return;
    if (!esp.anios_dictados.includes(estado.anio)) {
      // Educación Tecnológica solo se dicta en 1° y 2°: se explica y se vuelve al año
      const anios = esp.anios_dictados.map((a) => `${a}°`).join(' y ');
      ui.errorAnio = `${Catalogo.nombreCorto(esp)} se dicta solo en ${anios} año. Elegí uno de esos, o volvé y elegí otra materia.`;
      ui.espacioPendiente = espacioId;
      estado.area_id = esp.area_id;
      ir('anio');
      return;
    }
    // Materia o año nuevos: se descarta lo cargado para otra combinación, si quedó algo
    const claveSaberes = `${espacioId}|${estado.anio}`;
    if (estado.saberesDe !== claveSaberes) { estado.saberes = {}; estado.saberesDe = claveSaberes; }
    estado.espacio_id = espacioId;
    estado.volverA = null;
    const primero = tramoNoVacioDesde(1);
    if (!primero) { ir('sin-saberes'); return; }
    estado.tramo = primero;
    estado.indice = 0;
    ir('tramo');
  }

  function comenzarTramo() {
    estado.indice = 0;
    ir('saber');
  }

  function siguienteSaber() {
    const s = saberActual();
    if (!s || !estaResuelto(s.id)) return;
    if (estado.volverA === 'resumen') { estado.volverA = null; ir('resumen'); return; }
    if (estado.volverA && typeof estado.volverA === 'object') {
      estado.tramo = estado.volverA.tramo; estado.indice = estado.volverA.indice; estado.volverA = null; ir('saber'); return;
    }
    const tr = tramosActuales();
    if (estado.indice + 1 < tr[estado.tramo].length) { estado.indice += 1; ir('saber'); return; }
    const proximo = tramoNoVacioDesde(estado.tramo + 1);
    if (proximo) { estado.tramo = proximo; estado.indice = 0; ir('tramo'); return; }
    estado.resumenDesde = null;
    ir('resumen');
  }

  function agregarContenido({ contenido, textoLibre }) {
    const s = saberActual();
    if (!s) return;
    const reg = estado.saberes[s.id] || { contenidos: [], noTrabajado: false };
    let nuevo;
    if (contenido) nuevo = { tipo: 'catalogo', contenido_sugerido_id: contenido.id, texto: contenido.texto };
    else {
      const texto = (textoLibre || '').trim();
      if (!texto) return;
      // Si lo que escribió coincide exactamente con uno del catálogo, se guarda como del catálogo
      const { exacta } = Catalogo.sugerencias(s.id, texto);
      nuevo = exacta
        ? { tipo: 'catalogo', contenido_sugerido_id: exacta.id, texto: exacta.texto }
        : { tipo: 'libre', contenido_sugerido_id: null, texto };
    }
    const tn = normalizarTexto(nuevo.texto);
    if (!tn) return;
    if (!reg.contenidos.some((c) => normalizarTexto(c.texto) === tn)) reg.contenidos.push(nuevo);
    reg.noTrabajado = false;
    estado.saberes[s.id] = reg;
    ui.textoContenido = '';
    ui.sugerenciaActiva = -1;
    guardar();
    render();
    if (esEscritorio()) { const campo = document.getElementById('contenido'); if (campo) campo.focus(); }
  }

  function quitarContenido(posicion) {
    const s = saberActual();
    if (!s) return;
    const reg = estado.saberes[s.id];
    if (!reg) return;
    reg.contenidos.splice(posicion, 1);
    guardar();
    render();
  }

  function confirmarNoTrabajado() {
    const s = saberActual();
    if (!s) return;
    estado.saberes[s.id] = { contenidos: [], noTrabajado: true };
    ui.hojaAbierta = false;
    guardar();
    siguienteSaber();
  }

  function editarSaber(tramo, indice, volverA) {
    estado.volverA = volverA;
    estado.tramo = tramo;
    estado.indice = indice;
    ir('saber');
  }

  function seguirCargando() {
    const p = saberesPendientes()[0];
    if (!p) { ir('resumen'); return; }
    estado.volverA = null;
    estado.resumenDesde = null;
    estado.tramo = p.tramo;
    estado.indice = p.indice;
    ir(p.indice === 0 && !tramoResueltoParcialmente(p.tramo) ? 'tramo' : 'saber');
  }
  function tramoResueltoParcialmente(t) {
    return tramosActuales()[t].some((s) => estaResuelto(s.id));
  }

  function armarPayload() {
    const tr = tramosActuales();
    const selecciones = [];
    const noTrabajados = [];
    for (const t of [1, 2, 3]) {
      for (const s of tr[t]) {
        const reg = estado.saberes[s.id];
        if (!reg) continue;
        if (reg.noTrabajado) { noTrabajados.push(s.id); continue; }
        reg.contenidos.forEach((c, i) => selecciones.push({
          saber_id: s.id,
          tipo: c.tipo,
          contenido_sugerido_id: c.tipo === 'catalogo' ? c.contenido_sugerido_id : null,
          texto: c.texto,
          texto_normalizado: normalizarTexto(c.texto),
          orden: i + 1,
        }));
      }
    }
    const escuela = estado.escuela.manual
      ? { nombre: estado.escuela.manual.nombre, departamento_id: estado.escuela.manual.departamento_id, localidad: estado.escuela.manual.localidad }
      : { id: estado.escuela.id };
    return {
      docente: { nombre: estado.nombre, apellido: estado.apellido, clave: estado.clave || undefined },
      escuela,
      espacio_id: estado.espacio_id,
      anio: estado.anio,
      selecciones,
      saberes_no_trabajados: noTrabajados,
    };
  }

  async function confirmarYEnviar() {
    if (ui.enviando) return;
    if (saberesPendientes().length) { seguirCargando(); return; }
    ui.enviando = true;
    ui.errorEnvio = null;
    render();
    const resultado = await Envio.enviarAporte(armarPayload());
    ui.enviando = false;
    if (!resultado.ok) {
      // '22023' es una validación de registrar_aporte: el mensaje ya está escrito para el docente
      ui.errorEnvio = resultado.codigo === '22023' && resultado.mensaje
        ? resultado.mensaje
        : 'No pudimos enviar tu carga. Revisá la conexión y volvé a intentar: lo cargado sigue guardado en este dispositivo.';
      render();
      return;
    }
    estado.ultimoEnvio = {
      espacio: nombreEspacioCorto(),
      anio: estado.anio,
      escuela: nombreEscuela(),
      escuelaCorta: nombreEscuela({ corto: true }),
      saberes: totalSaberes(),
      prueba: Boolean(resultado.prueba),
      demo: Boolean(resultado.demo),
    };
    estado.historial.push({ espacio_id: estado.espacio_id, anio: estado.anio, enviado_en: new Date().toISOString() });
    // Queda listo para otra materia: se conservan nombre, apellido y escuela
    estado.anio = null;
    estado.area_id = null;
    estado.espacio_id = null;
    estado.tramo = 1;
    estado.indice = 0;
    estado.saberes = {};
    estado.saberesDe = null;
    estado.volverA = null;
    ir('confirmacion');
  }

  function otraMateriaMismaEscuela() { ir('anio'); }
  function otraMateriaOtraEscuela() { estado.escuela = null; ir('escuela'); }
  function terminar() {
    borrarBorrador();
    estado = estadoInicial();
    estado.pantalla = 'gracias';
    render();
    window.scrollTo(0, 0);
  }

  /* ======================================================================
     Piezas compartidas
     ====================================================================== */

  function cabecera() {
    return `<header class="cabecera">
      <div class="cabecera__marca">
        <img class="cabecera__logo" src="${RUTA_LOGO_MINISTERIO}" alt="Ministerio de Cultura y Educación — Provincia de Formosa">
        <div class="cabecera__separador"></div>
        <img class="cabecera__logo cabecera__logo--secundaria" src="${RUTA_LOGO_SECUNDARIA}" alt="Dirección de Educación Secundaria">
      </div>
      <div class="cabecera__rotulo">Relevamiento curricular</div>
      <div class="cabecera__contexto">${esc(textoContexto())}</div>
    </header>`;
  }

  function subcabecera(paso, { conVolver = true } = {}) {
    return `<div class="subcabecera">
      ${conVolver ? `<button type="button" class="volver" data-accion="volver">${Icono.volver}Volver</button>` : '<span></span>'}
      <div class="paso">${esc(paso)}</div>
    </div>`;
  }

  const notaGuardado = (texto) => `<div class="nota-guardado">${checkChico}<span>${esc(texto)}</span></div>`;

  function pantalla(clase, contenido) {
    return `<div class="pantalla ${clase}">${contenido}</div>`;
  }

  /* ======================================================================
     1 · Bienvenida
     ====================================================================== */

  function pantallaBienvenida() {
    const reanudar = ui.pantallaReanudar
      ? `<button type="button" class="boton boton--enlace" data-accion="reanudar">Seguir con lo que había cargado</button>`
      : '';
    return pantalla('pantalla--bienvenida', `
      <section class="bienvenida__hero">
        <div class="bienvenida__logos">
          <img src="${RUTA_LOGO_MINISTERIO}" alt="Ministerio de Cultura y Educación — Provincia de Formosa">
          <div class="cabecera__separador"></div>
          <img class="logo--secundaria" src="${RUTA_LOGO_SECUNDARIA}" alt="Dirección de Educación Secundaria">
        </div>
        <div class="columna columna--12">
          <div class="etiqueta bienvenida__etiqueta">Educación Secundaria · Resolución 672</div>
          <h1 class="bienvenida__titulo">Contanos qué contenidos trabajás</h1>
          <p class="bajada bienvenida__bajada">
            <span class="solo-movil">Un relevamiento del Ministerio para conocer qué se enseña en cada escuela de la provincia y acompañar mejor a los equipos.</span>
            <span class="solo-escritorio">Un relevamiento provincial para conocer qué se enseña en cada escuela y acompañar mejor a los equipos docentes.</span>
          </p>
        </div>
        <div class="espaciador solo-escritorio"></div>
        <div class="bienvenida__items bienvenida__items--hero solo-escritorio">
          <div class="bienvenida__item">${Icono.reloj({ tam: 24, color: '#9FC8BD' })}<div>Unos 10 minutos por materia</div></div>
          <div class="bienvenida__item">${Icono.llave({ tam: 24, color: '#9FC8BD' })}<div>Sin usuario ni contraseña</div></div>
          <div class="bienvenida__item">${Icono.wifi({ tam: 24, color: '#9FC8BD' })}<div>Si se corta internet, no se pierde nada</div></div>
        </div>
      </section>
      <section class="cuerpo bienvenida__cuerpo">
        <div class="bienvenida__items bienvenida__items--cuerpo solo-movil">
          <div class="bienvenida__item"><div class="bienvenida__icono">${Icono.reloj()}</div><div>Son unos <strong>10 minutos</strong> por materia.</div></div>
          <div class="bienvenida__item"><div class="bienvenida__icono">${Icono.llave()}</div><div>No hace falta usuario ni contraseña.</div></div>
          <div class="bienvenida__item"><div class="bienvenida__icono">${Icono.wifi()}</div><div>Si se corta internet, no perdés lo cargado.</div></div>
        </div>
        <div class="espaciador solo-movil"></div>
        <div class="columna columna--14 solo-movil">
          <button type="button" class="boton boton--primario" data-accion="comenzar">Comenzar</button>
          ${reanudar}
          <div class="ayuda ayuda--14 ayuda--centrada">No se usa para evaluar tu trabajo ni el de tu escuela.</div>
        </div>
        <div class="bienvenida__panel solo-escritorio">
          <h2>Antes de empezar</h2>
          <div class="columna columna--14">
            <p class="bajada">Vas a elegir tu escuela, el año y tu espacio curricular. Después recorrés los saberes del diseño curricular de a uno.</p>
            <p class="bajada">En cada saber marcás qué contenidos trabajás. El trimestre ya viene asignado: no lo elegís vos.</p>
          </div>
          <div class="linea-separadora"></div>
          <button type="button" class="boton boton--primario" data-accion="comenzar">Comenzar</button>
          ${reanudar}
          <div class="ayuda ayuda--centrada">No se usa para evaluar tu trabajo ni el de tu escuela.</div>
        </div>
      </section>
    `);
  }

  /* ======================================================================
     2 · Nombre y apellido
     ====================================================================== */

  function pantallaNombre() {
    const error = (ui.errores.nombre || ui.errores.apellido)
      ? `<div class="error-campo" role="alert">Escribí tu nombre y tu apellido para seguir.</div>` : '';
    return pantalla('pantalla--centrada', `
      ${cabecera()}
      ${subcabecera(`Paso 1 de ${TOTAL_PASOS}`)}
      <div class="cuerpo" style="gap:26px;padding-top:10px">
        <div class="columna columna--10">
          <h1 class="titulo">¿Cómo te llamás?</h1>
          <p class="bajada">Lo pedimos una sola vez. Si después cargás otra materia, no te lo volvemos a preguntar.</p>
        </div>
        <form class="columna columna--20" data-form="nombre" novalidate>
          <div class="campo">
            <label class="campo__etiqueta" for="nombre">Nombre</label>
            <input class="entrada" id="nombre" name="nombre" type="text" autocomplete="given-name" autocapitalize="words" value="${esc(estado.nombre)}" ${ui.errores.nombre ? 'aria-invalid="true"' : ''}>
          </div>
          <div class="campo">
            <label class="campo__etiqueta" for="apellido">Apellido</label>
            <input class="entrada" id="apellido" name="apellido" type="text" autocomplete="family-name" autocapitalize="words" value="${esc(estado.apellido)}" ${ui.errores.apellido ? 'aria-invalid="true"' : ''}>
          </div>
          ${error}
          <button type="submit" class="oculto-visual">Continuar</button>
        </form>
        <div class="espaciador"></div>
        <button type="button" class="boton boton--primario" data-accion="continuar-nombre">Continuar</button>
      </div>
    `);
  }

  /* ======================================================================
     3 · Escuela
     ====================================================================== */

  function tarjetaEscuela(e, tokens) {
    return `<button type="button" class="opcion opcion--escuela" data-accion="elegir-escuela" data-id="${esc(e.id)}">
      <div class="opcion__textos">
        <div class="opcion__titulo">${resaltar(nombreEscuelaOficial(e), tokens)}</div>
        <div class="opcion__sub opcion__sub--15">${resaltar(e.localidad || '', tokens)}</div>
      </div>
      ${Icono.chevron({ extra: ' style="flex-shrink:0"' })}
    </button>`;
  }

  function resultadosEscuela() {
    const buscando = ui.consultaEscuela.trim() !== '' || ui.departamentoElegido;
    if (!buscando) {
      const chips = Catalogo.departamentos().map((d) =>
        `<button type="button" class="chip-boton" data-accion="elegir-departamento" data-id="${esc(d.id)}">${esc(d.nombre)}</button>`).join('');
      return `
        <div class="ayuda">Escribí dos o tres letras y la lista se achica sola.</div>
        <div class="columna columna--12">
          <div class="campo__etiqueta">O buscá por departamento</div>
          <div class="grilla-2">${chips}</div>
        </div>`;
    }
    const { grupos, total, tokens } = Catalogo.buscarEscuelas(ui.consultaEscuela, ui.departamentoElegido);
    const conteo = total === 0
      ? `Ninguna escuela coincide con “${esc(ui.consultaEscuela.trim())}”.`
      : `${total} ${plural(total, 'escuela encontrada', 'escuelas encontradas')}`;
    const lista = grupos.map((g) => `
      <div class="etiqueta etiqueta--ladrillo resultados__departamento">Departamento ${esc(g.departamento.nombre)}</div>
      ${g.escuelas.map((e) => tarjetaEscuela(e, tokens)).join('')}`).join('');
    return `
      <div class="contador-resultados">${conteo}</div>
      <div class="resultados">${lista}</div>
      <div class="aviso">Si escribís el barrio o la localidad también aparece: probá con <strong>Mbiguá</strong> o <strong>Clorinda</strong>.</div>`;
  }

  function pantallaEscuela() {
    const buscando = ui.consultaEscuela.trim() !== '' || ui.departamentoElegido;
    return pantalla('pantalla--centrada', `
      ${cabecera()}
      ${subcabecera(`Paso 2 de ${TOTAL_PASOS}`)}
      <div class="cuerpo" style="gap:20px;padding-bottom:24px">
        ${buscando ? '' : '<h1 class="titulo">¿En qué escuela?</h1>'}
        <div class="campo campo--10">
          <label class="campo__etiqueta" for="buscar-escuela">Buscá por número o por nombre</label>
          <div class="entrada-icono ${buscando ? 'entrada-icono--activa entrada-icono--con-borrar' : ''}">
            ${Icono.lupa(buscando ? { color: '#0B4F4A' } : {})}
            <input class="entrada-icono__input ${buscando ? 'entrada-icono__input--activa' : ''}" id="buscar-escuela" type="search" placeholder="41, Mbiguá, Clorinda…" autocomplete="off" autocorrect="off" value="${esc(ui.consultaEscuela)}">
            ${buscando ? `<button type="button" class="boton-icono boton-icono--relleno" data-accion="borrar-busqueda" aria-label="Borrar la búsqueda">${Icono.cerrar()}</button>` : ''}
          </div>
        </div>
        <div id="resultados-escuela" class="columna columna--18">${resultadosEscuela()}</div>
        <div class="espaciador"></div>
        <button type="button" class="boton boton--enlace" data-accion="escuela-manual">No encuentro mi escuela</button>
      </div>
    `);
  }

  function pantallaEscuelaManual() {
    const m = ui.manual;
    const opciones = Catalogo.departamentos().map((d) =>
      `<option value="${esc(d.id)}" ${m.departamento_id === d.id ? 'selected' : ''}>${esc(d.nombre)}</option>`).join('');
    return pantalla('pantalla--centrada', `
      ${cabecera()}
      ${subcabecera(`Paso 2 de ${TOTAL_PASOS}`)}
      <div class="cuerpo" style="gap:22px;padding-bottom:24px">
        <div class="columna columna--10">
          <h1 class="titulo titulo--28">Escribila vos</h1>
          <p class="bajada">La revisamos y la sumamos a la lista. Podés seguir sin problema.</p>
        </div>
        <form class="columna columna--18" data-form="escuela-manual" novalidate>
          <div class="campo">
            <label class="campo__etiqueta" for="nombre-escuela">Nombre o número de la escuela</label>
            <input class="entrada" id="nombre-escuela" name="nombre" type="text" value="${esc(m.nombre)}" ${ui.errores.manualNombre ? 'aria-invalid="true"' : ''}>
            ${ui.errores.manualNombre ? '<div class="error-campo" role="alert">Escribí cómo se llama la escuela, o su número.</div>' : ''}
          </div>
          <div class="campo">
            <label class="campo__etiqueta" for="departamento">Departamento</label>
            <select class="entrada entrada--select" id="departamento" name="departamento_id" ${ui.errores.manualDepartamento ? 'aria-invalid="true"' : ''}>
              <option value="" ${m.departamento_id ? '' : 'selected'}>Elegí uno</option>
              ${opciones}
            </select>
            ${ui.errores.manualDepartamento ? '<div class="error-campo" role="alert">Elegí el departamento donde está la escuela.</div>' : ''}
          </div>
          <div class="campo">
            <label class="campo__etiqueta" for="localidad">Localidad o barrio</label>
            <input class="entrada" id="localidad" name="localidad" type="text" value="${esc(m.localidad)}">
          </div>
          <button type="submit" class="oculto-visual">Continuar</button>
        </form>
        <div class="espaciador"></div>
        <div class="columna columna--12">
          <button type="button" class="boton boton--primario" data-accion="continuar-escuela-manual">Continuar</button>
          <button type="button" class="boton boton--enlace" data-accion="volver-a-buscar">Volver a buscarla en la lista</button>
        </div>
      </div>
    `);
  }

  /* ======================================================================
     4 · Año
     ====================================================================== */

  function pantallaAnio() {
    const opciones = [1, 2, 3].map((a) => `
      <button type="button" class="opcion-anio" data-accion="elegir-anio" data-anio="${a}">
        <div class="opcion-anio__numero">${a}°</div>
        <div class="opcion-anio__texto">año</div>
        ${Icono.chevron()}
      </button>`).join('');
    const aviso = ui.errorAnio ? `<div class="aviso aviso--error" role="alert">${esc(ui.errorAnio)}</div>` : '';
    return pantalla('pantalla--centrada', `
      ${cabecera()}
      ${subcabecera(`Paso 3 de ${TOTAL_PASOS}`)}
      <div class="cuerpo" style="gap:20px">
        <div class="banda-contexto">${Icono.escuela}<div>${esc(nombreEscuela())}</div></div>
        ${aviso}
        <h1 class="titulo">¿De qué año es la materia?</h1>
        <div class="columna columna--14">${opciones}</div>
        <div class="espaciador"></div>
        <div class="ayuda">Si das la misma materia en dos años, cargá uno ahora y el otro al final.</div>
      </div>
    `);
  }

  /* ======================================================================
     5 · Área y espacio curricular
     ====================================================================== */

  function pantallaArea() {
    const opciones = Catalogo.areas().map((a) => `
      <button type="button" class="opcion" data-accion="elegir-area" data-id="${esc(a.id)}">
        <div class="opcion__textos">
          <div class="opcion__titulo">${esc(a.nombre)}</div>
          <div class="opcion__sub">${esc(Catalogo.subtituloArea(a.id))}</div>
        </div>
        ${Icono.chevron({ extra: ' style="flex-shrink:0"' })}
      </button>`).join('');
    return pantalla('pantalla--centrada', `
      ${cabecera()}
      ${subcabecera(`Paso 4 de ${TOTAL_PASOS}`)}
      <div class="cuerpo">
        <div class="contexto">${esc(nombreEscuela({ corto: true }))} · ${esc(textoAnio(estado.anio))}</div>
        <h1 class="titulo">¿De qué área es tu materia?</h1>
        <div class="columna columna--10">${opciones}</div>
        <div class="espaciador"></div>
        <div class="ayuda">Primero el área, después tu espacio curricular. Son dos toques.</div>
      </div>
    `);
  }

  function pantallaEspacio() {
    const area = areaActual();
    const { sueltos, artisticas } = Catalogo.espaciosAgrupados(estado.area_id);
    const opciones = sueltos.map((e) => `
      <button type="button" class="opcion opcion--alta" data-accion="elegir-espacio" data-id="${esc(e.id)}">
        <div style="flex-grow:1">${esc(Catalogo.nombreCorto(e))}</div>
        ${Icono.chevron()}
      </button>`).join('');
    const grupo = artisticas.length ? `
      <div class="grupo-espacios">
        <div class="grupo-espacios__titulo">Educación Artística</div>
        <div class="grupo-espacios__sub">Elegí el lenguaje que das</div>
        <div class="grilla-2">
          ${artisticas.map((e) => `<button type="button" class="chip-boton chip-boton--60" data-accion="elegir-espacio" data-id="${esc(e.id)}">${esc(Catalogo.nombreCorto(e))}</button>`).join('')}
        </div>
      </div>` : '';
    return pantalla('pantalla--centrada', `
      ${cabecera()}
      ${subcabecera(`Paso 4 de ${TOTAL_PASOS}`)}
      <div class="cuerpo">
        <div class="etiqueta etiqueta--ladrillo">Área: ${esc(area ? area.nombre : '')}</div>
        <h1 class="titulo">¿Cuál es tu espacio?</h1>
        <div class="columna columna--12">${opciones}${grupo}</div>
        <div class="espaciador"></div>
      </div>
    `);
  }

  function pantallaSinSaberes() {
    const esp = espacioActual();
    return pantalla('pantalla--centrada', `
      ${cabecera()}
      ${subcabecera(`Paso 4 de ${TOTAL_PASOS}`)}
      <div class="cuerpo" style="gap:22px">
        <div class="contexto">${esc(nombreEscuela({ corto: true }))} · ${esc(textoAnio(estado.anio))}</div>
        <div class="columna columna--10">
          <h1 class="titulo titulo--28">Todavía no tenemos cargados los saberes de ${esc(esp ? Catalogo.nombreCorto(esp) : 'esta materia')} para ${esc(textoAnio(estado.anio))}</h1>
          <p class="bajada">El equipo de Planificación está terminando de revisar esa parte del diseño curricular. Podés cargar otra materia u otro año, y volver a esta más adelante.</p>
        </div>
        <div class="espaciador"></div>
        <div class="columna columna--12">
          <button type="button" class="boton boton--primario" data-accion="volver">Elegir otra materia</button>
          <button type="button" class="boton boton--enlace" data-accion="ir-anio">Elegir otro año</button>
        </div>
      </div>
    `);
  }

  /* ======================================================================
     6 · Tramos (una pantalla corta antes de cada trimestre)
     ====================================================================== */

  function barrasTramos(actual) {
    return `<div class="tramos">${[1, 2, 3].map((t) => {
      const clase = t === actual ? 'tramos__tramo--actual' : (t < actual ? 'tramos__tramo--listo' : '');
      const tilde = t < actual ? Icono.check({ tam: 13, grosor: 3.2 }) : '';
      return `<div class="tramos__tramo ${clase}"><div class="tramos__barra"></div><div class="tramos__nombre">${tilde}<span>${TRIMESTRE_CORTO[t]}</span></div></div>`;
    }).join('')}</div>`;
  }

  function pantallaTramo() {
    const t = estado.tramo;
    const tr = tramosActuales();
    const previo = tramoNoVacioAntes(t);
    const esPrimero = !previo;
    const cantidad = tr[t].length;
    const listo = previo ? `
      <div class="tramo-listo">
        <div class="tramo-listo__icono">${Icono.check({ tam: 24, color: '#FFFFFF', grosor: 2.8 })}</div>
        <div>
          <div class="tramo-listo__titulo">Listo el ${TRIMESTRE_PALABRA[previo]} trimestre</div>
          <div class="tramo-listo__sub">${tr[previo].length} ${plural(tr[previo].length, 'saber', 'saberes')} · ${contarContenidos(tr[previo])} contenidos cargados</div>
        </div>
      </div>` : '';
    const etiqueta = esPrimero
      ? `${nombreEspacioCorto()} · ${textoAnio(estado.anio)}`
      : 'Seguimos con el';
    const botonTexto = esPrimero ? 'Comenzar' : `Comenzar el ${ORDINAL[t]} trimestre`;
    const pie = esPrimero
      ? notaGuardado('Si tenés que cortar, lo cargado queda guardado')
      : `<button type="button" class="boton boton--enlace" data-accion="ver-resumen">Ver lo que cargué hasta acá</button>`;
    return pantalla('pantalla--centrada', `
      ${cabecera()}
      ${subcabecera(`Tramo ${t} de 3`)}
      <div class="cuerpo" style="gap:${esPrimero ? 26 : 22}px;padding-top:14px">
        ${barrasTramos(t)}
        ${listo}
        <div class="tramo__centro">
          <div class="etiqueta etiqueta--ladrillo etiqueta--12">${esc(etiqueta)}</div>
          <h1 class="titulo ${esPrimero ? 'titulo--grande' : 'titulo--grande-2'}">${TRIMESTRE_TITULO[t]}</h1>
          <div class="tramo__cantidad">
            <div class="tramo__numero ${esPrimero ? '' : 'tramo__numero--35'}">${cantidad}</div>
            <div class="tramo__texto">${plural(cantidad, 'saber para revisar', 'saberes para revisar')}</div>
          </div>
        </div>
        <div class="columna columna--14">
          <button type="button" class="boton boton--primario ${esPrimero ? '' : 'boton--21'}" data-accion="comenzar-tramo">${botonTexto} ${Icono.flecha()}</button>
          ${pie}
        </div>
      </div>
    `);
  }

  /* ======================================================================
     7 · Saber — la pantalla crítica
     ====================================================================== */

  function sugerenciasHTML() {
    const s = saberActual();
    const texto = ui.textoContenido.trim();
    if (!s || !texto) return '';
    const { lista, exacta, tokens } = Catalogo.sugerencias(s.id, texto);
    const yaCargados = new Set(registro(s.id).contenidos.map((c) => normalizarTexto(c.texto)));
    const disponibles = lista.filter((c) => !yaCargados.has(c.texto_normalizado || normalizarTexto(c.texto)));
    const titulo = disponibles.length
      ? `Del diseño curricular · ${disponibles.length} ${plural(disponibles.length, 'coincidencia', 'coincidencias')}`
      : 'Del diseño curricular · sin coincidencias';
    const filas = disponibles.map((c, i) => `
      <button type="button" class="sugerencia ${ui.sugerenciaActiva === i ? 'sugerencia--activa' : ''}" data-accion="elegir-sugerencia" data-id="${esc(c.id)}" role="option" ${ui.sugerenciaActiva === i ? 'aria-selected="true"' : ''}>
        ${Icono.mas({ color: '#0B4F4A' })}
        <span class="sugerencia__texto">${resaltarFuerte(c.texto, tokens)}</span>
      </button>`).join('');
    const indiceLibre = disponibles.length;
    const filaLibre = exacta && yaCargados.has(exacta.texto_normalizado || normalizarTexto(exacta.texto))
      ? `<div class="sugerencia sugerencia--libre" style="cursor:default"><span class="sugerencia__libre"><span class="sugerencia__libre-texto">Ese contenido ya está cargado en este saber.</span></span></div>`
      : `<button type="button" class="sugerencia sugerencia--libre ${ui.sugerenciaActiva === indiceLibre ? 'sugerencia--activa' : ''}" data-accion="agregar-libre" role="option">
          ${Icono.mas({ color: '#7A4E00' })}
          <span class="sugerencia__libre">
            <span class="sugerencia__libre-titulo">Agregar como está</span>
            <span class="sugerencia__libre-texto">“${esc(texto)}”</span>
          </span>
        </button>`;
    return `<div class="sugerencias" role="listbox" id="sugerencias">
      <div class="sugerencias__titulo">${titulo}</div>
      ${filas}
      ${filaLibre}
    </div>`;
  }

  function fichasHTML(reg) {
    return `<div class="fichas">${reg.contenidos.map((c, i) => c.tipo === 'libre' ? `
      <div class="ficha ficha--libre">
        <div class="ficha__cuerpo">
          <div class="chip-libre">Agregado por vos</div>
          <div class="ficha__texto">${esc(c.texto)}</div>
        </div>
        <button type="button" class="boton-icono" data-accion="quitar-contenido" data-pos="${i}" aria-label="Quitar este contenido">${Icono.cerrar({ color: '#5C665F' })}</button>
      </div>` : `
      <div class="ficha">
        <div class="ficha__texto">${esc(c.texto)}</div>
        <button type="button" class="boton-icono" data-accion="quitar-contenido" data-pos="${i}" aria-label="Quitar este contenido">${Icono.cerrar({ color: '#5C665F' })}</button>
      </div>`).join('')}</div>`;
  }

  function lateralHTML() {
    const tr = tramosActuales();
    const t = estado.tramo;
    const lista = tr[t];
    const filas = [];
    let pendientesMostrados = 0;
    let pendientesOcultos = 0;
    lista.forEach((s, i) => {
      const reg = registro(s.id);
      const titulo = `${i + 1} · ${s.texto}`;
      if (i === estado.indice) {
        filas.push(`<div class="lateral__saber lateral__saber--actual">${Icono.flecha({ tam: 20, grosor: 2.6 })}<div><div class="lateral__saber-titulo">${esc(titulo)}</div><div class="lateral__saber-sub">${reg.noTrabajado ? 'No trabajo este saber' : `${reg.contenidos.length} ${plural(reg.contenidos.length, 'contenido', 'contenidos')}`}</div></div></div>`);
      } else if (reg.noTrabajado) {
        filas.push(`<button type="button" class="lateral__saber" data-accion="ir-saber" data-tramo="${t}" data-indice="${i}">${Icono.menos()}<div><div class="lateral__saber-titulo">${esc(titulo)}</div><div class="lateral__saber-sub">No trabajo este saber</div></div></button>`);
      } else if (reg.contenidos.length) {
        filas.push(`<button type="button" class="lateral__saber" data-accion="ir-saber" data-tramo="${t}" data-indice="${i}">${Icono.check({ tam: 20, grosor: 2.6 })}<div><div class="lateral__saber-titulo">${esc(titulo)}</div><div class="lateral__saber-sub">${reg.contenidos.length} ${plural(reg.contenidos.length, 'contenido', 'contenidos')}</div></div></button>`);
      } else if (pendientesMostrados < 2) {
        pendientesMostrados += 1;
        filas.push(`<div class="lateral__saber lateral__saber--pendiente"><div class="lateral__saber-titulo">${esc(titulo)}</div></div>`);
      } else {
        pendientesOcultos += 1;
      }
    });
    if (pendientesOcultos) filas.push(`<div class="lateral__nota">${pendientesOcultos} ${plural(pendientesOcultos, 'saber más', 'saberes más')} en este tramo</div>`);
    const otros = [1, 2, 3].filter((k) => k !== t && tr[k].length).map((k) =>
      `<div class="lateral__trimestre"><span>${ORDINAL[k]} TRIMESTRE</span><span>${tr[k].length} ${plural(tr[k].length, 'saber', 'saberes')}</span></div>`).join('');
    return `<aside class="lateral">
      <div class="progreso">
        <div class="etiqueta etiqueta--verde etiqueta--tal-cual">${esc(etiquetaTramo(t))}</div>
        <div class="progreso__fila"><div class="progreso__actual">Saber ${estado.indice + 1} de ${lista.length}</div><div class="progreso__faltan">tramo ${t} de 3</div></div>
        <div class="progreso__pista"><div class="progreso__barra" style="width:${Math.round(((estado.indice + 1) / lista.length) * 100)}%"></div></div>
      </div>
      <div class="lateral__lista">${filas.join('')}</div>
      <div class="lateral__lista">${otros}</div>
      <div class="espaciador"></div>
      ${notaGuardado('Se guarda solo en esta computadora')}
    </aside>`;
  }

  function pantallaSaber() {
    const s = saberActual();
    if (!s) { ir('resumen'); return ''; }
    const tr = tramosActuales();
    const t = estado.tramo;
    const total = tr[t].length;
    const n = estado.indice + 1;
    const faltan = total - n;
    const reg = registro(s.id);
    const eje = Catalogo.eje(s.eje_id);
    const hayContenidos = reg.contenidos.length > 0;
    const escribiendo = ui.textoContenido.trim() !== '';
    const editando = estado.volverA !== null;
    const textoSiguiente = editando ? (estado.volverA === 'resumen' ? 'Guardar y volver al resumen' : 'Guardar y seguir') : 'Siguiente saber';

    const progreso = `
      <div class="progreso">
        <div class="etiqueta etiqueta--verde etiqueta--tal-cual">${esc(etiquetaTramo(t))}</div>
        <div class="progreso__fila">
          <div class="progreso__actual">Saber ${n} de ${total}</div>
          <div class="progreso__faltan">${faltan > 0 ? `${faltan === 1 ? 'falta 1' : `faltan ${faltan}`} en este tramo` : 'último de este tramo'}</div>
        </div>
        <div class="progreso__pista"><div class="progreso__barra" style="width:${Math.round((n / total) * 100)}%"></div></div>
      </div>`;

    const tarjeta = `
      <div class="saber ${hayContenidos || escribiendo ? 'saber--compacto' : ''}">
        <div class="saber__eje">${esc(eje ? eje.nombre : '')}</div>
        <div class="saber__texto">${esc(s.texto)}</div>
      </div>`;

    const campo = `
      <div class="campo campo--10 campo-contenido">
        <label class="campo__etiqueta campo__etiqueta--grande ${hayContenidos ? 'oculto-visual' : ''}" for="contenido">¿Qué contenidos trabajás de este saber?</label>
        <div class="entrada-icono ${escribiendo ? 'entrada-icono--activa' : ''} ${hayContenidos && !escribiendo ? 'entrada-icono--60' : ''}">
          ${Icono.mas(escribiendo ? { color: '#0B4F4A' } : {})}
          <input class="entrada-icono__input ${hayContenidos ? 'entrada-icono__input--18' : 'entrada-icono__input--19'}" id="contenido" type="text" autocomplete="off" autocorrect="off" autocapitalize="sentences" enterkeyhint="done" role="combobox" aria-autocomplete="list" aria-expanded="${escribiendo ? 'true' : 'false'}" aria-controls="sugerencias" placeholder="${hayContenidos ? 'Agregar otro contenido…' : (esEscritorio() ? 'Escribí un contenido y elegí de la lista…' : 'Escribí un contenido…')}" value="${esc(ui.textoContenido)}">
        </div>
      </div>
      <div id="sugerencias-contenedor">${sugerenciasHTML()}</div>`;

    let cuerpoCentral;
    if (hayContenidos) {
      cuerpoCentral = `
        <div class="conteo-contenidos">${reg.contenidos.length} ${plural(reg.contenidos.length, 'contenido', 'contenidos')} en este saber</div>
        ${fichasHTML(reg)}`;
    } else if (escribiendo) {
      cuerpoCentral = `<div class="ayuda">Lo que agregás vos queda marcado aparte. No es un error: nos sirve igual.</div>`;
    } else {
      cuerpoCentral = `<div class="caja-ayuda">Escribí las primeras letras y te mostramos los contenidos del diseño curricular para este saber.<br><br>Si el tuyo no aparece, igual lo podés agregar.</div>`;
    }

    const acciones = hayContenidos ? `
      <div class="columna columna--12 acciones-saber">
        <button type="button" class="boton boton--primario boton--21" data-accion="siguiente-saber">${esc(textoSiguiente)} ${Icono.flecha()}</button>
        <button type="button" class="boton boton--secundario solo-escritorio" data-accion="abrir-no-trabajo">No trabajo este saber</button>
        ${notaGuardado('Se guarda en este teléfono, aunque se corte internet')}
      </div>` : `
      <div class="columna columna--12 acciones-saber">
        ${escribiendo ? '' : '<div class="ayuda ayuda--avanzar">Para pasar al siguiente saber, agregá al menos un contenido.</div>'}
        ${escribiendo ? '' : '<button type="button" class="boton boton--secundario" data-accion="abrir-no-trabajo">No trabajo este saber</button>'}
        ${notaGuardado('Se guarda en este teléfono, aunque se corte internet')}
      </div>`;

    const hoja = ui.hojaAbierta ? `
      <div class="velo" data-accion="cerrar-hoja"></div>
      <div class="hoja" role="dialog" aria-modal="true" aria-labelledby="hoja-titulo">
        <div class="hoja__asa"></div>
        <h2 class="hoja__titulo" id="hoja-titulo">¿No trabajás este saber?</h2>
        <p class="bajada">Lo vamos a registrar como <strong>no trabajado</strong>. No es lo mismo que dejarlo vacío: que un saber no se trabaje también es un dato que necesitamos.</p>
        <div class="hoja__botones">
          <button type="button" class="boton boton--primario boton--66" data-accion="confirmar-no-trabajo">Sí, no lo trabajo</button>
          <button type="button" class="boton boton--secundario" data-accion="cerrar-hoja">Volver y cargar contenidos</button>
        </div>
      </div>` : '';

    return pantalla('pantalla--carga', `
      ${cabecera()}
      <div class="carga">
        ${lateralHTML()}
        <div class="carga__principal">
          ${subcabecera(`Tramo ${t} de 3`)}
          <div class="cuerpo" style="gap:16px;padding-top:4px;padding-bottom:22px">
            ${progreso}
            ${tarjeta}
            ${campo}
            ${cuerpoCentral}
            <div class="espaciador"></div>
            ${acciones}
          </div>
        </div>
      </div>
      ${hoja}
    `);
  }

  /* ======================================================================
     8 · Resumen
     ====================================================================== */

  function resumenSaberHTML(s, numero, tramo, indice) {
    const reg = registro(s.id);
    const resuelto = estaResuelto(s.id);
    const rotulo = reg.noTrabajado || !resuelto
      ? `Saber ${numero}`
      : `Saber ${numero} · ${reg.contenidos.length} ${plural(reg.contenidos.length, 'contenido', 'contenidos')}`;
    let detalle;
    if (reg.noTrabajado) detalle = `<div class="chip-no-trabajado">No trabajo este saber</div>`;
    else if (!resuelto) detalle = `<div class="chip-no-trabajado">Todavía sin cargar</div>`;
    else detalle = reg.contenidos.map((c) => `
      <div class="resumen-saber__contenido">
        <div>${esc(c.texto)}</div>
        ${c.tipo === 'libre' ? '<div class="resumen-saber__libre">Agregado por vos</div>' : ''}
      </div>`).join('');
    return `
      <div class="resumen-saber">
        <div class="resumen-saber__fila">
          <div class="resumen-saber__rotulo">${esc(rotulo)}</div>
          <button type="button" class="enlace" data-accion="editar-saber" data-tramo="${tramo}" data-indice="${indice}">${resuelto ? 'Editar' : 'Cargar'}</button>
        </div>
        <div class="resumen-saber__texto ${resuelto && !reg.noTrabajado ? '' : 'resumen-saber__texto--solo'}">${esc(s.texto)}</div>
        ${detalle}
      </div>`;
  }

  function pantallaResumen() {
    Envio.precargar();
    const tr = tramosActuales();
    const pendientes = saberesPendientes();
    const total = totalSaberes();
    const totalContenidos = contarContenidos([].concat(tr[1], tr[2], tr[3]));
    const columnas = [1, 2, 3].filter((t) => tr[t].length).map((t) => `
      <section class="resumen-trimestre">
        <div class="resumen-trimestre__cabecera">
          <div class="resumen-trimestre__nombre">${TRIMESTRE_CORTO[t].replace(' trimestre', ' TRIMESTRE')}</div>
          <div class="resumen-trimestre__conteo">${tr[t].length} ${plural(tr[t].length, 'saber', 'saberes')} · ${contarContenidos(tr[t])} contenidos</div>
        </div>
        <div class="resumen-trimestre__lista columna columna--10">
          ${tr[t].map((s, i) => resumenSaberHTML(s, i + 1, t, i)).join('')}
        </div>
      </section>`).join('');

    const notaPendientes = pendientes.length
      ? `<div class="aviso">Te ${pendientes.length === 1 ? 'queda 1 saber' : `quedan ${pendientes.length} saberes`} por revisar antes de enviar.</div>` : '';
    const botonPrincipal = pendientes.length
      ? `<button type="button" class="boton boton--primario boton--21" data-accion="seguir-cargando">Seguir cargando ${Icono.flecha()}</button>`
      : `<button type="button" class="boton boton--primario boton--21" data-accion="confirmar-enviar" ${ui.enviando ? 'disabled' : ''}>${ui.enviando ? 'Enviando…' : 'Confirmar y enviar'}</button>`;
    const error = ui.errorEnvio ? `<div class="aviso aviso--error" role="alert">${esc(ui.errorEnvio)}</div>` : '';

    const parcial = pendientes.length > 0;
    const paso = parcial ? `Tramo ${estado.resumenDesde ? estado.resumenDesde.tramo : estado.tramo} de 3` : 'Último paso';
    const titulo = parcial ? 'Lo que cargaste hasta acá' : 'Revisá antes de enviar';
    const bajada = parcial
      ? `<span class="solo-movil">Está ordenado por trimestre. Podés corregir lo que quieras y después seguir cargando.</span><span class="solo-escritorio">Los tres trimestres lado a lado. Podés corregir lo que quieras y después seguir cargando.</span>`
      : `<span class="solo-movil">Está ordenado por trimestre, como lo fuiste cargando. Es la última pantalla para corregir.</span><span class="solo-escritorio">Los tres trimestres lado a lado. Cada columna se recorre por separado.</span>`;

    return pantalla('pantalla--resumen pantalla--centrada-ancha', `
      ${cabecera()}
      ${subcabecera(paso)}
      <div class="cuerpo" style="padding-top:4px;padding-bottom:24px">
        <div class="resumen__encabezado">
          <div class="columna" style="gap:8px">
            <h1 class="titulo titulo--29">${titulo}</h1>
            <p class="bajada bajada--16">${bajada}</p>
          </div>
          <div class="resumen__acciones">
            ${botonPrincipal}
            <div class="conteo">${total} ${plural(total, 'saber', 'saberes')} · ${totalContenidos} contenidos</div>
          </div>
        </div>
        <div class="tarjeta tarjeta--escuela resumen-escuela">
          <div class="resumen-escuela__textos">
            <div class="resumen-escuela__nombre">${esc(nombreEscuela())}</div>
            <div class="resumen-escuela__sub">${esc(nombreEspacioCorto())} · ${esc(textoAnio(estado.anio))} · ${total} ${plural(total, 'saber', 'saberes')}</div>
          </div>
          <button type="button" class="enlace" data-accion="cambiar-escuela">Cambiar</button>
        </div>
        ${error}
        ${notaPendientes}
        <div class="resumen__columnas columna columna--18">${columnas}</div>
        <div class="espaciador"></div>
        <div class="columna columna--10 resumen__pie">
          ${botonPrincipal}
          ${pendientes.length ? '' : '<div class="ayuda ayuda--14 ayuda--centrada">Después vas a poder cargar otra materia.</div>'}
        </div>
      </div>
    `);
  }

  /* ======================================================================
     9 · Confirmación y cierre
     ====================================================================== */

  function pantallaConfirmacion() {
    const u = estado.ultimoEnvio || {};
    let prueba = '';
    if (u.demo) prueba = `<div class="banda-prueba">Modo demostración: esta carga no se guardó en la base.</div>`;
    else if (u.prueba) prueba = `<div class="banda-prueba">Modo prueba: la base de datos todavía no está conectada, así que esta carga no se envió.</div>`;
    return pantalla('pantalla--centrada', `
      ${cabecera()}
      <div class="cuerpo" style="gap:22px;padding-top:34px">
        <div class="confirmacion__cabeza">
          <div class="confirmacion__icono">${Icono.check({ tam: 40, color: '#FFFFFF', grosor: 2.6 })}</div>
          <h1 class="titulo">¡Listo! Recibimos tu carga</h1>
          <p class="bajada">Gracias por el tiempo. Lo que cargaste ayuda a ver qué se enseña en toda la provincia.</p>
        </div>
        ${prueba}
        <div class="tarjeta columna" style="gap:5px">
          <div class="confirmacion__materia">${esc(u.espacio)} · ${esc(textoAnio(u.anio))}</div>
          <div class="confirmacion__escuela">${esc(u.escuela)} — ${u.saberes} ${plural(u.saberes, 'saber revisado', 'saberes revisados')}</div>
        </div>
        <div class="linea-separadora"></div>
        <div class="columna columna--14">
          <h2 class="subtitulo">¿Cargás otra materia?</h2>
          <button type="button" class="boton-opcion boton-opcion--primario" data-accion="otra-misma-escuela">
            <div class="boton-opcion__textos"><div class="boton-opcion__titulo">En la misma escuela</div><div class="boton-opcion__sub">${esc(u.escuelaCorta)}</div></div>
            ${Icono.chevron({ color: '#FFFFFF' })}
          </button>
          <button type="button" class="boton-opcion boton-opcion--secundario" data-accion="otra-otra-escuela">
            <div class="boton-opcion__textos"><div class="boton-opcion__titulo">En otra escuela</div><div class="boton-opcion__sub">Elegís otra de la lista</div></div>
            ${Icono.chevron()}
          </button>
          <button type="button" class="boton boton--terciario" data-accion="terminar">Terminé</button>
        </div>
        <div class="espaciador"></div>
        <div class="ayuda ayuda--centrada">Si seguís, no te volvemos a pedir tu nombre.</div>
      </div>
    `);
  }

  function pantallaGracias() {
    return pantalla('pantalla--centrada', `
      ${cabecera()}
      <div class="cuerpo" style="gap:22px;padding-top:34px">
        <div class="confirmacion__cabeza">
          <div class="confirmacion__icono">${Icono.check({ tam: 40, color: '#FFFFFF', grosor: 2.6 })}</div>
          <h1 class="titulo">Gracias por participar</h1>
          <p class="bajada">Ya podés cerrar esta página. Si más adelante querés cargar otra materia, volvé a entrar desde el mismo enlace.</p>
        </div>
        <div class="espaciador"></div>
        <button type="button" class="boton boton--enlace" data-accion="volver-inicio">Volver al inicio</button>
      </div>
    `);
  }

  /* ======================================================================
     Render y eventos
     ====================================================================== */

  const PANTALLAS = {
    bienvenida: pantallaBienvenida,
    nombre: pantallaNombre,
    escuela: pantallaEscuela,
    'escuela-manual': pantallaEscuelaManual,
    anio: pantallaAnio,
    area: pantallaArea,
    espacio: pantallaEspacio,
    'sin-saberes': pantallaSinSaberes,
    tramo: pantallaTramo,
    saber: pantallaSaber,
    resumen: pantallaResumen,
    confirmacion: pantallaConfirmacion,
    gracias: pantallaGracias,
  };

  function render() {
    const fn = PANTALLAS[estado.pantalla] || pantallaBienvenida;
    const html = fn();
    if (html === '') return; // la pantalla redirigió a otra
    app.innerHTML = html;
    document.body.style.overflow = ui.hojaAbierta ? 'hidden' : '';
    enlazarEntradas();
  }

  function enlazarEntradas() {
    const nombre = document.getElementById('nombre');
    const apellido = document.getElementById('apellido');
    if (nombre) nombre.addEventListener('input', (e) => { estado.nombre = e.target.value; guardar(); });
    if (apellido) apellido.addEventListener('input', (e) => { estado.apellido = e.target.value; guardar(); });

    const buscar = document.getElementById('buscar-escuela');
    if (buscar) {
      buscar.addEventListener('input', (e) => {
        const antes = ui.consultaEscuela.trim() !== '' || ui.departamentoElegido;
        ui.consultaEscuela = e.target.value;
        ui.departamentoElegido = null;
        const ahora = ui.consultaEscuela.trim() !== '';
        if (antes !== ahora) {
          // Cambia la forma de la pantalla (aparece o desaparece el título y el botón de borrar)
          render();
          const campo = document.getElementById('buscar-escuela');
          if (campo) { campo.focus(); campo.setSelectionRange(campo.value.length, campo.value.length); }
        } else {
          const cont = document.getElementById('resultados-escuela');
          if (cont) cont.innerHTML = resultadosEscuela();
        }
      });
    }

    const manualNombre = document.getElementById('nombre-escuela');
    const manualDep = document.getElementById('departamento');
    const manualLoc = document.getElementById('localidad');
    if (manualNombre) manualNombre.addEventListener('input', (e) => { ui.manual.nombre = e.target.value; });
    if (manualDep) manualDep.addEventListener('change', (e) => { ui.manual.departamento_id = e.target.value; });
    if (manualLoc) manualLoc.addEventListener('input', (e) => { ui.manual.localidad = e.target.value; });

    const contenido = document.getElementById('contenido');
    if (contenido) {
      contenido.addEventListener('input', (e) => {
        const antes = ui.textoContenido.trim() !== '';
        ui.textoContenido = e.target.value;
        ui.sugerenciaActiva = -1;
        const ahora = ui.textoContenido.trim() !== '';
        if (antes !== ahora) {
          render();
          const campo = document.getElementById('contenido');
          if (campo) { campo.focus(); campo.setSelectionRange(campo.value.length, campo.value.length); }
        } else {
          const cont = document.getElementById('sugerencias-contenedor');
          if (cont) cont.innerHTML = sugerenciasHTML();
        }
      });
      contenido.addEventListener('keydown', tecladoSugerencias);
    }
  }

  function tecladoSugerencias(e) {
    const s = saberActual();
    if (!s) return;
    const texto = ui.textoContenido.trim();
    if (!texto) return;
    const { lista } = Catalogo.sugerencias(s.id, texto);
    const yaCargados = new Set(registro(s.id).contenidos.map((c) => normalizarTexto(c.texto)));
    const disponibles = lista.filter((c) => !yaCargados.has(c.texto_normalizado || normalizarTexto(c.texto)));
    const totalOpciones = disponibles.length + 1; // + «Agregar como está»
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      ui.sugerenciaActiva = (ui.sugerenciaActiva + 1) % totalOpciones;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      ui.sugerenciaActiva = (ui.sugerenciaActiva - 1 + totalOpciones) % totalOpciones;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (ui.sugerenciaActiva >= 0 && ui.sugerenciaActiva < disponibles.length) agregarContenido({ contenido: disponibles[ui.sugerenciaActiva] });
      else if (ui.sugerenciaActiva === disponibles.length || disponibles.length === 0) agregarContenido({ textoLibre: texto });
      else agregarContenido({ contenido: disponibles[0] });
      return;
    } else if (e.key === 'Escape') {
      ui.textoContenido = '';
      render();
      return;
    } else return;
    const cont = document.getElementById('sugerencias-contenedor');
    if (cont) cont.innerHTML = sugerenciasHTML();
  }

  app.addEventListener('click', (e) => {
    const objetivo = e.target.closest('[data-accion]');
    if (!objetivo) return;
    const accion = objetivo.dataset.accion;
    const d = objetivo.dataset;
    switch (accion) {
      case 'volver': volver(); break;
      case 'comenzar': comenzar(); break;
      case 'reanudar': reanudar(); break;
      case 'continuar-nombre': continuarNombre(); break;
      case 'elegir-departamento':
        ui.departamentoElegido = d.id;
        ui.consultaEscuela = (Catalogo.departamento(d.id) || {}).nombre || '';
        render();
        break;
      case 'borrar-busqueda':
        ui.consultaEscuela = '';
        ui.departamentoElegido = null;
        render();
        { const campo = document.getElementById('buscar-escuela'); if (campo) campo.focus(); }
        break;
      case 'elegir-escuela': elegirEscuela(d.id); break;
      case 'escuela-manual': ui.errores = {}; ir('escuela-manual'); break;
      case 'volver-a-buscar': ir('escuela'); break;
      case 'continuar-escuela-manual': continuarEscuelaManual(); break;
      case 'elegir-anio': elegirAnio(Number(d.anio)); break;
      case 'ir-anio': ir('anio'); break;
      case 'elegir-area': elegirArea(d.id); break;
      case 'elegir-espacio': elegirEspacio(d.id); break;
      case 'comenzar-tramo': comenzarTramo(); break;
      case 'ver-resumen': estado.resumenDesde = { tramo: estado.tramo }; ir('resumen'); break;
      case 'elegir-sugerencia': agregarContenido({ contenido: Catalogo.contenido(d.id) }); break;
      case 'agregar-libre': agregarContenido({ textoLibre: ui.textoContenido }); break;
      case 'quitar-contenido': quitarContenido(Number(d.pos)); break;
      case 'siguiente-saber': siguienteSaber(); break;
      case 'abrir-no-trabajo': ui.hojaAbierta = true; render(); break;
      case 'cerrar-hoja': ui.hojaAbierta = false; render(); break;
      case 'confirmar-no-trabajo': confirmarNoTrabajado(); break;
      case 'ir-saber': editarSaber(Number(d.tramo), Number(d.indice), { tramo: estado.tramo, indice: estado.indice }); break;
      case 'editar-saber': editarSaber(Number(d.tramo), Number(d.indice), 'resumen'); break;
      case 'seguir-cargando': seguirCargando(); break;
      case 'cambiar-escuela': estado.volverA = null; ir('escuela'); break;
      case 'confirmar-enviar': confirmarYEnviar(); break;
      case 'otra-misma-escuela': otraMateriaMismaEscuela(); break;
      case 'otra-otra-escuela': otraMateriaOtraEscuela(); break;
      case 'terminar': terminar(); break;
      case 'volver-inicio': ir('bienvenida'); break;
      default: break;
    }
  });

  app.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    if (form.dataset.form === 'nombre') continuarNombre();
    if (form.dataset.form === 'escuela-manual') continuarEscuelaManual();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.hojaAbierta) { ui.hojaAbierta = false; render(); }
  });

  /* ======================================================================
     Arranque
     ====================================================================== */

  async function iniciar() {
    try {
      await Catalogo.cargar();
    } catch (e) {
      app.innerHTML = `<div class="cargando">No pudimos cargar el diseño curricular. Revisá la conexión y volvé a cargar la página.</div>`;
      return;
    }
    const borrador = leerBorrador();
    if (borrador && PANTALLAS_EN_CURSO.has(borrador.pantalla) && borrador.nombre) {
      estado = Object.assign(estadoInicial(), borrador);
      // Si el catálogo cambió y el espacio ya no existe, se vuelve al principio del aporte
      if (estado.espacio_id && !Catalogo.espacio(estado.espacio_id)) {
        estado.espacio_id = null; estado.saberes = {}; estado.pantalla = 'area';
      }
      ui.pantallaReanudar = estado.pantalla;
      estado.pantalla = 'bienvenida';
    } else if (borrador && borrador.pantalla === 'confirmacion') {
      // Terminó una materia y cerró: se le guarda el nombre y la escuela para la próxima
      estado = Object.assign(estadoInicial(), { clave: borrador.clave || generarClave(), nombre: borrador.nombre, apellido: borrador.apellido, escuela: borrador.escuela, historial: borrador.historial || [] });
    }
    render();
  }

  iniciar();
})();
