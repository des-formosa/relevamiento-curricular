/* ============================================================================
   Editor del catálogo — para el equipo de Planificación Curricular.

   Corrige un saber mal transcripto, agrega el contenido que falta, saca el que
   no va. Nada se borra: se archiva, porque un docente puede tener el
   formulario abierto con el catálogo viejo y su envío tiene que entrar igual.
   Cada cambio queda registrado con quién y cuándo (ver sql/09_edicion_catalogo.sql).

   Editar no publica: el formulario del docente lee el catálogo publicado, no
   la base. Por eso está el botón «Publicar», que sube el catálogo al bucket
   que lee el formulario (ver sql/10_publicar_catalogo.sql).

   Para corregir de a muchos está «Exportar e importar», en assets/archivo.js:
   el catálogo baja como Excel y vuelve corregido.
   ============================================================================ */

const Editor = (function () {
  'use strict';

  let sb = null;
  let alRefrescar = null;
  let relojAviso = null;   // el aviso anterior no tiene que borrar al siguiente

  const estado = {
    datos: null,          // { saberes: [...] }
    cargando: false,
    error: null,
    editando: null,       // id del saber o contenido que se está editando
    agregandoEn: null,    // saber_id al que se le está agregando un contenido
    saberNuevo: null,     // { eje_id } mientras se da de alta un saber
    guardando: false,
    confirmar: null,      // { tipo, id, texto, respuestas, archivar }
    historial: null,      // [] cuando está abierto
    verArchivados: false, // lo archivado se muestra solo si se pide
    aviso: null,
    publicacion: null,    // { publicado_en, publicado_por, cambios_sin_publicar }
    publicando: false,
  };

  /* ---------- Utilidades ---------- */

  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  const plural = (n, uno, varios) => (n === 1 ? uno : varios);
  const ORDINAL = { 1: '1er', 2: '2do', 3: '3er' };

  const svg = (d, { tam = 18, color = '#0B4F4A', grosor = 2.2 } = {}) =>
    `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${grosor}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const Icono = {
    lapiz: svg('<path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>'),
    archivar: svg('<path d="M3 7h18v3H3z"/><path d="M5 10v9h14v-9"/><path d="M10 14h4"/>', { color: '#7A4E00' }),
    restaurar: svg('<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v5h5"/>', { color: '#0B4F4A' }),
    mas: svg('<path d="M12 5v14"/><path d="M5 12h14"/>'),
    reloj: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', { color: '#55605A' }),
    bajar: svg('<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>', { color: '#55605A' }),
    subir: svg('<path d="M12 20V9"/><path d="M7 13l5-5 5 5"/><path d="M4 4h16"/>', { tam: 19, color: '#FFFFFF', grosor: 2.4 }),
  };

  /* ---------- Datos ---------- */

  async function cargar(espacio_id, anio) {
    estado.espacio_id = espacio_id;
    estado.anio = anio;
    estado.cargando = true;
    estado.error = null;
    pintar();
    const [{ data, error }, pub] = await Promise.all([
      sb.rpc('catalogo_editar', { p_espacio_id: espacio_id, p_anio: anio }),
      sb.rpc('estado_publicacion'),
    ]);
    if (pub && !pub.error && pub.data && pub.data.publicado_en !== undefined) estado.publicacion = pub.data;
    estado.cargando = false;
    if (error || (data && data.error)) {
      estado.datos = null;
      estado.error = (data && data.error) || 'No pudimos traer el catálogo. Revisá la conexión y volvé a intentar.';
    } else {
      estado.datos = data;
    }
    pintar();
  }

  async function llamar(funcion, params, mensaje) {
    estado.guardando = true;
    estado.error = null;
    pintar();
    const { data, error } = await sb.rpc(funcion, params);
    estado.guardando = false;
    if (error) {
      // Los mensajes de las funciones ya están escritos para el equipo
      estado.error = error.message || 'No pudimos guardar el cambio.';
      pintar();
      return null;
    }
    clearTimeout(relojAviso);
    estado.aviso = mensaje || null;
    estado.editando = null;
    estado.agregandoEn = null;
    estado.saberNuevo = null;
    estado.confirmar = null;
    if (alRefrescar) await alRefrescar();     // vuelve a pedir el catálogo
    relojAviso = setTimeout(() => { estado.aviso = null; pintar(); }, 6000);
    return data;
  }

  /* ---------- Piezas ---------- */

  function fila(c, saber) {
    const editando = estado.editando === 'c:' + c.id;
    const archivado = c.estado === 'archivado';
    if (editando) {
      return `<div class="ed-fila ed-fila--editando">
        <textarea class="ed-campo" id="ed-texto" rows="2" maxlength="500">${esc(c.texto)}</textarea>
        <div class="ed-acciones-campo">
          <button type="button" class="ed-boton ed-boton--guardar" data-accion="ed-guardar-contenido" data-id="${esc(c.id)}">Guardar</button>
          <button type="button" class="ed-boton" data-accion="ed-cancelar">Cancelar</button>
        </div>
      </div>`;
    }
    return `<div class="ed-fila ${archivado ? 'ed-fila--archivada' : ''}">
      <div class="ed-fila__texto">${esc(c.texto)}${archivado ? ' <span class="ed-chip">archivado</span>' : ''}</div>
      <div class="ed-fila__datos">${c.respuestas ? `${c.respuestas} ${plural(c.respuestas, 'respuesta', 'respuestas')}` : ''}</div>
      <div class="ed-fila__botones">
        ${archivado
          ? `<button type="button" class="ed-icono" title="Volver a ofrecerlo" data-accion="ed-archivar-contenido" data-id="${esc(c.id)}" data-archivar="0">${Icono.restaurar}</button>`
          : `<button type="button" class="ed-icono" title="Editar" data-accion="ed-editar" data-id="c:${esc(c.id)}">${Icono.lapiz}</button>
             <button type="button" class="ed-icono" title="Archivar" data-accion="ed-pedir-archivar" data-tipo="contenido" data-id="${esc(c.id)}" data-respuestas="${c.respuestas || 0}" data-texto="${esc(c.texto)}">${Icono.archivar}</button>`}
      </div>
    </div>`;
  }

  function tarjetaSaber(s) {
    const editando = estado.editando === 's:' + s.id;
    const archivado = s.estado === 'archivado';
    const activos = (s.contenidos || []).filter((c) => c.estado === 'activo');
    const visibles = estado.verArchivados ? (s.contenidos || []) : activos;
    const cabeza = editando
      ? `<textarea class="ed-campo ed-campo--saber" id="ed-texto" rows="4" maxlength="1500">${esc(s.texto)}</textarea>
         <div class="ed-acciones-campo">
           <label class="ed-select-linea">Trimestre
             <select id="ed-trimestre" class="ed-select">
               ${[1, 2, 3].map((t) => `<option value="${t}" ${t === s.trimestre ? 'selected' : ''}>${ORDINAL[t]}</option>`).join('')}
             </select>
           </label>
           <button type="button" class="ed-boton ed-boton--guardar" data-accion="ed-guardar-saber" data-id="${esc(s.id)}" data-eje="${esc(s.eje_id)}" data-anio="${s.anio == null ? '' : s.anio}">Guardar</button>
           <button type="button" class="ed-boton" data-accion="ed-cancelar">Cancelar</button>
         </div>`
      : `<div class="ed-saber__texto">${esc(s.texto)}</div>`;

    return `<article class="ed-saber ${archivado ? 'ed-saber--archivado' : ''}">
      <header class="ed-saber__cabecera">
        <div class="ed-saber__datos">
          <span class="ed-saber__eje">${esc(s.eje)}</span>
          <span class="ed-saber__meta">${ORDINAL[s.trimestre]} trimestre${s.anio ? ` · ${s.anio}° año` : ' · todo el ciclo'}${s.respuestas ? ` · ${s.respuestas} ${plural(s.respuestas, 'respuesta', 'respuestas')}` : ''}</span>
          ${archivado ? '<span class="ed-chip">archivado</span>' : ''}
        </div>
        <div class="ed-saber__botones">
          <button type="button" class="ed-icono" title="Ver los cambios de este saber" data-accion="ed-historial" data-id="${esc(s.id)}">${Icono.reloj}</button>
          ${archivado
            ? `<button type="button" class="ed-icono" title="Volver a ofrecerlo" data-accion="ed-archivar-saber" data-id="${esc(s.id)}" data-archivar="0">${Icono.restaurar}</button>`
            : `<button type="button" class="ed-icono" title="Editar" data-accion="ed-editar" data-id="s:${esc(s.id)}">${Icono.lapiz}</button>
               <button type="button" class="ed-icono" title="Archivar" data-accion="ed-pedir-archivar" data-tipo="saber" data-id="${esc(s.id)}" data-respuestas="${s.respuestas || 0}" data-texto="${esc(s.texto)}">${Icono.archivar}</button>`}
        </div>
      </header>
      ${cabeza}
      <div class="ed-contenidos">
        <div class="ed-contenidos__titulo">${activos.length} ${plural(activos.length, 'contenido sugerido', 'contenidos sugeridos')}</div>
        ${visibles.map((c) => fila(c, s)).join('')}
        ${estado.agregandoEn === s.id
          ? `<div class="ed-fila ed-fila--editando">
               <textarea class="ed-campo" id="ed-texto" rows="2" maxlength="500" placeholder="Escribí el contenido"></textarea>
               <div class="ed-acciones-campo">
                 <button type="button" class="ed-boton ed-boton--guardar" data-accion="ed-crear-contenido" data-id="${esc(s.id)}">Agregar</button>
                 <button type="button" class="ed-boton" data-accion="ed-cancelar">Cancelar</button>
               </div>
             </div>`
          : archivado ? ''
          : `<button type="button" class="ed-agregar" data-accion="ed-agregar-contenido" data-id="${esc(s.id)}">${Icono.mas} Agregar un contenido</button>`}
      </div>
    </article>`;
  }

  function panelConfirmar() {
    const c = estado.confirmar;
    if (!c) return '';
    const conRespuestas = c.respuestas > 0;
    return `<div class="t-velo" data-accion="ed-cancelar"></div>
    <div class="t-panel ed-panel" role="dialog" aria-modal="true">
      <h2 class="t-panel__titulo">¿Archivar este ${c.tipo}?</h2>
      <p class="bajada">“${esc(c.texto.slice(0, 160))}${c.texto.length > 160 ? '…' : ''}”</p>
      <p class="bajada">Deja de ofrecerse a los docentes en la próxima publicación${conRespuestas
        ? `, pero <strong>las ${c.respuestas} ${plural(c.respuestas, 'respuesta que ya tiene se conserva', 'respuestas que ya tiene se conservan')}</strong> y se siguen viendo en los resultados.`
        : '. No tiene respuestas todavía.'} Se puede volver atrás cuando quieras.</p>
      ${c.tipo === 'saber' ? '<p class="bajada">Se archivan también sus contenidos.</p>' : ''}
      <div class="campo">
        <label class="campo__etiqueta" for="ed-nota">Por qué (queda en el historial)</label>
        <input class="entrada" id="ed-nota" type="text" maxlength="200" placeholder="Opcional">
      </div>
      <div class="t-panel__acciones">
        <button type="button" class="t-descargar" data-accion="ed-confirmar-archivar" ${estado.guardando ? 'disabled' : ''}>${estado.guardando ? 'Archivando…' : 'Archivar'}</button>
        <button type="button" class="t-cancelar" data-accion="ed-cancelar">Cancelar</button>
      </div>
    </div>`;
  }

  function panelHistorial() {
    if (!estado.historial) return '';
    const filas = estado.historial.length
      ? estado.historial.map((h) => `
        <div class="ed-historial__fila">
          <div class="ed-historial__cabecera">
            <span class="ed-historial__accion ed-historial__accion--${esc(h.accion)}">${esc(h.accion)}</span>
            <span class="ed-historial__fecha">${new Date(h.momento).toLocaleString('es-AR')}</span>
            <span class="ed-historial__usuario">${esc(h.usuario)}</span>
          </div>
          ${h.texto_antes && h.texto_antes !== h.texto_despues ? `<div class="ed-historial__antes">${esc(h.texto_antes)}</div>` : ''}
          ${h.texto_despues ? `<div class="ed-historial__despues">${esc(h.texto_despues)}</div>` : ''}
          ${h.nota ? `<div class="ed-historial__nota">${esc(h.nota)}</div>` : ''}
        </div>`).join('')
      : '<div class="ed-vacio">Todavía no hay cambios registrados.</div>';
    return `<div class="t-velo" data-accion="ed-cerrar-historial"></div>
    <div class="t-panel ed-panel ed-panel--historial" role="dialog" aria-modal="true">
      <div class="t-panel__cabecera">
        <h2 class="t-panel__titulo">Historial de cambios</h2>
        <button type="button" class="t-panel__cerrar" data-accion="ed-cerrar-historial" aria-label="Cerrar">${svg('<path d="M6 6l12 12"/><path d="M18 6L6 18"/>', { tam: 21, color: '#55605A', grosor: 2.4 })}</button>
      </div>
      <div class="ed-historial">${filas}</div>
    </div>`;
  }

  function haceCuanto(iso) {
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'recién';
    if (min < 60) return 'hace ' + min + ' ' + plural(min, 'minuto', 'minutos');
    const h = Math.round(min / 60);
    if (h < 24) return 'hace ' + h + ' ' + plural(h, 'hora', 'horas');
    const d = Math.round(h / 24);
    return 'hace ' + d + ' ' + plural(d, 'día', 'días');
  }

  // Lo que edita el equipo vale enseguida para los resultados, pero el docente
  // lee el catálogo publicado. Esta línea dice en cuál de los dos estados está.
  function notaPublicar() {
    const p = estado.publicacion || {};
    const pendientes = Number(p.cambios_sin_publicar || 0);
    if (!p.publicado_en) {
      return `<div class="ed-nota-publicar">
        El catálogo todavía no se publicó desde acá: los docentes ven el que viaja con la página.
        Cuando toques <strong>Publicar</strong>, pasan a ver este.
      </div>`;
    }
    if (pendientes > 0) {
      return `<div class="ed-nota-publicar">
        Hay <strong>${pendientes} ${plural(pendientes, 'cambio sin publicar', 'cambios sin publicar')}</strong>.
        Los docentes siguen viendo lo que se publicó ${esc(haceCuanto(p.publicado_en))}.
        Tocá <strong>Publicar</strong> para que lo vean.
      </div>`;
    }
    return `<div class="ed-nota-publicar ed-nota-publicar--ok">
      Todo publicado. Los docentes ven este catálogo desde ${esc(haceCuanto(p.publicado_en))}${p.publicado_por ? ', lo publicó ' + esc(p.publicado_por) : ''}.
    </div>`;
  }

  /* ---------- Pantalla ---------- */

  function pantalla({ nombreMateria, textoAnio }) {
    estado.nombreMateria = nombreMateria;
    estado.textoAnio = textoAnio;
    if (estado.cargando) return `<div class="t-estado"><div class="t-estado__texto">Trayendo el catálogo…</div></div>`;
    if (estado.error && !estado.datos) {
      return `<div class="t-estado">
        <div class="t-estado__titulo">No pudimos traer el catálogo</div>
        <div class="t-estado__texto">${esc(estado.error)}</div>
        <button type="button" class="boton boton--primario boton--66" data-accion="ed-reintentar">Volver a intentar</button>
      </div>`;
    }
    const d = estado.datos;
    if (!d) return '';
    const saberes = d.saberes || [];
    const activos = saberes.filter((s) => s.estado === 'activo');
    const contenidos = saberes.reduce((n, s) => n + (s.contenidos || []).filter((c) => c.estado === 'activo').length, 0);
    // Lo archivado no se muestra salvo que se pida: después de reemplazar una
    // materia, los saberes viejos quedaban mezclados en gris con los nuevos y
    // parecía que no se había reemplazado nada.
    const nArchivados = saberes.length - activos.length
      + activos.reduce((n, s) => n + (s.contenidos || []).filter((c) => c.estado !== 'activo').length, 0);
    const visibles = estado.verArchivados ? saberes : activos;
    const ejes = [];
    for (const s of saberes) if (!ejes.some((e) => e.id === s.eje_id)) ejes.push({ id: s.eje_id, nombre: s.eje });

    return `
      ${estado.aviso ? `<div class="ed-aviso" role="status">${esc(estado.aviso)}</div>` : ''}
      ${estado.error ? `<div class="ed-aviso ed-aviso--error" role="alert">${esc(estado.error)}</div>` : ''}
      <div class="ed-barra">
        <div class="ed-barra__texto">
          <strong>${esc(nombreMateria)} · ${esc(textoAnio)}</strong> ·
          ${activos.length} ${plural(activos.length, 'saber', 'saberes')} y ${contenidos} contenidos activos
        </div>
        <div class="ed-barra__botones">
          <button type="button" class="ed-boton" data-accion="ed-historial">${Icono.reloj} Ver historial</button>
          <button type="button" class="ed-boton" data-accion="ar-abrir">${Icono.bajar} Exportar e importar</button>
          <button type="button" class="ed-boton ed-boton--publicar" data-accion="ed-publicar"${estado.publicando ? ' disabled' : ''}>${Icono.subir} ${estado.publicando ? 'Publicando…' : 'Publicar'}</button>
        </div>
      </div>
      ${notaPublicar()}
      ${estado.saberNuevo ? `
        <article class="ed-saber ed-saber--nuevo">
          <header class="ed-saber__cabecera"><div class="ed-saber__datos"><span class="ed-saber__eje">Saber nuevo</span></div></header>
          <label class="ed-select-linea">Eje
            <select id="ed-eje" class="ed-select">${ejes.map((e) => `<option value="${esc(e.id)}">${esc(e.nombre)}</option>`).join('')}</select>
          </label>
          <textarea class="ed-campo ed-campo--saber" id="ed-texto" rows="4" maxlength="1500" placeholder="Texto del saber, como lo escribiría el diseño curricular"></textarea>
          <div class="ed-acciones-campo">
            <label class="ed-select-linea">Trimestre
              <select id="ed-trimestre" class="ed-select">${[1, 2, 3].map((t) => `<option value="${t}">${ORDINAL[t]}</option>`).join('')}</select>
            </label>
            <button type="button" class="ed-boton ed-boton--guardar" data-accion="ed-crear-saber">Agregar saber</button>
            <button type="button" class="ed-boton" data-accion="ed-cancelar">Cancelar</button>
          </div>
        </article>`
        : `<button type="button" class="ed-agregar ed-agregar--saber" data-accion="ed-nuevo-saber">${Icono.mas} Agregar un saber</button>`}
      ${nArchivados ? `<div class="ed-archivados">
        <button type="button" class="ed-archivados__boton" data-accion="ed-ver-archivados">${estado.verArchivados
          ? 'Ocultar lo archivado'
          : `Ver lo archivado (${nArchivados})`}</button>
      </div>` : ''}
      ${visibles.length
        ? `<div class="ed-lista">${visibles.map(tarjetaSaber).join('')}</div>`
        : '<div class="ed-vacio">No hay saberes activos en este año. Podés agregar uno o subir la planilla de la materia.</div>'}
      ${panelConfirmar()}
      ${panelHistorial()}
      ${Archivo.panel()}
    `;
  }

  /* ---------- Acciones ---------- */

  const valor = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

  async function manejar(accion, d, el) {
    if (accion.startsWith('ar-')) {
      const mensaje = await Archivo.accion(accion, el, alRefrescar);
      if (mensaje) {
        clearTimeout(relojAviso);
        estado.aviso = mensaje;
        pintar();
        relojAviso = setTimeout(() => { estado.aviso = null; pintar(); }, 12000);
      }
      return;
    }
    switch (accion) {
      case 'ed-reintentar': if (alRefrescar) await alRefrescar(); break;
      case 'ed-editar': estado.editando = d.id; estado.agregandoEn = null; estado.saberNuevo = null; pintar(); enfocar(); break;
      case 'ed-cancelar':
        estado.editando = null; estado.agregandoEn = null; estado.saberNuevo = null; estado.confirmar = null; estado.error = null;
        pintar();
        break;
      case 'ed-agregar-contenido': estado.agregandoEn = d.id; estado.editando = null; pintar(); enfocar(); break;
      case 'ed-nuevo-saber': estado.saberNuevo = {}; estado.editando = null; pintar(); enfocar(); break;

      case 'ed-guardar-contenido':
        await llamar('guardar_contenido', { payload: { id: d.id, texto: valor('ed-texto') } }, 'Contenido guardado.');
        break;
      case 'ed-crear-contenido':
        await llamar('guardar_contenido', { payload: { saber_id: d.id, texto: valor('ed-texto') } }, 'Contenido agregado.');
        break;
      case 'ed-guardar-saber':
        await llamar('guardar_saber', {
          payload: {
            id: d.id, eje_id: d.eje, texto: valor('ed-texto'),
            anio: d.anio === '' ? null : Number(d.anio),
            trimestre: Number(valor('ed-trimestre')),
          },
        }, 'Saber guardado.');
        break;
      case 'ed-crear-saber':
        await llamar('guardar_saber', {
          payload: {
            eje_id: valor('ed-eje'), texto: valor('ed-texto'),
            anio: estado.anioActual, trimestre: Number(valor('ed-trimestre')),
          },
        }, 'Saber agregado.');
        break;

      case 'ed-pedir-archivar':
        estado.confirmar = { tipo: d.tipo, id: d.id, texto: d.texto || '', respuestas: Number(d.respuestas || 0) };
        pintar();
        break;
      case 'ed-confirmar-archivar': {
        const c = estado.confirmar;
        await llamar('archivar_catalogo', {
          p_tabla: c.tipo === 'saber' ? 'saberes' : 'contenidos_sugeridos',
          p_id: c.id, p_archivar: true, p_nota: valor('ed-nota'),
        }, c.tipo === 'saber' ? 'Saber archivado. Si lo necesitás, está en «Ver lo archivado».' : 'Contenido archivado. Si lo necesitás, está en «Ver lo archivado».');
        break;
      }
      case 'ed-archivar-saber':
        await llamar('archivar_catalogo', { p_tabla: 'saberes', p_id: d.id, p_archivar: false }, 'Saber restaurado.');
        break;
      case 'ed-archivar-contenido':
        await llamar('archivar_catalogo', { p_tabla: 'contenidos_sugeridos', p_id: d.id, p_archivar: false }, 'Contenido restaurado.');
        break;

      case 'ed-historial': {
        const { data } = await sb.rpc('historial_catalogo', { p_limite: 100, p_registro_id: d.id || null });
        estado.historial = data || [];
        pintar();
        break;
      }
      case 'ed-cerrar-historial': estado.historial = null; pintar(); break;
      case 'ed-ver-archivados': estado.verArchivados = !estado.verArchivados; pintar(); break;
      case 'ed-publicar': await publicar(); break;
      default: return false;
    }
    return true;
  }

  function enfocar() {
    const el = document.getElementById('ed-texto');
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }

  // Sube el catálogo al bucket que lee el formulario. Es un archivo estático
  // servido por el CDN, no la base: diez mil docentes lo descargan el mismo día
  // sin que PostgreSQL se entere.
  async function publicar() {
    estado.publicando = true; estado.error = null; estado.aviso = null; pintar();
    try {
      const { data, error } = await sb.rpc('exportar_catalogo');
      if (error || (data && data.error)) throw new Error((data && data.error) || error.message);
      if (!data.saberes || !data.saberes.length) throw new Error('el catálogo vendría vacío');

      const cuerpo = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const subida = await sb.storage.from('catalogo').upload('catalogo.json', cuerpo, {
        upsert: true,
        contentType: 'application/json',
        cacheControl: '300',    // cinco minutos: lo que tarda una corrección en verse
      });
      if (subida && subida.error) throw new Error(subida.error.message);

      await sb.rpc('registrar_publicacion', {
        p_saberes: data.saberes.length,
        p_contenidos: data.contenidos.length,
      });

      estado.publicando = false;
      clearTimeout(relojAviso);
      estado.aviso = `Publicado: ${data.saberes.length} saberes y ${data.contenidos.length} contenidos. `
        + 'Los docentes que entren de ahora en más ven esta versión; los que ya estaban cargando '
        + 'terminan con la anterior.';
      if (alRefrescar) await alRefrescar();
      relojAviso = setTimeout(() => { estado.aviso = null; pintar(); }, 9000);
    } catch (e) {
      estado.publicando = false;
      estado.error = 'No pudimos publicar: ' + ((e && e.message) || 'error desconocido')
        + '. Probá de nuevo; si sigue fallando, bajá el JSON desde «Exportar e importar» y '
        + 'subilo al repositorio.';
      pintar();
    }
  }

  /* ---------- Enganche con el dashboard ---------- */

  let pintar = () => {};

  function iniciar(cliente, { render, refrescar }) {
    sb = cliente;
    pintar = render;
    alRefrescar = refrescar;
    Archivo.iniciar(cliente, {
      render,
      datosContexto: () => ({
        espacio_id: estado.espacio_id, anio: estado.anio,
        nombreMateria: estado.nombreMateria, textoAnio: estado.textoAnio,
      }),
    });
  }

  return {
    iniciar,
    cargar,
    pantalla,
    manejar,
    estado,
    limpiar() { estado.datos = null; estado.editando = null; estado.agregandoEn = null; estado.saberNuevo = null; estado.confirmar = null; estado.historial = null; estado.verArchivados = false; },
  };
})();
