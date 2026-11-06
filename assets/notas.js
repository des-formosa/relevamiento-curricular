/* ============================================================================
   Notas a las escuelas — dentro de Seguimiento, en el panel del equipo.

   Antes era el «Distribuidor de Notas DES», una página aparte que guardaba la
   base de directivos y lo enviado en cada computadora. Lo pidió el equipo el
   06/11/2026: «la idea es centralizar la gestión». Ahora:

   - una nota se redacta una vez (con plantillas guardadas) y sale una hoja
     por destinatario, con su escuela, su director y su anexo si corresponde;
   - los destinatarios son los contactos que ya tiene el panel (la ficha de
     cada escuela): director de cada E.P.E.S., coordinador de cada anexo y
     delegaciones zonales. Se corrigen donde siempre, en la ficha;
   - lo enviado queda en la base (sql/18_notas.sql): dos personas pueden
     repartirse el envío sin mandar dos veces;
   - «Actualizar contactos» lee la base de directivos (el Excel unificado), la
     coteja con lo que hay y, si el equipo confirma, la carga. Vale lo de la
     planilla salvo donde el equipo corrigió algo desde la ficha.

   Ninguna página puede adjuntar un archivo en WhatsApp sola: «Por WhatsApp»
   baja el PDF de esa escuela y abre el chat del director con el mensaje
   escrito; el PDF se arrastra al chat. «Por correo», lo mismo con Gmail.
   ============================================================================ */

const Notas = (function () {
  'use strict';

  const URL_HTML2PDF = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
  const URL_JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  const URL_MAMMOTH = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
  const LOGO_IZQ = 'assets/img/nota-logo-ministerio.jpg';
  const LOGO_DER = 'assets/img/nota-logo-secundaria.png';

  // El membrete de la nota modelo de la DES (NOTA modelo.docx). Se cambia
  // desde «Membrete y firma» y vale para todas las notas.
  const MEMBRETE_INICIAL = {
    lemas: '"30 años del PAIPPA (1996-2026)"\n“210 años de la Independencia Argentina (1816 – 2026)”\n"20 años de la Ley de Educación Nacional (2006 – 2026)"',
    de: 'DE LA:\nDIRECCIÓN DE EDUCACIÓN SECUNDARIA',
    ciudad: 'Formosa',
    prefijo: 'NOTA MULTIPLE Nº',
    prefijoC: 'NOTA N°',
    f1: 'Equipo Técnico',
    f2: 'Dirección de Educación Secundaria',
    f3: 'Ministerio de Cultura y Educación',
    firmaImg: '',
    trat: 'Sr./Sra. Director/a',
    tratC: 'Sr./Sra. Coordinador/a de Anexos',
    tratD: 'Sr./Sra. Delegado/a Zonal',
    prof: 'Prof.',
  };
  const MENSAJE_INICIAL = 'Buenos días {{DIRECTOR}}. Desde la Dirección de Educación Secundaria le hacemos llegar la nota para la {{ESCUELA}}. Por favor, confirmar recepción. Muchas gracias.';
  const CUERPO_INICIAL = '<p>De nuestra mayor consideración:</p><p>Me dirijo a Ud., y por su intermedio a quien corresponda, a fin de …</p><p>Sin otro particular, saludo a Ud. atentamente.</p>';
  // Lo que se puede escribir en el texto y se completa para cada destinatario
  const CAMPOS = [
    ['ESCUELA', 'E.P.E.S. N° 10'], ['ESCUELA_COMPLETA', 'con su nombre propio'], ['DIRECTOR', 'quien la recibe'],
    ['CARGO', 'Director/a o Coordinador/a'], ['ANEXOS', 'los que coordina'], ['LOCALIDAD', ''], ['DEPARTAMENTO', ''],
    ['DELEGACION', 'delegación zonal'],
  ];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  let sb = null;
  let d = null;          // lo que presta el panel: render, contactos, sedes, imprimir…
  let reloj = null;      // autoguardado

  const st = {
    activo: false,
    paso: 'lista',       // lista | redactar | destinatarios | enviar
    abrirId: null,       // la nota del hash, para abrirla cuando lleguen los datos
    cargando: false,
    error: null,
    sinTablas: null,     // por qué no se pudo leer notas (sql/18 sin correr)
    lista: null,
    envios: new Map(),   // nota_id → Map(destino → { canal, enviado_en })
    membrete: { ...MEMBRETE_INICIAL },
    escuelasDb: new Map(), // id → { denominacion, direccion }
    verArchivadas: false,
    nota: null,          // la que se está redactando (con destinatarios como Set)
    sucio: false,
    guardando: false,
    estadoGuardado: '',
    conflicto: false,
    filtros: { deleg: '', dep: '', cargo: '', mod: '', texto: '', faltan: false },
    previa: null,        // id del destinatario que se mira en la vista previa
    aviso: null,         // { texto, error } arriba de la lista de envío
    enviando: null,      // id del destinatario cuyo PDF se está armando
    lote: null,          // texto del progreso del ZIP
    modal: null,         // 'membrete' | 'contactos'
    errorModal: null,
    guardandoModal: false,
    base: null,          // el cotejo de la base de directivos
  };

  /* ======================================================================
     Utilidades
     ====================================================================== */

  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  const numero = (n) => Number(n || 0).toLocaleString('es-AR');
  const plural = (n, uno, varios) => (n === 1 ? uno : varios);
  const hoyISO = () => { const x = new Date(); return new Date(x - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  function fechaLarga(iso) {
    if (!iso) return '';
    const [y, m, dia] = iso.split('-').map(Number);
    return `${dia} de ${MESES[m - 1]} de ${y}`;
  }
  // «GOMEZ, MARIELA» → «Gomez, Mariela»
  const titulo = (s) => String(s || '').toLowerCase().replace(/(^|[\s,.\-/(])([a-záéíóúñü])/g, (a, b, c) => b + c.toUpperCase());
  const limpioArchivo = (t) => String(t || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  const cuandoEnvio = (iso) => {
    if (!iso) return '';
    const x = new Date(iso);
    const dia = d.cuandoFue(x.getTime());
    return `${dia} ${x.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
  };
  // Lo que se guarda del cuerpo: párrafos, negrita, cursiva, subrayado y
  // listas. Lo pegado de Word trae estilos y atributos que en la hoja molestan.
  const PERMITIDAS = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'DIV']);
  function limpiarHTML(html) {
    const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
    const raiz = doc.body.firstElementChild;
    const recorrer = (nodo) => {
      for (const hijo of [...nodo.childNodes]) {
        if (hijo.nodeType === 1) {
          recorrer(hijo);
          if (!PERMITIDAS.has(hijo.tagName)) {
            if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'TEMPLATE'].includes(hijo.tagName)) hijo.remove();
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

  function bajar(blob, nombre) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  /* ======================================================================
     Datos
     ====================================================================== */

  async function traerEscuelasDb() {
    for (const columnas of ['id, denominacion, direccion', 'id, denominacion']) {
      const r = await sb.from('escuelas').select(columnas);
      if (!r.error) return new Map((r.data || []).map((x) => [x.id, x]));
    }
    return new Map();
  }

  async function traerEnvios() {
    const r = await sb.from('notas_envios').select('nota_id, destino, canal, enviado_en');
    if (r.error) throw new Error(r.error.message);
    const porNota = new Map();
    for (const e of r.data || []) {
      if (!porNota.has(e.nota_id)) porNota.set(e.nota_id, new Map());
      porNota.get(e.nota_id).set(e.destino, e);
    }
    return porNota;
  }

  async function cargar() {
    st.cargando = true;
    st.error = null;
    st.sinTablas = null;
    d.render();
    const [notas, membrete, escuelas] = await Promise.all([
      sb.from('notas').select('*').order('actualizada_en', { ascending: false }),
      sb.from('notas_membrete').select('datos').maybeSingle(),
      traerEscuelasDb(),
    ]);
    st.escuelasDb = escuelas;
    if (notas.error) {
      st.sinTablas = notas.error.message || String(notas.error);
      st.cargando = false;
      d.render();
      return;
    }
    try { st.envios = await traerEnvios(); } catch (e) { st.error = e.message; }
    st.lista = notas.data || [];
    st.membrete = { ...MEMBRETE_INICIAL, ...((membrete.data && membrete.data.datos) || {}) };
    st.cargando = false;
    if (st.abrirId) {
      const n = st.lista.find((x) => x.id === st.abrirId);
      const paso = st.paso;
      st.abrirId = null;
      if (n) { abrirNota(n); st.paso = ['redactar', 'destinatarios', 'enviar'].includes(paso) ? paso : 'redactar'; }
      else st.paso = 'lista';
    }
    d.escribirHash();
    d.render();
  }

  function deFila(n) {
    return {
      id: n.id, version: n.actualizada_en, titulo: n.titulo || '', numero: n.numero || '', fecha: n.fecha || '',
      asunto: n.asunto || '', formato: n.formato || 'clasica', anexo: n.anexo || '', dest_extra: n.dest_extra || '',
      firma: n.firma || '', cuerpo: n.cuerpo || '', mensaje: n.mensaje || '', destinatarios: new Set(n.destinatarios || []),
    };
  }
  const aDatos = (n) => ({
    titulo: n.titulo, numero: n.numero, fecha: n.fecha, asunto: n.asunto, formato: n.formato, anexo: n.anexo,
    dest_extra: n.dest_extra, firma: n.firma, cuerpo: limpiarHTML(n.cuerpo), mensaje: n.mensaje, destinatarios: [...n.destinatarios],
  });

  function abrirNota(fila) {
    st.nota = deFila(fila);
    st.sucio = false;
    // Una nota sin fecha (la que vino con el Distribuidor) arranca con la de hoy
    if (!st.nota.fecha) { st.nota.fecha = hoyISO(); st.sucio = true; reloj = setTimeout(guardar, 1200); }
    st.conflicto = false;
    st.estadoGuardado = '';
    st.aviso = null;
    st.previa = null;
  }

  function decirGuardado(texto) {
    st.estadoGuardado = texto;
    const el = document.getElementById('nt-guardado');
    if (el) el.textContent = texto;
  }

  // Se guarda solo: un momento después de dejar de escribir, al cambiar de
  // paso y antes de enviar. Sin redibujar, para no cortar lo que se escribe.
  function marcarSucio() {
    st.sucio = true;
    decirGuardado('Sin guardar…');
    clearTimeout(reloj);
    reloj = setTimeout(() => { guardar(); }, 1200);
  }

  async function guardar() {
    clearTimeout(reloj);
    const n = st.nota;
    if (!n || !st.sucio || st.conflicto) return true;
    if (st.guardando) { reloj = setTimeout(guardar, 400); return true; }
    st.guardando = true;
    st.sucio = false;
    decirGuardado('Guardando…');
    const { data, error } = await sb.rpc('guardar_nota', { p_id: n.id, p_datos: aDatos(n), p_version: n.version });
    st.guardando = false;
    const fallo = error ? 'No se pudo guardar. Revisá la conexión: lo escrito sigue acá.' : data && data.error;
    if (fallo) {
      st.sucio = true;
      if (data && data.conflicto) { st.conflicto = true; d.render(); }
      decirGuardado(fallo);
      return false;
    }
    if (st.nota === n) {
      n.version = data.actualizada_en;
      if (!n.id) n.id = data.id;
      const i = st.lista.findIndex((x) => x.id === data.id);
      if (i >= 0) st.lista[i] = data; else st.lista.unshift(data);
      decirGuardado(st.sucio ? 'Sin guardar…' : 'Guardado');
    }
    return true;
  }

  async function notaNueva(base) {
    const datos = base
      ? { ...aDatos(deFila(base)), titulo: `${base.titulo} (copia)`, numero: '', fecha: hoyISO() }
      : { titulo: `Nota del ${fechaLarga(hoyISO())}`, fecha: hoyISO(), formato: 'clasica', cuerpo: CUERPO_INICIAL, mensaje: MENSAJE_INICIAL, destinatarios: [] };
    const { data, error } = await sb.rpc('guardar_nota', { p_id: null, p_datos: datos, p_version: null });
    if (error || (data && data.error)) {
      st.error = (data && data.error) || 'No se pudo crear la nota. Revisá la conexión y volvé a intentar.';
      d.render();
      return;
    }
    st.lista.unshift(data);
    abrirNota(data);
    st.paso = 'redactar';
    d.escribirHash();
    d.render();
    window.scrollTo(0, 0);
    const t = document.getElementById('nt-titulo');
    if (t) { t.focus(); t.select(); }
  }

  async function archivar(id, archivada) {
    const { data, error } = await sb.rpc('archivar_nota', { p_id: id, p_archivada: archivada });
    if (error || (data && data.error)) { st.error = (data && data.error) || 'No se pudo. Volvé a intentar.'; d.render(); return; }
    const n = st.lista.find((x) => x.id === id);
    if (n) n.archivada = archivada;
    st.error = null;
    d.render();
  }

  async function marcar(destino, canal) {
    const n = st.nota;
    const { data, error } = await sb.rpc('marcar_envio', { p_nota_id: n.id, p_destino: destino, p_canal: canal });
    if (error || (data && data.error)) {
      st.aviso = { texto: (data && data.error) || 'No se pudo marcar el envío. Revisá la conexión.', error: true };
      return;
    }
    if (!st.envios.has(n.id)) st.envios.set(n.id, new Map());
    if (canal) st.envios.get(n.id).set(destino, data); else st.envios.get(n.id).delete(destino);
  }

  /* ======================================================================
     Destinatarios: salen de los contactos del panel
     ====================================================================== */

  const esDelegacion = (c) => /^delegaci/i.test(c.nombre || '');
  const esCorreoOficial = (c) => /correo oficial/i.test(c.nombre || '');
  const esCoordinador = (c) => /coordin/i.test(c.cargo || '');
  const persona = (c) => c && !esDelegacion(c) && !esCorreoOficial(c);
  // Una planilla vieja escribía «A/C Gonzalez»: en la nota va «(a cargo)» aparte
  const esAC = (n) => /^\s*a\s*\/\s*c\s+/i.test(n || '');
  const sinAC = (n) => String(n || '').replace(/^\s*a\s*\/\s*c\s+/i, '');
  const modalidad = (e) => (!e ? '' : /AGRAR/.test(e.tipo || '') ? 'agraria' : /EIB/.test(e.tipo || '') ? 'eib' : 'comun');
  const conDenominacion = (e) => {
    const den = (st.escuelasDb.get(e.id) || {}).denominacion || e.denominacion || '';
    return den ? `${e.nombre} “${den}”` : e.nombre;
  };

  // Se arma una vez por dibujo (pantalla() la descarta): así lo corregido en
  // la ficha se ve enseguida
  let cacheDest = null;
  function destinatarios() {
    if (cacheDest) return cacheDest;
    const contactos = d.contactos();
    const lista = [];
    const delegaciones = new Map();
    const coords = new Map();
    const de = (id) => (contactos && contactos.get(id)) || [];
    for (const e of d.nominaOrdenada()) {
      const suyos = de(e.id);
      for (const c of suyos.filter((x) => esDelegacion(x) && x.correo)) {
        const k = c.correo.toLowerCase();
        if (!delegaciones.has(k)) delegaciones.set(k, { c, escuelas: [] });
        delegaciones.get(k).escuelas.push(e);
      }
      if (!d.esAnexo(e)) {
        const gente = suyos.filter(persona);
        const conCel = gente.filter((c) => c.celular);
        const dir = gente.find((c) => /direct/i.test(c.cargo || '') && c.celular)
          || gente.find((c) => /direct/i.test(c.cargo || '')) || conCel[0] || gente[0] || null;
        const oficial = suyos.find(esCorreoOficial);
        const deleg = suyos.find(esDelegacion);
        lista.push({
          id: `dir:${e.id}`, tipo: 'director', escuela: e, referencia: e, anexos: [], contacto: dir,
          nombre: sinAC(dir && dir.nombre), celular: dir ? dir.celular || '' : '',
          correo: (oficial && oficial.correo) || (dir && dir.correo) || '',
          revista: dir ? dir.revista || '' : '', aCargo: !!(dir && (dir.a_cargo || esAC(dir.nombre))),
          delegacion: deleg ? deleg.nombre.replace(/^delegaci[oó]n zonal\s*/i, '') : '',
          deps: [e.departamento_id],
        });
      } else {
        // Un anexo con contacto propio (coordinador, o quien haya cargado el
        // equipo en la ficha, con el cargo que sea): una nota por persona, con
        // todos sus anexos. La misma persona es el mismo celular, o el mismo
        // nombre escrito en otro orden («Ruiz Ramon» y «Ramón Ruiz»).
        const sede = d.sedeDe(e.id);
        const gente = suyos.filter(persona);
        for (const c of gente) {
          const k = `${sede ? sede.id : ''}|${claveNombre(sinAC(c.nombre)) || c.celular}`;
          if (!coords.has(k)) coords.set(k, { c, sede, anexos: [] });
          const g = coords.get(k);
          // Si uno de los dos tiene celular, vale ese
          if (!g.c.celular && c.celular) g.c = c;
          if (!g.anexos.includes(e)) g.anexos.push(e);
        }
        // Sin contacto propio también tiene que aparecer (si no, no había cómo
        // encontrarlo para mandarle la nota): le llega al director de su sede,
        // como en la ficha y en «Mandarle el avance»
        if (!gente.length) {
          const deSede = sede ? de(sede.id) : [];
          const suGente = deSede.filter(persona);
          const dir = suGente.find((c) => /direct/i.test(c.cargo || '') && c.celular)
            || suGente.find((c) => /direct/i.test(c.cargo || '')) || suGente.find((c) => c.celular) || suGente[0] || null;
          const oficial = deSede.find(esCorreoOficial);
          const deleg = deSede.find(esDelegacion);
          lista.push({
            id: `anexo:${e.id}`, tipo: 'anexo', escuela: e, referencia: sede || e, anexos: [e], contacto: dir,
            nombre: sinAC(dir && dir.nombre), celular: dir ? dir.celular || '' : '',
            correo: (oficial && oficial.correo) || (dir && dir.correo) || '',
            revista: '', aCargo: !!(dir && (dir.a_cargo || esAC(dir.nombre))),
            delegacion: deleg ? deleg.nombre.replace(/^delegaci[oó]n zonal\s*/i, '') : '',
            deps: [e.departamento_id],
          });
        }
      }
    }
    for (const { c, sede, anexos } of coords.values()) {
      const ref = sede || anexos[0];
      const oficial = sede ? de(sede.id).find(esCorreoOficial) : null;
      const deleg = de(ref.id).find(esDelegacion);
      lista.push({
        id: `coord:${anexos.map((x) => x.id).join('+')}`, tipo: 'coordinador', escuela: anexos[0], referencia: ref, anexos, contacto: c,
        esDirector: /direct/i.test(c.cargo || '') && !esCoordinador(c),
        nombre: sinAC(c.nombre), celular: c.celular || '', correo: c.correo || (oficial && oficial.correo) || '',
        revista: c.revista || '', aCargo: !!(c.a_cargo || esAC(c.nombre)),
        delegacion: deleg ? deleg.nombre.replace(/^delegaci[oó]n zonal\s*/i, '') : '',
        deps: [...new Set(anexos.map((x) => x.departamento_id))],
      });
    }
    for (const { c, escuelas } of delegaciones.values()) {
      lista.push({
        id: `dz:${c.correo.toLowerCase()}`, tipo: 'delegacion', escuela: null, referencia: null, anexos: [], contacto: c,
        nombre: c.nombre, celular: c.celular || '', correo: c.correo, revista: '', aCargo: false,
        delegacion: c.nombre.replace(/^delegaci[oó]n zonal\s*/i, ''), escuelas,
        deps: [...new Set(escuelas.map((x) => x.departamento_id))],
      });
    }
    // Por delegación zonal, que es como se reparten las notas (pedido del
    // equipo, 06/11/2026), en orden alfabético; la delegación misma, primera
    // en su grupo. Adentro, el orden de la nómina, con cada coordinador detrás
    // de su E.P.E.S. Sin delegación cargada, al final.
    const orden = new Map(d.nominaOrdenada().map((e, i) => [e.id, i]));
    const pos = (r) => (r.tipo === 'delegacion' ? -1 : r.tipo === 'director' ? orden.get(r.escuela.id) || 0 : orden.get(r.anexos[0].id) || 0);
    for (const r of lista) r.grupo = normalizarTexto(r.delegacion || '');
    lista.sort((a, b) => (!a.grupo - !b.grupo) || a.grupo.localeCompare(b.grupo, 'es') || pos(a) - pos(b) || a.nombre.localeCompare(b.nombre));
    cacheDest = lista;
    return lista;
  }
  const porId = (id) => destinatarios().find((r) => r.id === id) || null;
  const nombreDestino = (r) => (r.tipo === 'delegacion' ? r.nombre
    : r.tipo === 'coordinador' ? `Anexos de ${r.referencia.nombre}` : r.escuela.nombre);
  const cargoDe = (r) => (r.tipo === 'coordinador' ? (r.esDirector ? 'Director/a de anexo' : 'Coordinador/a')
    : r.tipo === 'delegacion' ? 'Delegado/a Zonal' : r.tipo === 'anexo' ? 'Director/a de la sede' : 'Director/a');
  const nombreGrupo = (r) => (r.delegacion ? `Delegación zonal ${r.delegacion}` : 'Sin delegación cargada');
  // Las delegaciones que hay, para el filtro: [clave, nombre]
  const delegaciones = () => {
    const m = new Map();
    for (const r of destinatarios()) if (r.grupo && !m.has(r.grupo)) m.set(r.grupo, r.delegacion);
    return [...m];
  };
  // Las filas de una tabla con un título por delegación; titulo(grupo) lo arma cada vista
  function porDelegacion(lista, fila, tituloGrupo) {
    let actual = null;
    return lista.map((r) => {
      const cabeza = r.grupo !== actual ? tituloGrupo(r, lista.filter((x) => x.grupo === r.grupo)) : '';
      actual = r.grupo;
      return cabeza + fila(r);
    }).join('');
  }

  // Sin cargas todavía: la escuela o alguno de sus anexos (para el coordinador)
  function faltaCargar(r) {
    const sin = (e) => { const x = d.escuelaSeg(e.id); return !!(x && !x.escuela.docentes); };
    if (r.tipo === 'director') return sin(r.escuela);
    if (r.tipo === 'coordinador' || r.tipo === 'anexo') return r.anexos.some(sin);
    return false;
  }

  function filtrar(lista) {
    const f = st.filtros;
    const q = normalizarTexto(f.texto || '');
    return lista.filter((r) => (!f.deleg || r.grupo === f.deleg)
      && (!f.dep || r.deps.includes(f.dep))
      && (!f.cargo || r.tipo === f.cargo)
      && (!f.mod || modalidad(r.referencia) === f.mod)
      && (!f.faltan || faltaCargar(r))
      && (!q || normalizarTexto([nombreDestino(r), r.referencia && conDenominacion(r.referencia), r.anexos.map((x) => `${x.nombre} ${x.localidad}`).join(' '),
        r.referencia && r.referencia.localidad, r.nombre, r.celular, r.correo, r.delegacion].join(' ')).includes(q)));
  }

  /* ======================================================================
     La hoja de cada destinatario (port del Distribuidor)
     ====================================================================== */

  function campos(r) {
    const n = st.nota;
    const ref = r.referencia;
    const dep = ref ? Catalogo.departamento(ref.departamento_id) : null;
    return {
      ESCUELA: r.tipo === 'delegacion' ? r.nombre : r.tipo === 'anexo' || r.esDirector ? r.anexos.map((x) => x.nombre).join(', ') : ref.nombre,
      ESCUELA_COMPLETA: r.tipo === 'delegacion' ? r.nombre : r.tipo === 'anexo' || r.esDirector ? r.anexos.map((x) => x.nombre).join(', ') : conDenominacion(ref),
      DIRECTOR: r.nombre ? titulo(r.nombre) : cargoDe(r),
      CARGO: cargoDe(r),
      ANEXOS: r.anexos.map((x) => x.localidad || x.nombre).join(', '),
      LOCALIDAD: ref ? ref.localidad || '' : '',
      DEPARTAMENTO: dep ? dep.nombre : '',
      DELEGACION: r.delegacion || '',
      FECHA: fechaLarga(n.fecha), NRO_NOTA: n.numero, ASUNTO: n.asunto,
    };
  }
  function reemplazar(txt, r, html) {
    const c = campos(r);
    return String(txt || '').replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (m, k) => (k in c ? (html ? esc(c[k]) : c[k]) : m));
  }
  const lemas = () => st.membrete.lemas.split('\n').filter((l) => l.trim()).map(esc).join('<br>');
  const firmaDe = () => ((st.nota.firma || '').trim()
    ? st.nota.firma.split('\n').filter((l) => l.trim())
    : [st.membrete.f1, st.membrete.f2, st.membrete.f3].filter(Boolean));
  const membreteCab = () => `<div class="t-nota__cab"><div class="t-nota__cab-izq"><img src="${LOGO_IZQ}" alt=""></div>
      <div class="t-nota__lemas">${lemas()}</div>
      <div class="t-nota__cab-der"><img src="${LOGO_DER}" alt=""></div></div>`;

  function hojaClasica(r) {
    const m = st.membrete;
    const n = st.nota;
    const ac = r.aCargo ? ' (a cargo)' : '';
    const anexos = campos(r).ANEXOS;
    const dest = r.tipo === 'delegacion'
      ? [`Al/a la ${m.tratD}`, r.nombre]
      : r.tipo === 'anexo' || r.esDirector
        ? [`Al/a la ${m.trat + ac}`, r.anexos.map((x) => x.nombre).join(', '), `Sede: ${conDenominacion(r.referencia)}`, r.nombre ? `${m.prof} ${titulo(r.nombre)}` : '']
      : [`Al/a la ${r.tipo === 'coordinador' && !r.esDirector ? m.tratC + (anexos ? `: ${anexos}` : '') : m.trat + ac}`,
        (r.tipo === 'coordinador' ? 'Escuela de referencia: ' : '') + conDenominacion(r.referencia),
        r.nombre ? `${m.prof} ${titulo(r.nombre)}` : ''];
    const lineas = dest.filter((l) => String(l || '').trim()).map((l) => `<b>${esc(l)}</b>`);
    if (n.dest_extra) lineas.push(`<b>${esc(reemplazar(n.dest_extra, r, false))}</b> S/D.`); else lineas.push('S/D.');
    const y = (n.fecha || '').slice(0, 4) || new Date().getFullYear();
    const nro = n.numero ? (n.numero.includes('/') ? n.numero : `${n.numero} / ${y}`) : `________ / ${y}`;
    // El saludo («De nuestra mayor consideración:») va sin sangría
    const cuerpo = reemplazar(limpiarHTML(n.cuerpo), r, true).replace(/^\s*<p>([^<]{0,60}:)\s*<\/p>/, '<p class="t-nota__saludo">$1</p>');
    return `<div class="t-nota t-nota--clasica">
      <div class="t-nota__cab2"><img src="${LOGO_IZQ}" alt=""><img src="${LOGO_DER}" alt=""></div>
      <div class="t-nota__bloque">${esc(m.ciudad)}, ${esc(fechaLarga(n.fecha))}.-<br>
        <span>${esc(m.prefijoC)} ${esc(nro)}${/d\.?e\.?s/i.test(nro) ? '' : ' – D.E.S.'}</span>
        ${n.asunto ? `<div class="t-nota__ref2">Ref.: ${esc(n.asunto)}</div>` : ''}</div>
      <div class="t-nota__dest2">${lineas.join('<br>')}</div>
      <div class="t-nota__cuerpo">${cuerpo}</div>
      <div class="t-nota__firma2">${m.firmaImg ? `<img src="${esc(m.firmaImg)}" alt="">` : ''}
        ${firmaDe().map((l, i) => (i === 0 ? `<b>${esc(l)}</b>` : esc(l))).join('<br>')}</div>
    </div>`;
  }

  function hojaMultiple(r) {
    const m = st.membrete;
    const n = st.nota;
    const ac = r.aCargo ? ' (a cargo)' : '';
    const anexos = campos(r).ANEXOS;
    const ref = r.referencia;
    const lineas = r.tipo === 'delegacion'
      ? [m.tratD, r.nombre]
      : r.tipo === 'anexo' || r.esDirector
        ? [m.trat + ac, r.anexos.map((x) => x.nombre).join(', '), `Sede: ${conDenominacion(ref)}`, r.nombre ? `${m.prof} ${titulo(r.nombre)}` : '',
          (r.escuela.localidad || '') + (r.delegacion ? ` – Delegación Zonal ${r.delegacion}` : '')]
      : [r.tipo === 'coordinador' && !r.esDirector ? m.tratC + (anexos ? `: ${anexos}` : '') : m.trat + ac,
        (r.tipo === 'coordinador' ? 'Escuela de referencia: ' : '') + conDenominacion(ref),
        r.nombre ? `${m.prof} ${titulo(r.nombre)}` : '',
        (ref.localidad || '') + (r.delegacion ? ` – Delegación Zonal ${r.delegacion}` : '')];
    if (n.dest_extra) lineas.push(reemplazar(n.dest_extra, r, false));
    const [y, mes, dia] = (n.fecha || '').split('-').map(Number);
    const fecha = n.fecha ? `${m.ciudad.toUpperCase()}; ${String(dia).padStart(2, '0')} de ${MESES[mes - 1].toUpperCase()} DE ${y}` : '';
    const propia = (n.firma || '').trim();
    return `<div class="t-nota">
      ${membreteCab()}
      <div class="t-nota__nro">${esc(m.prefijo.replace(/:?\s*$/, ':'))} ${esc(n.numero || '________________')}</div>
      <div class="t-nota__fecha">${esc(fecha)}</div>
      <div class="t-nota__para"><div class="t-nota__de">${esc(m.de)}</div>
        <div class="t-nota__a">A:<br>${lineas.filter((l) => String(l || '').trim()).map(esc).join('<br>')}</div></div>
      <div class="t-nota__cuerpo">${reemplazar(limpiarHTML(n.cuerpo), r, true)}</div>
      <div class="t-nota__firma">${m.firmaImg ? `<img src="${esc(m.firmaImg)}" alt="">` : ''}
        <div class="t-nota__linea">${firmaDe().map((l, i) => (i === 0 && propia ? `<b>${esc(l)}</b>` : esc(l))).join('<br>')}</div></div>
    </div>`;
  }

  // El Anexo 2 de la nota INVOLUCRADOS, con los datos de la escuela completos
  function anexoPlanilla(r) {
    const fila = (k, v) => `<tr><th>${k}</th><td>${esc(v || '')}</td></tr>`;
    const ref = (r.tipo === 'anexo' || r.tipo === 'coordinador') && r.anexos.length === 1 ? r.anexos[0] : r.referencia;
    const dep = ref ? Catalogo.departamento(ref.departamento_id) : null;
    const escuela = r.tipo === 'delegacion' ? '' : `${conDenominacion(ref)}${ref.cue ? ` – CUE: ${ref.cue}` : ' – CUE:'}`;
    const lugar = ref ? [ref.localidad, dep && `departamento ${dep.nombre}`].filter(Boolean).join(' – ') : '';
    return `<div class="t-nota t-nota--anexo">
      ${membreteCab()}
      <div class="t-nota__banda"><small>ANEXO 2</small>Planilla de la escuela</div>
      <p class="t-nota__gris">Una por institución. El referente ESI completa una línea por cada ficha de implementación recibida y eleva la planilla en cada corte.</p>
      <h3>Encabezado</h3>
      <table class="t-nota__enc">${fila('Escuela y CUE', escuela)}${fila('Localidad y departamento', lugar)}
        ${fila('Referente ESI y contacto', '')}${fila('Director/a', r.tipo === 'director' || r.tipo === 'anexo' || r.esDirector ? titulo(r.nombre) : '')}${fila('Corte al que corresponde', '1° corte')}</table>
      <h3>Registro de implementaciones</h3>
      <table class="t-nota__reg"><tr><th>Fecha</th><th>Docente</th><th>Espacio curricular</th><th>Curso y año</th><th>Actividad</th><th>Fichas recibidas</th><th>¿Adjunta evidencia?</th><th>¿Ficha visada?</th></tr>
        ${'<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>'.repeat(9)}</table>
      <p class="t-nota__gris">Ciclo: Básico / Orientado / Ambos. Fichas recibidas: cantidad total en el período.</p>
      <div class="t-nota__firmas"><div>Referente ESI institucional</div><div>Director/a (firma y sello)</div></div>
    </div>`;
  }

  const hojas = (r) => `<div class="t-nota__pliego">${st.nota.formato === 'multiple' ? hojaMultiple(r) : hojaClasica(r)}${st.nota.anexo === 'planilla' ? anexoPlanilla(r) : ''}</div>`;
  const archivoDe = (r) => `Nota ${st.nota.numero ? `${limpioArchivo(st.nota.numero)} - ` : ''}${limpioArchivo(nombreDestino(r))}${r.tipo === 'coordinador' ? ` - ${limpioArchivo(titulo(r.nombre))}` : ''}.pdf`;
  const mensajeDe = (r) => reemplazar(st.nota.mensaje || MENSAJE_INICIAL, r, false);

  async function pdfDe(r) {
    await cargarScript(URL_HTML2PDF, 'html2pdf');
    const caja = document.createElement('div');
    caja.className = 't-nota-render';
    caja.innerHTML = hojas(r);
    // La librería copia la hoja a otro lado para dibujarla: la clase va en la
    // hoja misma, no en la caja (si no, cada hoja mide una A4 entera y la
    // suma se pasa a una tercera página en blanco)
    caja.firstElementChild.classList.add('t-nota__pliego--pdf');
    document.body.appendChild(caja);
    try {
      await Promise.all([...caja.querySelectorAll('img')].map((i) => (i.complete ? null : new Promise((ok) => { i.onload = ok; i.onerror = ok; }))));
      return await window.html2pdf().set({
        margin: 0, image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }, pagebreak: { mode: ['css', 'legacy'] },
      }).from(caja.firstElementChild).outputPdf('blob');
    } finally {
      caja.remove();
    }
  }

  /* ======================================================================
     Enviar
     ====================================================================== */

  const celularWa = (c) => (c && c.length === 10 ? `549${c}` : (c || '').replace(/^0+/, ''));
  const enviada = (id) => { const m = st.nota && st.envios.get(st.nota.id); return (m && m.get(id)) || null; };
  const elegidos = () => destinatarios().filter((r) => st.nota.destinatarios.has(r.id));

  async function enviar(id, canal) {
    const r = porId(id);
    if (!r || st.enviando) return;
    // El aviso va en la fila de esa escuela, al lado de sus botones: arriba de
    // todo quedaba lejos de donde se tocó
    const decir = (texto, error) => { st.aviso = { texto, error: !!error, id }; };
    if (canal === 'whatsapp' && !r.celular) { decir('No tiene celular cargado. Agregalo desde su ficha (tocando el nombre de la escuela) o mandala por correo.', true); d.render(); return; }
    if (canal === 'correo' && !r.correo) { decir('No tiene correo cargado. Agregalo desde su ficha (tocando el nombre de la escuela).', true); d.render(); return; }
    const telefono = d.conElTelefono();
    // La ventana se abre en el mismo toque, antes de cualquier espera (si no,
    // el navegador la bloquea), y se carga cuando el PDF ya bajó
    const ventana = canal === 'pdf' || canal === 'compartir' || (telefono && canal === 'whatsapp') ? null : window.open('about:blank', '_blank');
    // Mandarle desde «A quién» también la deja elegida: así cuenta en «Enviar» y en el registro
    if (canal !== 'pdf' && !st.nota.destinatarios.has(id)) { st.nota.destinatarios.add(id); st.sucio = true; }
    if (!(await guardar())) { if (ventana) ventana.close(); d.render(); return; }
    st.enviando = id;
    decir('Armando el PDF…');
    d.render();
    let blob;
    try {
      blob = await pdfDe(r);
    } catch (e) {
      if (ventana) ventana.close();
      st.enviando = null;
      decir((e && e.message) || 'No se pudo armar el PDF. Volvé a intentar.', true);
      d.render();
      return;
    }
    const archivo = archivoDe(r);
    const texto = mensajeDe(r);
    st.enviando = null;
    if (canal === 'compartir') {
      try {
        const f = new File([blob], archivo, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [f] })) {
          await navigator.share({ files: [f], text: texto, title: st.nota.asunto || st.nota.titulo });
          await marcar(id, 'whatsapp');
          decir('Listo: quedó como enviada.');
          d.render();
          return;
        }
      } catch (e) {
        if (e && e.name === 'AbortError') { st.aviso = null; d.render(); return; }
      }
      bajar(blob, archivo);
      decir(`Este celular no deja compartir el PDF: se bajó «${archivo}». Mandalo desde WhatsApp.`);
      d.render();
      return;
    }
    bajar(blob, archivo);
    if (canal === 'pdf') { decir(`Se bajó «${archivo}».`); d.render(); return; }
    let url;
    if (canal === 'whatsapp') {
      url = telefono ? `whatsapp://send?phone=${celularWa(r.celular)}&text=${encodeURIComponent(texto)}`
        : `https://wa.me/${celularWa(r.celular)}?text=${encodeURIComponent(texto)}`;
    } else {
      url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(r.correo)}&su=${encodeURIComponent(`${st.nota.asunto || 'Nota DES'} – ${nombreDestino(r)}`)}&body=${encodeURIComponent(`${texto}\n\n(Adjuntar: ${archivo})`)}`;
    }
    if (ventana) ventana.location.href = url; else window.location.href = url;
    await marcar(id, canal);
    decir(canal === 'whatsapp'
      ? `Se bajó «${archivo}» y se abrió el chat de ${r.nombre ? titulo(r.nombre) : nombreDestino(r)}. Arrastrá el PDF al chat y mandá.`
      : `Se bajó «${archivo}» y se abrió Gmail para ${r.correo}. Adjuntá el PDF y mandá.`);
    d.render();
  }

  // Los botones para mandarle a un destinatario, en «A quién» y en «Enviar»,
  // con lo que pasó con el último envío debajo
  const CANALES = { whatsapp: 'por WhatsApp', correo: 'por correo', a_mano: 'marcada a mano' };
  function botonesMandar(r, completo) {
    const ocupado = !!(st.enviando || st.lote);
    const id = esc(r.id);
    const principal = d.conElTelefono() && d.puedeCompartir()
      ? `<button type="button" class="t-ficha__si" data-accion="nt-enviar" data-canal="compartir" data-id="${id}" ${ocupado ? 'disabled' : ''}>Compartir</button>`
      : `<button type="button" class="t-ficha__si" data-accion="nt-enviar" data-canal="whatsapp" data-id="${id}" ${ocupado || !r.celular ? 'disabled' : ''} title="${r.celular ? 'Baja el PDF y abre el chat con el mensaje escrito' : 'Sin celular cargado'}">WhatsApp</button>`;
    const e = enviada(r.id);
    const av = st.aviso && st.aviso.id === r.id ? st.aviso : null;
    return `<div class="t-notas__mandar">
        ${principal}
        <button type="button" class="t-ficha__si t-notas__claro" data-accion="nt-enviar" data-canal="correo" data-id="${id}" ${ocupado || !r.correo ? 'disabled' : ''} title="${r.correo ? 'Baja el PDF y abre Gmail con el mensaje escrito' : 'Sin correo cargado'}">Correo</button>
        ${completo ? `<button type="button" class="t-ficha__enlace" data-accion="nt-enviar" data-canal="pdf" data-id="${id}" ${ocupado ? 'disabled' : ''}>PDF</button>` : ''}
        <button type="button" class="t-ficha__enlace" data-accion="nt-previa" data-id="${id}">Ver</button>
      </div>
      ${!completo && e ? `<span class="t-notas__ya"><strong>Enviada</strong> ${esc(CANALES[e.canal] || '')} · ${esc(cuandoEnvio(e.enviado_en))}</span>` : ''}
      ${av ? `<p class="t-notas__aviso-fila ${av.error ? 't-notas__aviso-fila--error' : ''}" role="${av.error ? 'alert' : 'status'}">${esc(av.texto)}</p>` : ''}`;
  }

  async function zip() {
    const lista = elegidos();
    if (!lista.length || st.lote) return;
    if (!(await guardar())) { d.render(); return; }
    try {
      await cargarScript(URL_JSZIP, 'JSZip');
      const z = new window.JSZip();
      for (let i = 0; i < lista.length; i++) {
        st.lote = `Armando ${i + 1} de ${lista.length}…`;
        d.render();
        z.file(archivoDe(lista[i]), await pdfDe(lista[i]));
      }
      st.lote = 'Comprimiendo…';
      d.render();
      bajar(await z.generateAsync({ type: 'blob' }), `Notas ${st.nota.numero ? `${limpioArchivo(st.nota.numero)} ` : ''}DES (${lista.length}).zip`);
      st.aviso = { texto: `Se bajó un ZIP con las ${numero(lista.length)} notas.` };
    } catch (e) {
      st.aviso = { texto: (e && e.message) || 'No se pudo armar el ZIP.', error: true };
    }
    st.lote = null;
    d.render();
  }

  async function registro() {
    const n = st.nota;
    try { await d.cargarSheetJS(); } catch (e) { st.aviso = { texto: e.message, error: true }; d.render(); return; }
    const canal = { whatsapp: 'WhatsApp', correo: 'Correo', a_mano: 'Marcada a mano' };
    const filas = elegidos().map((r) => {
      const e = enviada(r.id);
      return {
        Nota: n.numero, Asunto: n.asunto, Delegación: r.delegacion, Escuela: r.referencia ? conDenominacion(r.referencia) : r.nombre,
        Anexos: r.anexos.map((x) => x.nombre).join(', '), Localidad: r.referencia ? r.referencia.localidad : '',
        Cargo: cargoDe(r), 'Destinatario/a': r.tipo === 'delegacion' ? '' : titulo(r.nombre), Celular: r.celular, Correo: r.correo,
        Estado: e ? 'ENVIADA' : 'PENDIENTE', 'Por dónde': e ? canal[e.canal] || e.canal : '',
        Cuándo: e ? new Date(e.enviado_en).toLocaleString('es-AR') : '',
      };
    });
    const X = window.XLSX;
    const libro = X.utils.book_new();
    const hoja = X.utils.json_to_sheet(filas);
    hoja['!cols'] = Object.keys(filas[0] || { a: 1 }).map(() => ({ wch: 22 }));
    X.utils.book_append_sheet(libro, hoja, 'Registro');
    X.writeFile(libro, `Registro de envío ${limpioArchivo(n.numero || n.titulo)} ${hoyISO()}.xlsx`);
  }

  function imprimirTodas() {
    const lista = elegidos();
    if (!lista.length) return;
    d.imprimir(`<div class="t-doc t-doc--notas">${lista.map(hojas).join('')}</div>`, `Notas ${st.nota.numero || st.nota.titulo}`);
  }

  // Un Word que ya trae fecha, número, Ref. y destinatario: queda solo el
  // texto, y se aprovechan esos datos
  const INICIO = /^(de (nuestra|mi) (mayor )?consideraci|me dirijo|tengo el (agrado|honor)|por (medio de )?la presente|por intermedio de la presente)/i;
  const CIERRE = /(atentamente|saluda? (a ud|muy)|sin otro particular)/i;
  function limpiarDocx(html) {
    const ps = [...new DOMParser().parseFromString(html, 'text/html').body.children];
    const txt = (el) => el.textContent.replace(/\s+/g, ' ').trim();
    const ini = ps.findIndex((p) => INICIO.test(txt(p)));
    const r = { cuerpo: html, datos: [] };
    if (ini <= 0) return r;
    const antes = ps.slice(0, ini).map(txt);
    if (!antes.some((t) => /nota\s*n|ref\.|director|e\.?p\.?e\.?s/i.test(t))) return r;
    const ref = antes.find((t) => /^ref\.?\s*:/i.test(t));
    if (ref) { r.asunto = ref.replace(/^ref\.?\s*:\s*/i, ''); r.datos.push('la referencia'); }
    const extra = antes.find((t) => /^por su intermedio/i.test(t));
    if (extra) { r.destExtra = extra.replace(/\s*S\.?\s*\/\s*D\.?\s*$/i, '').trim(); r.datos.push('el renglón del destinatario'); }
    let fin = ps.length - 1;
    for (let i = ps.length - 1; i >= ini; i--) if (CIERRE.test(txt(ps[i]))) { fin = i; break; }
    const resto = ps.slice(fin + 1).map(txt).filter(Boolean);
    if (fin < ps.length - 1 && resto.length && resto.length <= 5) { r.firma = resto.join('\n'); r.datos.push('la firma'); }
    r.cuerpo = ps.slice(ini, fin + 1).map((p) => p.outerHTML).join('');
    return r;
  }

  async function subirWord(archivo) {
    const n = st.nota;
    try {
      if (/\.docx$/i.test(archivo.name)) {
        await cargarScript(URL_MAMMOTH, 'mammoth');
        const r = await window.mammoth.convertToHtml({ arrayBuffer: await archivo.arrayBuffer() });
        const l = limpiarDocx(r.value);
        n.cuerpo = limpiarHTML(l.cuerpo);
        if (l.asunto) n.asunto = l.asunto;
        if (l.destExtra) n.dest_extra = l.destExtra;
        if (l.firma) n.firma = l.firma;
        st.aviso = { texto: l.datos.length ? `Se cargó el texto del Word, y también ${l.datos.join(', ')}. El encabezado de cada escuela se arma solo: revisá que el texto haya quedado bien.` : 'Se cargó el texto del Word. Revisá que haya quedado bien.' };
      } else {
        n.cuerpo = (await archivo.text()).split(/\n\s*\n/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
        st.aviso = { texto: 'Se cargó el texto. Revisá que haya quedado bien.' };
      }
      marcarSucio();
    } catch (e) {
      st.aviso = { texto: 'No se pudo leer ese archivo. Tiene que ser un Word (.docx) o un texto (.txt).', error: true };
    }
    d.render();
  }

  /* ======================================================================
     La base de directivos: leer, cotejar, cargar
     ====================================================================== */

  // Lo que no distingue un anexo de otro: «AEIB», «Cnia.», «Paraje»…
  const VACIAS_ANEXO = new Set(['aeib', 'aer', 'eib', 'anexo', 'de', 'del', 'la', 'el', 'los', 'las', 'b', 'bo', 'barrio', 'gral', 'general',
    'col', 'cnia', 'colonia', 'co', 'paraje', 'pje', 'educacion', 'rural', 'intercultural', 'bilingue', 'agraria', 'agrario', 'epes', 'n', 'e', 'p', 's', 'y']);
  const raiz = (w) => w.replace(/^(\d+)(ro|ra|do|da|to|ta|er|o|a)$/, '$1').replace(/s$/, '');
  const palabrasAnexo = (t) => normalizarTexto(t).split(' ').filter((w) => w && !VACIAS_ANEXO.has(w)).map(raiz);
  // «A/C Gonzalez Marcelino» y «Gonzalez, Marcelino» son la misma persona
  const claveNombre = (t) => normalizarTexto(String(t || '').replace(/^\s*a\s*\/\s*c\s+/i, '')).split(' ').filter(Boolean).sort().join(' ');

  function limpiarCelular(v) {
    let c = String(v || '').replace(/\D/g, '');
    if (c.startsWith('54')) c = c.slice(2);
    if (c.length === 11 && c.startsWith('9')) c = c.slice(1);
    return c.replace(/^0+/, '');
  }

  function idDeEscuela(texto, num) {
    const t = normalizarTexto(texto);
    const n = String(num || '').replace(/\D/g, '') || (t.match(/\d+/) || [])[0];
    if (!n) return null;
    const id = (/\beib\b/.test(t) ? 'epes-eib-' : /agrari/.test(t) ? 'epes-agraria-' : 'epes-') + n;
    return Catalogo.escuela(id) ? id : null;
  }

  function buscarAnexo(token, sedeId) {
    const w = palabrasAnexo(token);
    if (!w.length) return null;
    const anexos = d.nominaOrdenada().filter(d.esAnexo);
    const contiene = (x) => { const p = new Set(palabrasAnexo(`${x.nombre} ${x.localidad}`)); return w.every((q) => p.has(q)); };
    const unico = (lista) => {
      const m = lista.filter(contiene);
      if (m.length === 1) return m[0];
      const exacto = m.filter((x) => palabrasAnexo(x.localidad).join(' ') === w.join(' '));
      return exacto.length === 1 ? exacto[0] : null;
    };
    if (sedeId) {
      const propios = anexos.filter((x) => { const s = d.sedeDe(x.id); return s && s.id === sedeId; });
      const m = unico(propios);
      if (m) return m;
    }
    return unico(anexos);
  }

  function leerBase(libro, nombreArchivo) {
    const X = window.XLSX;
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const filas = X.utils.sheet_to_json(hoja, { header: 1, defval: '' });
    const hi = filas.findIndex((f) => f.some((c) => /director/i.test(String(c))));
    if (hi < 0) throw new Error('No encontramos las columnas. La planilla tiene que tener, al menos, Escuela, Director/a y Celular.');
    const cab = filas[hi].map((c) => normalizarTexto(String(c)));
    const col = (re) => cab.findIndex((c) => re.test(c));
    const ix = {
      cargo: col(/^cargo/), escuela: col(/^escuela|^epes/), numero: col(/^numero$|^nro/), nombre: col(/^nombre/),
      localidad: col(/^localidad/), anexos: col(/^anexo/), direccion: col(/^direccion$|^domicilio/),
      persona: col(/director/), revista: col(/revista|^sit/), celular: col(/celular|telefono/), correo: col(/correo|mail/),
    };
    if (ix.escuela < 0 || ix.persona < 0) throw new Error('No encontramos las columnas Escuela y Director/a en la primera hoja.');
    const g = (f, k) => (ix[k] >= 0 ? String(f[ix[k]] == null ? '' : f[ix[k]]).replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim() : '');

    const contactos = [];       // { escuela_id, nombre, cargo, celular, correo, revista, a_cargo, fila }
    const escuelas = new Map(); // id → { id, denominacion, direccion }
    const pendientes = [];      // lo que no se reconoció: el equipo elige cuál es
    let delegaciones = 0;
    filas.slice(hi + 1).forEach((f, i) => {
      const fila = hi + i + 2;
      const escuelaTexto = g(f, 'escuela');
      if (!escuelaTexto) return;
      const cargo = normalizarTexto(g(f, 'cargo'));
      if (/delega/.test(cargo) || /^delegacion/.test(normalizarTexto(escuelaTexto))) { delegaciones += 1; return; }
      const crudo = g(f, 'persona');
      const base = {
        nombre: titulo(crudo.replace(/^A\/C\s+/i, '')), celular: limpiarCelular(g(f, 'celular')),
        correo: g(f, 'correo').toLowerCase(), revista: g(f, 'revista'), a_cargo: /^A\/C\s+/i.test(crudo), fila,
      };
      const sedeId = idDeEscuela(escuelaTexto, g(f, 'numero'));
      if (/coord/.test(cargo)) {
        const tokens = g(f, 'anexos').split(/,|;|\/| y /).map((t) => t.trim()).filter(Boolean);
        for (const t of tokens) {
          const anexo = buscarAnexo(t, sedeId);
          const c = { ...base, cargo: 'Coordinador/a de anexos', correo: '' };
          if (anexo) contactos.push({ ...c, escuela_id: anexo.id });
          else pendientes.push({ clave: `p${pendientes.length}`, contacto: c, texto: t, de: escuelaTexto, sedeId, tipo: 'anexo' });
        }
        return;
      }
      const c = { ...base, cargo: 'Director/a' };
      if (!sedeId) { pendientes.push({ clave: `p${pendientes.length}`, contacto: c, texto: escuelaTexto, de: g(f, 'localidad'), sedeId: null, tipo: 'escuela' }); return; }
      contactos.push({ ...c, escuela_id: sedeId });
      const den = g(f, 'nombre');
      escuelas.set(sedeId, { id: sedeId, denominacion: /^s\/?n$/i.test(den) ? '' : den, direccion: g(f, 'direccion') });
    });
    return { archivo: nombreArchivo, contactos, escuelas, pendientes, delegaciones, elegidas: new Map() };
  }

  // Cómo quedaría cada escuela si se carga: igual, cambia, nueva, o corregida
  // por el equipo (no se toca)
  function cotejar(b) {
    const todos = d.contactos() || new Map();
    const filas = b.contactos.concat(b.pendientes.filter((p) => b.elegidas.get(p.clave)).map((p) => ({ ...p.contacto, escuela_id: b.elegidas.get(p.clave) })));
    const porEscuela = new Map();
    for (const c of filas) {
      if (!porEscuela.has(c.escuela_id)) porEscuela.set(c.escuela_id, []);
      porEscuela.get(c.escuela_id).push(c);
    }
    const r = { filas, iguales: [], cambian: [], nuevas: [], respetadas: [], afuera: [], nombres: [], celulares: [], sinCelular: [] };
    const desc = (c) => [c.nombre ? titulo(c.nombre) : 'Sin nombre', c.celular ? d.celularLegible(c.celular) : 'sin celular'].join(' · ');
    const firma = (lista) => lista.map((c) => `${claveNombre(c.nombre)}|${c.celular || ''}`).sort().join('#');
    for (const [id, nuevos] of porEscuela) {
      const e = Catalogo.escuela(id);
      const actuales = (todos.get(id) || []).filter((c) => persona(c) && c.origen !== 'correos_oficiales');
      const item = { id, escuela: e, antes: actuales.map(desc), despues: nuevos.map(desc) };
      if (actuales.some((c) => c.origen === 'panel')) r.respetadas.push(item);
      else if (!actuales.length) r.nuevas.push(item);
      else if (firma(actuales) === firma(nuevos)) r.iguales.push(item);
      else r.cambian.push(item);
    }
    for (const [id, lista] of todos) {
      if (!porEscuela.has(id) && lista.some((c) => c.origen === 'planilla_directivos' || c.origen === 'base_directivos')) r.afuera.push(Catalogo.escuela(id) || { id, nombre: id });
    }
    for (const x of b.escuelas.values()) {
      if (x.denominacion && !((st.escuelasDb.get(x.id) || {}).denominacion)) r.nombres.push(x);
    }
    for (const c of filas) {
      if (!c.celular) r.sinCelular.push(c);
      else if (c.celular.length !== 10) r.celulares.push(c);
    }
    const porNombre = (a, b2) => ((a.escuela && a.escuela.orden) || 0) - ((b2.escuela && b2.escuela.orden) || 0);
    ['iguales', 'cambian', 'nuevas', 'respetadas'].forEach((k) => r[k].sort(porNombre));
    return r;
  }

  async function elegirBase(archivo) {
    st.base = { leyendo: true, archivo: archivo.name };
    st.errorModal = null;
    d.render();
    try {
      await d.cargarSheetJS();
      const libro = window.XLSX.read(await archivo.arrayBuffer());
      st.base = leerBase(libro, archivo.name);
      if (!st.base.contactos.length && !st.base.pendientes.length) throw new Error('La planilla no trae ningún director ni coordinador.');
    } catch (e) {
      st.base = null;
      st.errorModal = (e && e.message) || 'No se pudo leer la planilla. Tiene que ser un Excel (.xlsx).';
    }
    d.render();
  }

  async function cargarBase() {
    const b = st.base;
    const r = cotejar(b);
    st.guardandoModal = true;
    st.errorModal = null;
    d.render();
    const { data, error } = await sb.rpc('cargar_directivos', {
      p_filas: r.filas.map(({ fila, ...c }) => c),
      p_escuelas: [...b.escuelas.values()],
    });
    st.guardandoModal = false;
    if (error || (data && data.error)) {
      st.errorModal = (data && data.error) || (/function|schema cache/i.test((error && error.message) || '')
        ? 'La base todavía no tiene la función para cargar la planilla: falta correr sql/18_notas.sql en Supabase.'
        : 'No se pudo cargar. Revisá la conexión y volvé a intentar.');
      d.render();
      return;
    }
    await d.recargarContactos();
    st.escuelasDb = await traerEscuelasDb();
    cacheDest = null;
    st.base = { hecho: data, archivo: b.archivo };
    d.render();
  }

  /* ======================================================================
     Pantallas
     ====================================================================== */

  function cabeza() {
    const n = st.nota;
    const enNota = n && st.paso !== 'lista';
    const solapa = (paso, texto) => `<button type="button" class="t-vista ${st.paso === paso ? 't-vista--activa' : ''}" data-accion="nt-paso" data-paso="${paso}" aria-pressed="${st.paso === paso}">${texto}</button>`;
    const env = n && st.envios.get(n.id);
    const cuantas = n ? elegidos().filter((r) => env && env.has(r.id)).length : 0;
    return `<div class="t-notas__cabeza">
      <div class="t-notas__arriba">
        <button type="button" class="t-seg-enlace" data-accion="${enNota ? 'nt-lista' : 'nt-salir'}">← ${enNota ? 'Todas las notas' : 'Seguimiento'}</button>
        <div class="t-notas__herramientas">
          <button type="button" class="t-seg-enlace" data-accion="nt-modal" data-modal="contactos">Actualizar contactos (Excel)</button>
          <button type="button" class="t-seg-enlace" data-accion="nt-modal" data-modal="membrete">Membrete y firma</button>
        </div>
      </div>
      <h1 class="t-notas__titulo">${enNota ? esc(n.titulo || 'Nota sin nombre') : 'Notas a las escuelas'}</h1>
      ${enNota ? `<div class="t-notas__pasos">
        <div class="t-vistas">
          ${solapa('redactar', '1 · Redactar')}
          ${solapa('destinatarios', `2 · A quién (${numero(n.destinatarios.size)})`)}
          ${solapa('enviar', `3 · Enviar (${numero(cuantas)} de ${numero(n.destinatarios.size)})`)}
        </div>
        <span class="t-notas__guardado" id="nt-guardado" role="status">${esc(st.estadoGuardado)}</span>
      </div>` : ''}
    </div>`;
  }

  function vistaLista() {
    const notas = (st.lista || []).filter((n) => !!n.archivada === st.verArchivadas);
    const archivadas = (st.lista || []).filter((n) => n.archivada).length;
    const item = (n) => {
      const env = st.envios.get(n.id);
      const dest = (n.destinatarios || []).length;
      const hechas = env ? (n.destinatarios || []).filter((x) => env.has(x)).length : 0;
      const datos = [n.asunto, n.numero && `Nota N° ${n.numero}`, n.fecha && fechaLarga(n.fecha)].filter(Boolean).map(esc).join(' · ');
      return `<li class="t-notas__item">
        <div class="t-notas__item-texto">
          <button type="button" class="t-seg-enlace t-notas__item-titulo" data-accion="nt-abrir" data-id="${n.id}">${esc(n.titulo)}</button>
          ${datos ? `<span>${datos}</span>` : ''}
          <span class="t-notas__item-avance">${dest ? `Enviada a ${numero(hechas)} de ${numero(dest)} ${plural(dest, 'destinatario', 'destinatarios')}` : 'Sin destinatarios elegidos'} · cambiada ${esc(d.cuandoFue(new Date(n.actualizada_en).getTime()))}</span>
        </div>
        <div class="t-notas__item-acciones">
          ${n.archivada
            ? `<button type="button" class="t-ficha__enlace" data-accion="nt-archivar" data-id="${n.id}" data-valor="0">Restaurar</button>`
            : `<button type="button" class="t-ficha__enlace" data-accion="nt-duplicar" data-id="${n.id}" title="Una nota nueva con este texto, sin número ni destinatarios enviados">Usar de base</button>
               <button type="button" class="t-ficha__enlace" data-accion="nt-archivar" data-id="${n.id}" data-valor="1">Archivar</button>`}
        </div>
      </li>`;
    };
    return `<div class="t-contexto">
        <div class="t-contexto__texto">Una nota se escribe una vez y sale una hoja por escuela, con su director o el coordinador de sus anexos. Lo que ya se mandó queda marcado para todo el equipo.</div>
        <button type="button" class="t-exportar" data-accion="nt-nueva">+ Nota nueva</button>
      </div>
      ${st.error ? `<p class="t-ficha__error" role="alert">${esc(st.error)}</p>` : ''}
      ${notas.length ? `<ul class="t-notas__lista">${notas.map(item).join('')}</ul>`
        : `<p class="t-seg-vacia">${st.verArchivadas ? 'No hay notas archivadas.' : 'Todavía no hay notas. Empezá con «+ Nota nueva».'}</p>`}
      ${archivadas || st.verArchivadas ? `<button type="button" class="t-seg-enlace t-notas__archivadas" data-accion="nt-ver-archivadas">${st.verArchivadas ? 'Volver a las notas' : `Ver las archivadas (${numero(archivadas)})`}</button>` : ''}`;
  }

  function vistaRedactar() {
    const n = st.nota;
    const m = st.membrete;
    const opcion = (valor, tituloOp, sub) => `<label class="t-opcion ${n.formato === valor ? 't-opcion--elegida' : ''}">
        <input type="radio" name="formato" value="${valor}" data-cambio="nt-campo" ${n.formato === valor ? 'checked' : ''}>
        <span><span class="t-opcion__titulo">${tituloOp}</span><span class="t-opcion__sub">${sub}</span></span></label>`;
    return `<div class="t-notas__redactar">
      ${aviso()}
      <section class="t-notas__bloque">
        <div class="t-notas__grilla">
          <label class="t-ficha__campo t-notas__ancho"><span>Nombre de la nota <em>(para encontrarla en la lista; no sale impreso)</em></span>
            <input id="nt-titulo" name="titulo" type="text" value="${esc(n.titulo)}" data-entrada="nt-campo" autocomplete="off"></label>
          <label class="t-ficha__campo"><span>Número de nota</span><input name="numero" type="text" value="${esc(n.numero)}" placeholder="Ej.: 145/2026" data-entrada="nt-campo" autocomplete="off"></label>
          <label class="t-ficha__campo"><span>Fecha</span><input name="fecha" type="date" value="${esc(n.fecha)}" data-entrada="nt-campo"></label>
          <label class="t-ficha__campo t-notas__ancho"><span>Referencia <em>(también es el asunto del correo)</em></span><input name="asunto" type="text" value="${esc(n.asunto)}" placeholder="Ej.: Convocatoria a jornada institucional" data-entrada="nt-campo" autocomplete="off"></label>
        </div>
        <div class="t-notas__formatos" role="radiogroup" aria-label="Formato de la nota">
          ${opcion('clasica', 'Carta', 'Fecha y número a la derecha, el destinatario en negrita y S/D.')}
          ${opcion('multiple', 'Nota múltiple', 'Las leyendas del año y el cuadro «DE LA: / A:» de la nota modelo.')}
        </div>
        <label class="t-notas__casilla"><input type="checkbox" name="anexo" data-cambio="nt-campo" ${n.anexo === 'planilla' ? 'checked' : ''}>
          Sumar el <strong>Anexo 2 – Planilla de la escuela</strong> como segunda hoja, con los datos de cada escuela</label>
        <div class="t-notas__grilla">
          <label class="t-ficha__campo t-notas__ancho"><span>Renglón más para el destinatario <em>(opcional)</em></span><input name="dest_extra" type="text" value="${esc(n.dest_extra)}" placeholder="Ej.: Por su intermedio, a los/las Referentes ESI" data-entrada="nt-campo" autocomplete="off"></label>
          <label class="t-ficha__campo t-notas__ancho"><span>Firma de esta nota <em>(si queda vacía, va la del membrete: ${esc([m.f1, m.f2].filter(Boolean).join(', '))})</em></span>
            <textarea name="firma" rows="3" data-entrada="nt-campo" placeholder="Lic. Nombre Apellido&#10;Director/a de Educación Secundaria&#10;Ministerio de Cultura y Educación">${esc(n.firma)}</textarea></label>
        </div>
      </section>
      <section class="t-notas__bloque">
        <div class="t-notas__rotulo-linea">
          <h2 class="t-seg-titulo">El texto</h2>
          <label class="t-seg-enlace t-notas__subir">Subir un Word (.docx)<input type="file" accept=".docx,.txt" data-cambio="nt-word" hidden></label>
        </div>
        <p class="t-seg-nota">El encabezado (la escuela, su director, el número y la fecha) se arma solo para cada destinatario. Para nombrar la escuela dentro del texto, tocá un campo:</p>
        <div class="t-notas__campos">${CAMPOS.map(([c, ayuda]) => `<button type="button" class="t-notas__campo" data-accion="nt-insertar" data-campo="${c}" title="${esc(ayuda)}">{{${c}}}</button>`).join('')}</div>
        <div class="t-notas__herramientas-texto" role="toolbar" aria-label="Formato del texto">
          <button type="button" data-accion="nt-formato" data-cmd="bold" title="Negrita"><b>N</b></button>
          <button type="button" data-accion="nt-formato" data-cmd="italic" title="Cursiva"><i>C</i></button>
          <button type="button" data-accion="nt-formato" data-cmd="underline" title="Subrayado"><u>S</u></button>
          <button type="button" data-accion="nt-formato" data-cmd="insertUnorderedList">• Lista</button>
          <button type="button" data-accion="nt-formato" data-cmd="insertOrderedList">1. Lista</button>
          <button type="button" data-accion="nt-formato" data-cmd="removeFormat">Sacar el formato</button>
        </div>
        <div class="t-notas__editor" id="nt-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Texto de la nota" data-entrada="nt-cuerpo">${limpiarHTML(n.cuerpo)}</div>
      </section>
      <section class="t-notas__bloque">
        <label class="t-ficha__campo"><span>Mensaje que acompaña el PDF (WhatsApp y correo) <em>— también admite los campos</em></span>
          <textarea id="nt-mensaje" name="mensaje" rows="4" data-entrada="nt-campo">${esc(n.mensaje)}</textarea></label>
      </section>
      <div class="t-notas__pie">
        <button type="button" class="t-exportar t-exportar--claro" data-accion="nt-previa">Ver cómo queda</button>
        <button type="button" class="t-exportar" data-accion="nt-paso" data-paso="destinatarios">Siguiente: a quién →</button>
      </div>
    </div>`;
  }

  function aviso() {
    if (st.conflicto) {
      return `<div class="t-notas__aviso t-notas__aviso--error" role="alert">Otra persona del equipo cambió esta nota mientras la tenías abierta, y no se guardó lo tuyo.
        <button type="button" class="t-ficha__enlace" data-accion="nt-recargar">Volver a abrirla</button></div>`;
    }
    if (!st.aviso || st.aviso.id) return '';
    return `<div class="t-notas__aviso ${st.aviso.error ? 't-notas__aviso--error' : ''}" role="${st.aviso.error ? 'alert' : 'status'}">${esc(st.aviso.texto)}</div>`;
  }

  function sinContactos() {
    return d.contactos() ? '' : '<div class="t-notas__aviso t-notas__aviso--error" role="alert">Los contactos de las escuelas todavía no están en la base: sin ellos no hay a quién mandar. Avisale a quien administra el sistema.</div>';
  }

  function vistaDestinatarios() {
    const n = st.nota;
    const f = st.filtros;
    const todos = destinatarios();
    const vis = filtrar(todos);
    const cuenta = (t) => todos.filter((r) => r.tipo === t && n.destinatarios.has(r.id)).length;
    const opcion = (v, t, actual) => `<option value="${esc(v)}" ${actual === v ? 'selected' : ''}>${esc(t)}</option>`;
    const fila = (r) => {
      const ref = r.referencia;
      const escuela = r.tipo === 'delegacion'
        ? `<strong>${esc(r.nombre)}</strong><span>${numero(r.escuelas.length)} ${plural(r.escuelas.length, 'escuela', 'escuelas')}</span>`
        : r.tipo === 'anexo'
          ? `<button type="button" class="t-seg-enlace" data-ficha="${esc(r.escuela.id)}" data-accion="abrir-ficha" data-id="${esc(r.escuela.id)}">${esc(r.escuela.nombre)}</button><span>Anexo de ${esc(ref.nombre)} · sin contacto propio: le llega al director de la sede</span>`
        : r.tipo === 'coordinador'
          ? `<button type="button" class="t-seg-enlace" data-ficha="${esc(r.escuela.id)}" data-accion="abrir-ficha" data-id="${esc(r.escuela.id)}">${esc(r.anexos.map((x) => x.localidad || x.nombre).join(', '))}</button><span>Anexos de ${esc(ref.nombre)}</span>`
          : `<button type="button" class="t-seg-enlace" data-ficha="${esc(ref.id)}" data-accion="abrir-ficha" data-id="${esc(ref.id)}">${esc(ref.nombre)}</button><span>${esc([ref.localidad, (Catalogo.departamento(ref.departamento_id) || {}).nombre].filter(Boolean).join(' · '))}</span>`;
      const cargo = [cargoDe(r), r.revista ? r.revista.toLowerCase() : ''].filter(Boolean).join(' · ');
      const quien = r.tipo === 'delegacion' ? `<span class="t-notas__falta">—</span><span>${esc(cargo)}</span>`
        : r.nombre ? `${esc(titulo(r.nombre))}${r.aCargo ? ' <span class="t-notas__marca">a cargo</span>' : ''}<span>${esc(cargo)}</span>`
          : `<span class="t-notas__falta">Sin contacto cargado</span><span>${esc(cargo)}</span>`;
      return `<tr>
        <td class="t-notas__marcar"><input type="checkbox" data-cambio="nt-elegir" data-id="${esc(r.id)}" ${n.destinatarios.has(r.id) ? 'checked' : ''} aria-label="Mandarle a ${esc(nombreDestino(r))}"></td>
        <td class="t-notas__escuela">${escuela}</td>
        <td class="t-notas__quien">${quien}</td>
        <td class="t-notas__medio">${r.celular ? esc(d.celularLegible(r.celular)) : '<span class="t-notas__falta">sin celular</span>'}${r.correo ? `<span>${esc(r.correo)}</span>` : ''}</td>
        <td class="t-notas__acciones">${botonesMandar(r, false)}</td>
      </tr>`;
    };
    return `<div class="t-notas__destinatarios">
      ${sinContactos()}
      <div class="t-selectores t-notas__filtros">
        <div class="t-selector"><label class="t-selector__etiqueta" for="nt-f-deleg">Delegación</label>
          <select class="t-select" id="nt-f-deleg" data-cambio="nt-filtro" data-filtro="deleg">${opcion('', 'Todas', f.deleg)}${delegaciones().map(([k, nombre]) => opcion(k, nombre, f.deleg)).join('')}</select></div>
        <div class="t-selector"><label class="t-selector__etiqueta" for="nt-f-dep">Departamento</label>
          <select class="t-select" id="nt-f-dep" data-cambio="nt-filtro" data-filtro="dep">${opcion('', 'Todos', f.dep)}${Catalogo.departamentos().map((x) => opcion(x.id, x.nombre, f.dep)).join('')}</select></div>
        <div class="t-selector"><label class="t-selector__etiqueta" for="nt-f-cargo">Cargo</label>
          <select class="t-select" id="nt-f-cargo" data-cambio="nt-filtro" data-filtro="cargo">${opcion('', 'Todos', f.cargo)}${opcion('director', 'Directores/as', f.cargo)}${opcion('coordinador', 'Coordinadores/as de anexos', f.cargo)}${opcion('anexo', 'Anexos sin contacto propio', f.cargo)}${opcion('delegacion', 'Delegaciones zonales', f.cargo)}</select></div>
        <div class="t-selector"><label class="t-selector__etiqueta" for="nt-f-mod">Modalidad</label>
          <select class="t-select" id="nt-f-mod" data-cambio="nt-filtro" data-filtro="mod">${opcion('', 'Todas', f.mod)}${opcion('comun', 'E.P.E.S. común', f.mod)}${opcion('eib', 'E.I.B.', f.mod)}${opcion('agraria', 'Agraria', f.mod)}</select></div>
        <div class="t-selector t-notas__buscar"><label class="t-selector__etiqueta" for="nt-f-texto">Buscar</label>
          <input class="t-select" id="nt-f-texto" type="search" value="${esc(f.texto)}" placeholder="Número, localidad, anexo o persona" data-entrada="nt-buscar" autocomplete="off"></div>
      </div>
      <label class="t-notas__casilla"><input type="checkbox" data-cambio="nt-filtro" data-filtro="faltan" ${f.faltan ? 'checked' : ''}> Solo las escuelas que todavía no cargaron en ReSaP</label>
      <div class="t-notas__seleccion">
        <strong>${numero(n.destinatarios.size)} ${plural(n.destinatarios.size, 'elegido', 'elegidos')}</strong>
        <span>${numero(cuenta('director'))} ${plural(cuenta('director'), 'director', 'directores')} · ${numero(cuenta('coordinador'))} ${plural(cuenta('coordinador'), 'coordinador', 'coordinadores')} · ${numero(cuenta('anexo'))} ${plural(cuenta('anexo'), 'anexo sin contacto', 'anexos sin contacto')} · ${numero(cuenta('delegacion'))} ${plural(cuenta('delegacion'), 'delegación', 'delegaciones')}</span>
        <span class="espaciador"></span>
        <button type="button" class="t-ficha__enlace" data-accion="nt-marcar" data-valor="1" ${vis.length ? '' : 'disabled'}>Elegir las ${numero(vis.length)} que se ven</button>
        <button type="button" class="t-ficha__enlace" data-accion="nt-marcar" data-valor="0" ${vis.length ? '' : 'disabled'}>Sacar las que se ven</button>
        <button type="button" class="t-ficha__enlace" data-accion="nt-marcar" data-valor="todas" ${n.destinatarios.size ? '' : 'disabled'}>Sacar todas</button>
      </div>
      ${aviso()}
      <p class="t-seg-nota">Para corregir un nombre, un celular o un correo, tocá la escuela: se abre su ficha. Para mandarle a una sola, usá sus botones: queda elegida y marcada como enviada.</p>
      <div class="t-notas__marco-tabla"><table class="t-seg-tabla t-notas__tabla">
        <thead><tr><th scope="col"><span class="oculto-visual">Elegir</span></th><th scope="col">Escuela</th><th scope="col">Recibe</th><th scope="col">Celular y correo</th><th scope="col">Mandarle ya</th></tr></thead>
        <tbody>${porDelegacion(vis, fila, (r, grupo) => {
          const todas = grupo.every((x) => n.destinatarios.has(x.id));
          return `<tr class="t-notas__grupo"><th colspan="5" scope="colgroup"><span class="t-notas__grupo-nombre">${esc(nombreGrupo(r))}</span>
            <span class="t-notas__grupo-cuenta">${numero(grupo.filter((x) => n.destinatarios.has(x.id)).length)} de ${numero(grupo.length)} ${plural(grupo.length, 'elegido', 'elegidos')}</span>
            <button type="button" class="t-ficha__enlace" data-accion="nt-marcar-grupo" data-grupo="${esc(r.grupo)}" data-valor="${todas ? '0' : '1'}">${todas ? 'Sacarlas' : `Elegir las ${numero(grupo.length)}`}</button></th></tr>`;
        }) || '<tr><td colspan="5" class="t-seg-sin">Nadie coincide con lo que elegiste arriba.</td></tr>'}</tbody>
      </table></div>
      <div class="t-notas__pie">
        <button type="button" class="t-exportar t-exportar--claro" data-accion="nt-paso" data-paso="redactar">← Redactar</button>
        <button type="button" class="t-exportar" data-accion="nt-paso" data-paso="enviar" ${n.destinatarios.size ? '' : 'disabled'}>Siguiente: enviar →</button>
      </div>
    </div>`;
  }

  function vistaEnviar() {
    const n = st.nota;
    const lista = elegidos();
    if (!lista.length) {
      return `<p class="t-seg-vacia">Todavía no elegiste a quién mandarla. <button type="button" class="t-seg-enlace" data-accion="nt-paso" data-paso="destinatarios">Elegir a quién →</button></p>`;
    }
    const hechas = lista.filter((r) => enviada(r.id)).length;
    const sinCel = lista.filter((r) => !r.celular).length;
    const ocupado = !!(st.enviando || st.lote);
    const telefono = d.conElTelefono();
    const fila = (r) => {
      const e = enviada(r.id);
      return `<tr class="${e ? 't-notas__hecha' : ''}">
        <th scope="row" class="t-notas__escuela">${esc(nombreDestino(r))}<span>${esc(r.tipo === 'coordinador' ? r.anexos.map((x) => x.localidad || x.nombre).join(', ') : r.tipo === 'anexo' ? `Anexo de ${r.referencia.nombre}` : r.referencia ? r.referencia.localidad : '')}</span></th>
        <td class="t-notas__quien">${r.nombre && r.tipo !== 'delegacion' ? esc(titulo(r.nombre)) : esc(cargoDe(r))}<span>${r.celular ? esc(d.celularLegible(r.celular)) : 'sin celular'}${r.correo ? ` · ${esc(r.correo)}` : ''}</span></td>
        <td class="t-notas__acciones">${botonesMandar(r, true)}</td>
        <td class="t-notas__estado"><label><input type="checkbox" data-cambio="nt-hecha" data-id="${esc(r.id)}" ${e ? 'checked' : ''}>
          ${e ? `<span><strong>Enviada</strong> ${esc(CANALES[e.canal] || '')} · ${esc(cuandoEnvio(e.enviado_en))}</span>` : '<span>Pendiente</span>'}</label></td>
      </tr>`;
    };
    const pct = lista.length ? Math.round((hechas / lista.length) * 100) : 0;
    return `<div class="t-notas__enviar">
      ${sinContactos()}
      <div class="t-contexto t-notas__resumen">
        <div class="t-contexto__texto">${hechas === lista.length
          ? `<strong>Ya se mandó a los ${numero(lista.length)}.</strong>`
          : `Se mandó a <strong>${numero(hechas)} de ${numero(lista.length)}</strong>. ${plural(lista.length - hechas, 'Falta', 'Faltan')} <strong>${numero(lista.length - hechas)}</strong>.`}
          ${sinCel ? ` ${numero(sinCel)} no ${plural(sinCel, 'tiene', 'tienen')} celular: van por correo o se corrigen en la ficha.` : ''}</div>
        <div class="t-notas__barra" aria-hidden="true"><div class="t-barra" style="width:${pct}%"></div></div>
      </div>
      <div class="t-notas__acciones-lote">
        ${telefono ? '' : `<button type="button" class="t-exportar" data-accion="nt-siguiente" ${ocupado || hechas === lista.length ? 'disabled' : ''}>Mandar a la siguiente pendiente (WhatsApp)</button>`}
        <button type="button" class="t-exportar t-exportar--claro" data-accion="nt-zip" ${ocupado ? 'disabled' : ''}>${st.lote ? esc(st.lote) : 'Bajar todas (ZIP de PDF)'}</button>
        <button type="button" class="t-exportar t-exportar--claro" data-accion="nt-imprimir" ${ocupado ? 'disabled' : ''}>Imprimir todas</button>
        <button type="button" class="t-ficha__enlace" data-accion="nt-registro">Registro de envío (Excel)</button>
        <button type="button" class="t-ficha__enlace" data-accion="nt-actualizar" title="Trae lo que marcaron los demás">Actualizar</button>
      </div>
      ${aviso()}
      <p class="t-seg-nota">${telefono
        ? '«Compartir» abre el menú del celular con el PDF y el mensaje: elegí WhatsApp y el contacto.'
        : '«WhatsApp» baja el PDF de esa escuela y abre el chat del director con el mensaje escrito: arrastrá el PDF al chat y mandá. WhatsApp no deja que una página adjunte el archivo sola. Queda marcada como enviada; si no salió, destildala.'}</p>
      <div class="t-notas__marco-tabla"><table class="t-seg-tabla t-notas__tabla t-notas__tabla--enviar">
        <thead><tr><th scope="col">Para</th><th scope="col">Recibe</th><th scope="col">Mandar</th><th scope="col">Estado</th></tr></thead>
        <tbody>${porDelegacion(lista, fila, (r, grupo) => `<tr class="t-notas__grupo"><th colspan="4" scope="colgroup"><span class="t-notas__grupo-nombre">${esc(nombreGrupo(r))}</span>
          <span class="t-notas__grupo-cuenta">${numero(grupo.filter((x) => enviada(x.id)).length)} de ${numero(grupo.length)} ${plural(grupo.length, 'enviada', 'enviadas')}</span></th></tr>`)}</tbody>
      </table></div>
    </div>`;
  }

  /* ---------- Ventanas ---------- */

  function panelPrevia() {
    const lista = st.nota.destinatarios.size ? elegidos() : destinatarios();
    const r = porId(st.previa) || lista[0];
    if (!r) {
      return `<div class="t-velo" data-accion="nt-cerrar"></div><div class="t-panel" role="dialog" aria-modal="true" aria-label="Vista previa">
        <div class="t-panel__cabecera"><h2 class="t-panel__titulo">Vista previa</h2><button type="button" class="t-panel__cerrar" data-accion="nt-cerrar" aria-label="Cerrar">${d.iconoCerrar}</button></div>
        <p class="t-panel__nota">No hay contactos cargados para armar la nota.</p></div>`;
    }
    return `<div class="t-velo" data-accion="nt-cerrar"></div>
    <div class="t-panel t-panel--ancho" role="dialog" aria-modal="true" aria-labelledby="nt-previa-titulo">
      <div class="t-panel__cabecera">
        <h2 class="t-panel__titulo" id="nt-previa-titulo">Así le llega</h2>
        <button type="button" class="t-panel__cerrar" data-accion="nt-cerrar" aria-label="Cerrar">${d.iconoCerrar}</button>
      </div>
      <label class="t-ficha__campo"><span>Ver la de</span>
        <select data-cambio="nt-previa">${lista.map((x) => `<option value="${esc(x.id)}" ${x.id === r.id ? 'selected' : ''}>${esc(nombreDestino(x))}${x.nombre && x.tipo !== 'delegacion' ? ` — ${esc(titulo(x.nombre))}` : ''}</option>`).join('')}</select></label>
      <div class="t-notas__previa">${hojas(r)}</div>
      <div class="t-panel__acciones">
        <button type="button" class="t-descargar" data-accion="nt-enviar" data-canal="pdf" data-id="${esc(r.id)}">Bajar el PDF</button>
        <button type="button" class="t-cancelar" data-accion="nt-cerrar">Cerrar</button>
      </div>
    </div>`;
  }

  function panelMembrete() {
    const m = st.membrete;
    const campo = (k, t, area) => `<label class="t-ficha__campo"><span>${t}</span>${area
      ? `<textarea name="${k}" rows="3">${esc(m[k])}</textarea>` : `<input name="${k}" type="text" value="${esc(m[k])}" autocomplete="off">`}</label>`;
    return `<div class="t-velo" data-accion="nt-cerrar"></div>
    <form class="t-panel" role="dialog" aria-modal="true" aria-labelledby="nt-membrete-titulo" data-form="nt-membrete" novalidate>
      <div class="t-panel__cabecera">
        <h2 class="t-panel__titulo" id="nt-membrete-titulo">Membrete y firma</h2>
        <button type="button" class="t-panel__cerrar" data-accion="nt-cerrar" aria-label="Cerrar">${d.iconoCerrar}</button>
      </div>
      <p class="t-panel__bajada">Valen para todas las notas y para todo el equipo. Los logos son los del Ministerio y la DES, como en la nota modelo.</p>
      ${campo('lemas', 'Leyendas del año (una por renglón)', true)}
      ${campo('de', 'Remitente (cuadro «DE LA:» de la nota múltiple)', true)}
      <div class="t-notas__grilla">
        ${campo('prefijoC', 'Antes del número (carta)')}${campo('prefijo', 'Antes del número (nota múltiple)')}
        ${campo('ciudad', 'Ciudad de la fecha')}${campo('prof', 'Antes del nombre del director')}
      </div>
      <div class="t-panel__etiqueta">Firma (si la nota no trae una propia)</div>
      <div class="t-notas__grilla">${campo('f1', 'Firmante')}${campo('f2', 'Cargo')}${campo('f3', 'Dependencia')}</div>
      <label class="t-ficha__campo"><span>Imagen de firma y sello <em>(opcional, menos de 500 KB)</em></span><input type="file" accept="image/*" data-cambio="nt-firma-img"></label>
      ${m.firmaImg ? `<div class="t-notas__firma-img"><img src="${esc(m.firmaImg)}" alt="Firma cargada"><button type="button" class="t-ficha__enlace" data-accion="nt-quitar-firma">Quitar la imagen</button></div>` : ''}
      <div class="t-panel__etiqueta">Cómo se nombra a quien recibe</div>
      <div class="t-notas__grilla">${campo('trat', 'Directores/as')}${campo('tratC', 'Coordinadores/as')}${campo('tratD', 'Delegaciones')}</div>
      ${st.errorModal ? `<div class="t-panel__nota t-panel__nota--error" role="alert">${esc(st.errorModal)}</div>` : ''}
      <div class="t-panel__acciones">
        <button type="submit" class="t-descargar" ${st.guardandoModal ? 'disabled' : ''}>${st.guardandoModal ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" class="t-cancelar" data-accion="nt-cerrar">Cancelar</button>
      </div>
    </form>`;
  }

  function panelContactos() {
    const b = st.base;
    const cerrar = `<button type="button" class="t-panel__cerrar" data-accion="nt-cerrar" aria-label="Cerrar">${d.iconoCerrar}</button>`;
    const error = st.errorModal ? `<div class="t-panel__nota t-panel__nota--error" role="alert">${esc(st.errorModal)}</div>` : '';
    const subir = `<label class="t-exportar t-notas__subir-base">Elegir el Excel<input type="file" accept=".xlsx,.xls" data-cambio="nt-base" hidden></label>`;
    let cuerpo;
    let acciones = `<button type="button" class="t-cancelar" data-accion="nt-cerrar">Cerrar</button>`;
    if (!b) {
      cuerpo = `<p class="t-panel__bajada">Subí la base de directivos (el Excel unificado: directores de cada E.P.E.S., coordinadores de anexos, celular, situación de revista). Antes de cargar nada, se compara con los contactos que ya tiene el panel y se ve qué cambia.</p>
        <p class="t-panel__nota">Vale lo de la planilla, salvo en las escuelas donde alguien del equipo corrigió o agregó un contacto desde la ficha: ahí no se toca. Los correos oficiales y las delegaciones quedan como están.</p>
        ${subir}`;
    } else if (b.leyendo) {
      cuerpo = `<p class="t-panel__nota">Leyendo «${esc(b.archivo)}»…</p>`;
    } else if (b.hecho) {
      const h = b.hecho;
      cuerpo = `<p class="t-panel__bajada"><strong>Listo.</strong> Se cargaron ${numero(h.cargados)} contactos en ${numero(h.escuelas)} escuelas y anexos${h.respetadas && h.respetadas.length ? `; ${numero(h.respetadas.length)} ${plural(h.respetadas.length, 'escuela quedó', 'escuelas quedaron')} como las corrigió el equipo` : ''}.</p>
        ${h.nombres ? `<p class="t-panel__nota">${numero(h.nombres)} ${plural(h.nombres, 'escuela sumó', 'escuelas sumaron')} su nombre propio. Los docentes lo van a ver cuando publiques en <strong>Escuelas</strong>.</p>` : ''}
        <p class="t-panel__nota">Ya se ven en la ficha de cada escuela, en «Mandarle el avance al director» y en las notas.</p>`;
    } else {
      const r = cotejar(b);
      const lista = (items, max, fn) => `<ul class="t-notas__cotejo">${items.slice(0, max).map(fn).join('')}${items.length > max ? `<li class="t-notas__mas">y ${numero(items.length - max)} más</li>` : ''}</ul>`;
      const nombreE = (x) => esc(x.escuela ? x.escuela.nombre : x.id);
      const bloque = (n, texto, contenido, abierto) => (n ? `<details class="t-notas__det" ${abierto ? 'open' : ''}><summary><strong>${numero(n)}</strong> ${texto}</summary>${contenido || ''}</details>` : '');
      const opcionesPara = (p) => {
        const anexos = d.nominaOrdenada().filter((x) => (p.tipo === 'anexo' ? d.esAnexo(x) : !d.esAnexo(x)));
        const propios = p.sedeId ? anexos.filter((x) => { const s = d.sedeDe(x.id); return s && s.id === p.sedeId; }) : [];
        const op = (x) => `<option value="${esc(x.id)}" ${b.elegidas.get(p.clave) === x.id ? 'selected' : ''}>${esc(x.nombre)}${x.localidad ? ` · ${esc(x.localidad)}` : ''}</option>`;
        return `<option value="">No cargarlo</option>${propios.length ? `<optgroup label="Anexos de ${esc(Catalogo.escuela(p.sedeId).nombre)}">${propios.map(op).join('')}</optgroup>` : ''}
          ${Catalogo.departamentos().map((dep) => { const de = anexos.filter((x) => x.departamento_id === dep.id); return de.length ? `<optgroup label="${esc(dep.nombre)}">${de.map(op).join('')}</optgroup>` : ''; }).join('')}`;
      };
      cuerpo = `<p class="t-panel__bajada">Así quedarían los contactos con <strong>«${esc(b.archivo)}»</strong>. Todavía no se cargó nada.</p>
        <div class="t-notas__cotejo-marco">
          ${bloque(r.cambian.length, 'cambian de persona o de celular', lista(r.cambian, 40, (x) => `<li><strong>${nombreE(x)}</strong><span>Hoy: ${esc(x.antes.join('; '))}</span><span>Queda: ${esc(x.despues.join('; '))}</span></li>`), true)}
          ${bloque(r.nuevas.length, `${plural(r.nuevas.length, 'escuela o anexo suma', 'escuelas y anexos suman')} su contacto (los anexos, su coordinador)`, lista(r.nuevas, 40, (x) => `<li><strong>${nombreE(x)}</strong><span>${esc(x.despues.join('; '))}</span></li>`))}
          ${bloque(r.iguales.length, `${plural(r.iguales.length, 'queda', 'quedan')} igual`, '')}
          ${bloque(r.respetadas.length, `${plural(r.respetadas.length, 'escuela tiene', 'escuelas tienen')} contactos corregidos por el equipo: no se tocan`, lista(r.respetadas, 40, (x) => `<li><strong>${nombreE(x)}</strong><span>Hoy: ${esc(x.antes.join('; '))}</span><span>La planilla dice: ${esc(x.despues.join('; '))}</span></li>`))}
          ${bloque(r.afuera.length, `${plural(r.afuera.length, 'escuela no está', 'escuelas no están')} en la planilla: quedan como están`, lista(r.afuera, 40, (x) => `<li>${esc(x.nombre)}</li>`))}
          ${bloque(r.nombres.length, `${plural(r.nombres.length, 'escuela suma', 'escuelas suman')} su nombre propio (se publica desde Escuelas)`, lista(r.nombres, 12, (x) => `<li><strong>${esc(Catalogo.escuela(x.id).nombre)}</strong> «${esc(x.denominacion)}»</li>`))}
          ${bloque(r.celulares.length, `${plural(r.celulares.length, 'celular no tiene', 'celulares no tienen')} 10 números: revisalos después en la ficha`, lista(r.celulares, 20, (c) => `<li><strong>${esc(Catalogo.escuela(c.escuela_id).nombre)}</strong><span>${esc(titulo(c.nombre))} · ${esc(c.celular)} (fila ${c.fila})</span></li>`))}
          ${bloque(r.sinCelular.length, `${plural(r.sinCelular.length, 'contacto viene', 'contactos vienen')} sin celular`, '')}
          ${b.delegaciones ? `<p class="t-panel__nota">Las ${numero(b.delegaciones)} delegaciones zonales de la planilla no se cargan: sus correos ya están.</p>` : ''}
        </div>
        ${b.pendientes.length ? `<div class="t-notas__pendientes">
          <div class="t-panel__etiqueta">No los reconocimos (${numero(b.pendientes.length)}): elegí cuál es</div>
          <ul class="t-notas__cotejo">${b.pendientes.map((p) => `<li class="t-notas__pendiente">
            <span><strong>«${esc(p.texto)}»</strong> · ${esc(p.tipo === 'anexo' ? `${p.de}, coordinador ${titulo(p.contacto.nombre)}` : `${titulo(p.contacto.nombre)}${p.de ? `, ${p.de}` : ''}`)} (fila ${p.contacto.fila})</span>
            <select data-cambio="nt-base-elegir" data-clave="${p.clave}" aria-label="Cuál es «${esc(p.texto)}»">${opcionesPara(p)}</select></li>`).join('')}</ul>
        </div>` : ''}`;
      acciones = `<button type="button" class="t-descargar" data-accion="nt-cargar-base" ${st.guardandoModal ? 'disabled' : ''}>${st.guardandoModal ? 'Cargando…' : `Cargar los ${numero(r.filas.length)} contactos`}</button>
        <button type="button" class="t-cancelar" data-accion="nt-otra-base">Elegir otro</button>`;
    }
    return `<div class="t-velo" data-accion="nt-cerrar"></div>
    <div class="t-panel t-panel--ancho" role="dialog" aria-modal="true" aria-labelledby="nt-base-titulo">
      <div class="t-panel__cabecera"><h2 class="t-panel__titulo" id="nt-base-titulo">Actualizar los contactos</h2>${cerrar}</div>
      ${cuerpo}
      ${error}
      <div class="t-panel__acciones">${acciones}</div>
    </div>`;
  }

  function pantalla() {
    cacheDest = null;
    let cuerpo;
    if (st.cargando || !d.listo()) {
      cuerpo = '<div class="t-estado"><div class="t-estado__texto">Trayendo las notas…</div></div>';
    } else if (st.sinTablas) {
      cuerpo = `<div class="t-notas__aviso t-notas__aviso--error" role="alert">Las notas todavía no están instaladas en la base: falta correr <strong>sql/18_notas.sql</strong> en el SQL Editor de Supabase. Avisale a quien administra el sistema.<br><small>La base respondió: ${esc(st.sinTablas)}</small></div>`;
    } else if (st.paso === 'lista' || !st.nota) {
      cuerpo = vistaLista();
    } else {
      cuerpo = { redactar: vistaRedactar, destinatarios: vistaDestinatarios, enviar: vistaEnviar }[st.paso]();
    }
    const modal = st.modal === 'membrete' ? panelMembrete() : st.modal === 'contactos' ? panelContactos()
      : st.previa !== null && st.nota ? panelPrevia() : '';
    return `<div class="t-seg-marco t-notas">${cabeza()}<div class="t-cuerpo t-notas__cuerpo">${cuerpo}</div>${modal}</div>`;
  }

  /* ======================================================================
     Eventos
     ====================================================================== */

  async function irAPaso(paso) {
    if (paso === st.paso) return;
    await guardar();
    st.paso = paso;
    st.aviso = null;
    if ((paso === 'enviar' || paso === 'destinatarios') && st.nota) { try { st.envios = await traerEnvios(); } catch (e) { /* queda lo que había */ } }
    d.escribirHash();
    d.render();
    window.scrollTo(0, 0);
  }

  let ultimoFoco = null;   // el texto o el mensaje, para insertar un campo
  document.addEventListener('focusin', (e) => {
    if (e.target && (e.target.id === 'nt-editor' || e.target.id === 'nt-mensaje')) ultimoFoco = e.target.id;
  });
  // Los botones de formato no se llevan la selección del texto
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest && e.target.closest('[data-accion="nt-formato"], [data-accion="nt-insertar"]')) e.preventDefault();
  });

  function manejar(accion, ds) {
    switch (accion) {
      case 'nt-salir': salir(); d.salirAlSeguimiento(); break;
      case 'nt-lista': guardar().then(() => { st.paso = 'lista'; st.nota = null; st.aviso = null; d.escribirHash(); d.render(); window.scrollTo(0, 0); }); break;
      case 'nt-nueva': notaNueva(null); break;
      case 'nt-duplicar': notaNueva(st.lista.find((x) => x.id === Number(ds.id))); break;
      case 'nt-abrir': {
        const n = st.lista.find((x) => x.id === Number(ds.id));
        if (!n) break;
        abrirNota(n);
        st.paso = 'redactar';
        d.escribirHash();
        d.render();
        window.scrollTo(0, 0);
        break;
      }
      case 'nt-recargar': {
        sb.from('notas').select('*').eq('id', st.nota.id).maybeSingle().then(({ data }) => {
          if (data) {
            const i = st.lista.findIndex((x) => x.id === data.id);
            if (i >= 0) st.lista[i] = data;
            const paso = st.paso;
            abrirNota(data);
            st.paso = paso;
          }
          d.render();
        });
        break;
      }
      case 'nt-archivar': archivar(Number(ds.id), ds.valor === '1'); break;
      case 'nt-ver-archivadas': st.verArchivadas = !st.verArchivadas; d.render(); break;
      case 'nt-paso': irAPaso(ds.paso); break;
      case 'nt-formato': {
        const ed = document.getElementById('nt-editor');
        if (!ed) break;
        ed.focus();
        document.execCommand(ds.cmd);
        st.nota.cuerpo = ed.innerHTML;
        marcarSucio();
        break;
      }
      case 'nt-insertar': {
        const marca = `{{${ds.campo}}}`;
        const ta = document.getElementById('nt-mensaje');
        if (ultimoFoco === 'nt-mensaje' && ta) {
          const p = ta.selectionStart;
          ta.value = ta.value.slice(0, p) + marca + ta.value.slice(ta.selectionEnd);
          ta.focus();
          ta.selectionStart = ta.selectionEnd = p + marca.length;
          st.nota.mensaje = ta.value;
        } else {
          const ed = document.getElementById('nt-editor');
          if (!ed) break;
          ed.focus();
          document.execCommand('insertText', false, marca);
          st.nota.cuerpo = ed.innerHTML;
        }
        marcarSucio();
        break;
      }
      case 'nt-previa': guardar(); st.previa = ds.id || ''; d.render(); break;
      case 'nt-cerrar':
        if (st.guardandoModal) break;
        st.previa = null; st.modal = null; st.errorModal = null;
        if (st.base && st.base.hecho) st.base = null;
        d.render();
        break;
      case 'nt-marcar': {
        const n = st.nota;
        if (ds.valor === 'todas') n.destinatarios.clear();
        else for (const r of filtrar(destinatarios())) { if (ds.valor === '1') n.destinatarios.add(r.id); else n.destinatarios.delete(r.id); }
        marcarSucio();
        d.render();
        break;
      }
      case 'nt-marcar-grupo': {
        const n = st.nota;
        for (const r of filtrar(destinatarios()).filter((x) => x.grupo === ds.grupo)) {
          if (ds.valor === '1') n.destinatarios.add(r.id); else n.destinatarios.delete(r.id);
        }
        marcarSucio();
        d.render();
        break;
      }
      case 'nt-enviar': if (ds.canal === 'pdf' && st.previa !== null) { st.previa = null; } enviar(ds.id, ds.canal); break;
      case 'nt-siguiente': {
        const r = elegidos().find((x) => !enviada(x.id) && x.celular);
        if (r) enviar(r.id, 'whatsapp');
        else { st.aviso = { texto: 'No quedan pendientes con celular. Las que faltan van por correo, o se corrigen en la ficha.', error: true }; d.render(); }
        break;
      }
      case 'nt-zip': zip(); break;
      case 'nt-imprimir': guardar().then(imprimirTodas); break;
      case 'nt-registro': registro(); break;
      case 'nt-actualizar': traerEnvios().then((m) => { st.envios = m; st.aviso = { texto: 'Al día con lo que marcó el resto del equipo.' }; d.render(); }).catch(() => {}); break;
      case 'nt-modal': st.modal = ds.modal; st.errorModal = null; if (ds.modal === 'contactos') st.base = null; d.render(); break;
      case 'nt-quitar-firma': st.membrete.firmaImg = ''; d.render(); break;
      case 'nt-otra-base': st.base = null; st.errorModal = null; d.render(); break;
      case 'nt-cargar-base': cargarBase(); break;
      default: break;
    }
  }

  function cambio(el) {
    const n = st.nota;
    switch (el.dataset.cambio) {
      case 'nt-campo':
        if (el.name === 'formato') n.formato = el.value;
        else if (el.name === 'anexo') n.anexo = el.checked ? 'planilla' : '';
        else n[el.name] = el.value;
        marcarSucio();
        if (el.type === 'radio') d.render();
        break;
      case 'nt-elegir':
        if (el.checked) n.destinatarios.add(el.dataset.id); else n.destinatarios.delete(el.dataset.id);
        marcarSucio();
        d.render();
        break;
      case 'nt-filtro':
        st.filtros[el.dataset.filtro] = el.type === 'checkbox' ? el.checked : el.value;
        d.render();
        break;
      case 'nt-hecha':
        marcar(el.dataset.id, el.checked ? 'a_mano' : null).then(() => d.render());
        break;
      case 'nt-previa': st.previa = el.value; d.render(); break;
      case 'nt-word': if (el.files[0]) subirWord(el.files[0]); el.value = ''; break;
      case 'nt-base': if (el.files[0]) elegirBase(el.files[0]); el.value = ''; break;
      case 'nt-base-elegir': st.base.elegidas.set(el.dataset.clave, el.value); d.render(); break;
      case 'nt-firma-img': {
        const f = el.files[0];
        if (!f) break;
        if (f.size > 500000) { st.errorModal = 'La imagen pesa más de 500 KB. Probá con una más chica (una foto recortada del sello alcanza).'; d.render(); break; }
        const lector = new FileReader();
        lector.onload = () => { st.membrete.firmaImg = lector.result; st.errorModal = null; d.render(); };
        lector.readAsDataURL(f);
        break;
      }
      default: break;
    }
  }

  function entrada(el) {
    const n = st.nota;
    switch (el.dataset.entrada) {
      case 'nt-campo': if (n) { n[el.name] = el.value; marcarSucio(); if (el.name === 'titulo') { const t = document.querySelector('.t-notas__titulo'); if (t) t.textContent = el.value || 'Nota sin nombre'; } } break;
      case 'nt-cuerpo': if (n) { n.cuerpo = el.innerHTML; marcarSucio(); } break;
      case 'nt-buscar': {
        const pos = el.selectionStart;
        st.filtros.texto = el.value;
        d.render();
        const nuevo = document.getElementById('nt-f-texto');
        if (nuevo) { nuevo.focus(); try { nuevo.setSelectionRange(pos, pos); } catch (x) { /* type=search */ } }
        break;
      }
      default: break;
    }
  }

  async function enviarForm(form) {
    if (form.dataset.form !== 'nt-membrete') return;
    const datos = { ...st.membrete };
    for (const k of Object.keys(MEMBRETE_INICIAL)) if (k !== 'firmaImg' && form.elements[k]) datos[k] = form.elements[k].value;
    st.guardandoModal = true;
    st.errorModal = null;
    d.render();
    const { data, error } = await sb.rpc('guardar_membrete', { p_datos: datos });
    st.guardandoModal = false;
    if (error || (data && data.error)) { st.errorModal = (data && data.error) || 'No se pudo guardar. Revisá la conexión.'; d.render(); return; }
    st.membrete = datos;
    st.modal = null;
    d.render();
  }

  /* ======================================================================
     Entrada y salida
     ====================================================================== */

  function iniciar(cliente, prestado) { sb = cliente; d = prestado; }
  function entrar(desdeHash) {
    st.activo = true;
    if (!desdeHash) { st.paso = 'lista'; st.nota = null; st.abrirId = null; }
    st.aviso = null;
    st.modal = null;
    st.previa = null;
    cargar();
  }
  function salir() {
    if (st.sucio) guardar();
    st.activo = false;
    st.modal = null;
    st.previa = null;
  }
  function leerHash(h) {
    st.activo = h.get('notas') === '1';
    st.abrirId = h.get('nota') ? Number(h.get('nota')) : null;
    st.paso = ['redactar', 'destinatarios', 'enviar'].includes(h.get('paso')) ? h.get('paso') : 'lista';
  }
  function escribirHash(h) {
    if (!st.activo) return;
    h.set('notas', '1');
    if (st.nota && st.nota.id && st.paso !== 'lista') { h.set('nota', String(st.nota.id)); h.set('paso', st.paso); }
  }
  function escape() {
    if (st.modal || st.previa !== null) { if (!st.guardandoModal) { st.modal = null; st.previa = null; d.render(); } return true; }
    return false;
  }

  window.addEventListener('beforeunload', (e) => {
    if (st.activo && (st.sucio || st.guardando)) { guardar(); e.preventDefault(); e.returnValue = ''; }
  });

  return {
    iniciar, entrar, salir, pantalla, manejar, cambio, entrada, enviarForm, leerHash, escribirHash, escape,
    activo: () => st.activo,
    // Para el recorrido guiado
    estado: st,
  };
})();
