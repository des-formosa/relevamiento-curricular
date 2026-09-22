/* ============================================================================
   Exportar e importar el catálogo — para el equipo de Planificación.

   El catálogo se revisa en Excel, no en la pantalla: es más cómodo leer 942
   saberes de corrido y repartir el trabajo entre varias personas. Este módulo
   baja ese Excel y lo vuelve a subir corregido.

   La misma forma en las dos direcciones: una fila por contenido, con los ids
   en columnas. El archivo que baja se puede volver a subir tal cual y no pasa
   nada, que es la prueba de que el ida y vuelta cierra.

   Regla que hay que tener presente al leer esto: lo que no está en el archivo
   no se toca. Ausencia no es baja. Para archivar algo hay que escribirlo en la
   columna «estado» (ver sql/11_importar_catalogo.sql).
   ============================================================================ */

const Archivo = (function () {
  'use strict';

  const URL_SHEETJS = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

  // Las columnas del Excel, en orden. La clave es la que entiende el SQL.
  const COLUMNAS = [
    { clave: 'materia',          titulo: 'Materia',              ancho: 26 },
    { clave: 'eje_id',           titulo: 'eje_id',               ancho: 22 },
    { clave: 'eje',              titulo: 'Eje',                  ancho: 40 },
    { clave: 'saber_id',         titulo: 'saber_id',             ancho: 26 },
    { clave: 'anio',             titulo: 'Año',                  ancho: 6 },
    { clave: 'trimestre',        titulo: 'Trimestre',            ancho: 10 },
    { clave: 'saber',            titulo: 'Saber',                ancho: 80 },
    { clave: 'saber_estado',     titulo: 'Estado del saber',     ancho: 16 },
    { clave: 'contenido_id',     titulo: 'contenido_id',         ancho: 30 },
    { clave: 'contenido',        titulo: 'Contenido',            ancho: 55 },
    { clave: 'contenido_estado', titulo: 'Estado del contenido', ancho: 18 },
  ];

  // Los títulos se reconocen normalizados, así no importa si Excel los devuelve
  // con otra capitalización o con acentos comidos
  const PorTitulo = {};
  for (const c of COLUMNAS) PorTitulo[normalizarTexto(c.titulo)] = c.clave;

  let sb = null;
  let pintar = () => {};
  let contexto = () => ({});    // { espacio_id, anio, nombreMateria, textoAnio }

  const estado = {
    abierto: false,
    que: 'vista',        // 'vista' | 'todo'
    trabajando: null,    // texto de lo que está pasando
    error: null,
    aviso: null,
    importe: null,       // { archivo, filas, resumen } después de mirar
    aplicando: false,
  };

  /* ---------- Utilidades ---------- */

  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function plural(n, uno, varios) { return n === 1 ? uno : varios; }

  function cargarSheetJS() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((resolver, rechazar) => {
      const s = document.createElement('script');
      s.src = URL_SHEETJS;
      s.onload = () => resolver();
      s.onerror = () => rechazar(new Error('No pudimos cargar la librería para leer el Excel. Revisá la conexión.'));
      document.head.appendChild(s);
    });
  }

  function nombreArchivo(extension) {
    const c = contexto();
    const limpio = (t) => normalizarTexto(t || '').replace(/\s+/g, '-');
    const hoy = new Date().toISOString().slice(0, 10);
    const que = estado.que === 'todo' ? 'completo' : `${limpio(c.nombreMateria)}-${c.anio}-anio`;
    return `catalogo-${que}-${hoy}.${extension}`;
  }

  function bajar(contenido, nombre, tipo) {
    const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ---------- Exportar ---------- */

  async function traerFilas() {
    const c = contexto();
    const params = estado.que === 'todo'
      ? {}
      : { p_espacio_id: c.espacio_id, p_anio: c.anio };
    const { data, error } = await sb.rpc('catalogo_filas', params);
    if (error) throw new Error(error.message);
    if (data && data.error) throw new Error(data.error);
    return data || [];
  }

  async function exportarExcel() {
    estado.error = null;
    estado.trabajando = 'Armando el Excel…';
    pintar();
    try {
      const [filas] = await Promise.all([traerFilas(), cargarSheetJS()]);
      const X = window.XLSX;
      const hoja = X.utils.aoa_to_sheet([
        COLUMNAS.map((c) => c.titulo),
        ...filas.map((f) => COLUMNAS.map((c) => (f[c.clave] == null ? '' : f[c.clave]))),
      ]);
      hoja['!cols'] = COLUMNAS.map((c) => ({ wch: c.ancho }));
      hoja['!freeze'] = { xSplit: 0, ySplit: 1 };
      const libro = X.utils.book_new();
      X.utils.book_append_sheet(libro, hoja, 'Catálogo');
      X.writeFile(libro, nombreArchivo('xlsx'));
      estado.trabajando = null;
      estado.aviso = `Se descargaron ${filas.length} ${plural(filas.length, 'fila', 'filas')}. `
        + 'Corregilo y volvé a subirlo acá mismo: los ids son los que hacen que cada corrección '
        + 'caiga en su lugar, así que conviene no tocarlos.';
    } catch (e) {
      estado.trabajando = null;
      estado.error = (e && e.message) || 'No pudimos armar el Excel.';
    }
    pintar();
  }

  async function exportarJSON() {
    estado.error = null;
    estado.trabajando = 'Armando el archivo…';
    pintar();
    try {
      const { data, error } = await sb.rpc('exportar_catalogo');
      if (error || (data && data.error)) throw new Error((data && data.error) || error.message);
      bajar(JSON.stringify(data, null, 1), 'catalogo.json', 'application/json');
      estado.trabajando = null;
      estado.aviso = 'Se descargó catalogo.json con el catálogo activo, en la forma que lee el '
        + 'formulario. Sirve de respaldo: es el archivo que va en datos/catalogo.json del repositorio.';
    } catch (e) {
      estado.trabajando = null;
      estado.error = (e && e.message) || 'No pudimos armar el archivo.';
    }
    pintar();
  }

  /* ---------- Leer el archivo que suben ---------- */

  // Excel → filas. La primera hoja, la primera fila son los títulos.
  async function filasDeExcel(buffer) {
    await cargarSheetJS();
    const libro = window.XLSX.read(buffer, { type: 'array' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    if (!hoja) throw new Error('El Excel no tiene ninguna hoja con datos.');
    const crudas = window.XLSX.utils.sheet_to_json(hoja, { header: 1, blankrows: false, defval: '' });
    if (!crudas.length) throw new Error('El Excel está vacío.');

    const titulos = crudas[0].map((t) => PorTitulo[normalizarTexto(String(t))] || null);
    if (!titulos.includes('saber_id') && !titulos.includes('saber')) {
      throw new Error('No reconocemos las columnas de este Excel. Bajá el archivo con «Exportar» '
        + 'y corregí sobre ese, sin cambiarle los títulos de la primera fila.');
    }
    return crudas.slice(1).map((fila, i) => {
      const o = { fila: i + 2 };      // +2: la 1 son los títulos y Excel cuenta desde 1
      titulos.forEach((clave, col) => {
        if (clave) o[clave] = fila[col] == null ? '' : String(fila[col]).trim();
      });
      return o;
    });
  }

  // catalogo.json → las mismas filas, para que el SQL reciba siempre lo mismo
  function filasDeJSON(texto) {
    let c;
    try { c = JSON.parse(texto); } catch (e) { throw new Error('El archivo no es un JSON válido.'); }
    if (!c || !Array.isArray(c.saberes)) {
      throw new Error('Ese JSON no tiene la forma de un catálogo (le faltan los saberes).');
    }
    const porSaber = new Map();
    for (const co of c.contenidos || []) {
      if (!porSaber.has(co.saber_id)) porSaber.set(co.saber_id, []);
      porSaber.get(co.saber_id).push(co);
    }
    const filas = [];
    let n = 1;
    for (const s of c.saberes) {
      const suyos = porSaber.get(s.id) || [];
      const base = {
        eje_id: s.eje_id || '', saber_id: s.id || '',
        anio: s.anio == null ? '' : String(s.anio),
        trimestre: s.trimestre == null ? '' : String(s.trimestre),
        saber: s.texto || '',
      };
      if (!suyos.length) {
        filas.push(Object.assign({ fila: ++n }, base));
        continue;
      }
      for (const co of suyos) {
        filas.push(Object.assign({ fila: ++n }, base, {
          contenido_id: co.id || '', contenido: co.texto || '',
        }));
      }
    }
    return filas;
  }

  async function elegirArchivo(input) {
    const f = input && input.files && input.files[0];
    if (!f) return;
    estado.error = null;
    estado.aviso = null;
    estado.importe = null;
    estado.trabajando = 'Leyendo el archivo…';
    pintar();
    try {
      const esJSON = /\.json$/i.test(f.name);
      const filas = esJSON
        ? filasDeJSON(await f.text())
        : await filasDeExcel(await f.arrayBuffer());
      if (!filas.length) throw new Error('El archivo no trae ninguna fila.');

      estado.trabajando = `Revisando ${filas.length} ${plural(filas.length, 'fila', 'filas')}…`;
      pintar();

      // Primero se mira: p_aplicar en false no escribe nada
      const { data, error } = await sb.rpc('importar_catalogo', {
        p_filas: filas, p_aplicar: false, p_archivo: f.name,
      });
      if (error) throw new Error(error.message);

      estado.trabajando = null;
      estado.importe = { archivo: f.name, filas: filas, resumen: data };
    } catch (e) {
      estado.trabajando = null;
      estado.error = (e && e.message) || 'No pudimos leer el archivo.';
    }
    if (input) input.value = '';
    pintar();
  }

  async function aplicar(alRefrescar) {
    const im = estado.importe;
    if (!im || estado.aplicando) return;
    estado.aplicando = true;
    estado.error = null;
    pintar();
    try {
      const { data, error } = await sb.rpc('importar_catalogo', {
        p_filas: im.filas, p_aplicar: true, p_archivo: im.archivo,
      });
      if (error) throw new Error(error.message);
      estado.aplicando = false;
      estado.importe = null;
      estado.abierto = false;
      estado.aviso = null;
      if (alRefrescar) await alRefrescar();
      return resumenCorto(data) + ' Queda todo en el historial. Acordate de publicar para que lo vean los docentes.';
    } catch (e) {
      estado.aplicando = false;
      estado.error = (e && e.message) || 'No pudimos aplicar los cambios.';
      pintar();
    }
    return null;
  }

  /* ---------- Cómo se cuenta lo que va a pasar ---------- */

  const RENGLONES = [
    ['saberes_nuevos', 'saber nuevo', 'saberes nuevos'],
    ['saberes_editados', 'saber corregido', 'saberes corregidos'],
    ['saberes_archivados', 'saber que se archiva', 'saberes que se archivan'],
    ['saberes_restaurados', 'saber que se restaura', 'saberes que se restauran'],
    ['contenidos_nuevos', 'contenido nuevo', 'contenidos nuevos'],
    ['contenidos_editados', 'contenido corregido', 'contenidos corregidos'],
    ['contenidos_archivados', 'contenido que se archiva', 'contenidos que se archivan'],
    ['contenidos_restaurados', 'contenido que se restaura', 'contenidos que se restauran'],
  ];

  function cambios(r) {
    return RENGLONES.filter(([clave]) => Number(r[clave] || 0) > 0)
      .map(([clave, uno, varios]) => `${r[clave]} ${plural(Number(r[clave]), uno, varios)}`);
  }

  function resumenCorto(r) {
    const c = cambios(r);
    if (!c.length) return 'El archivo no traía ningún cambio.';
    return 'Importado: ' + c.join(', ') + '.';
  }

  /* ---------- Pantalla ---------- */

  function bloqueImporte() {
    const im = estado.importe;
    const r = im.resumen || {};
    const errores = r.errores || [];
    const lista = cambios(r);

    if (errores.length) {
      return `
        <div class="ar-resumen ar-resumen--error">
          <div class="ar-resumen__titulo">${errores.length} ${plural(errores.length, 'fila tiene un problema', 'filas tienen problemas')}</div>
          <p class="bajada">No se puede importar hasta que estén resueltas. Corregilas en el archivo y volvé a subirlo: no se aplicó ningún cambio.</p>
          <ul class="ar-errores">
            ${errores.slice(0, 8).map((e) => `<li><strong>Fila ${esc(e.fila)}</strong> · ${esc(e.mensaje)}</li>`).join('')}
          </ul>
          ${errores.length > 8 ? `<p class="bajada">Y ${errores.length - 8} más.</p>` : ''}
        </div>
        <div class="t-panel__acciones">
          <button type="button" class="t-cancelar" data-accion="ar-cancelar-importe">Entendido</button>
        </div>`;
    }

    if (!lista.length) {
      return `
        <div class="ar-resumen">
          <div class="ar-resumen__titulo">El archivo no trae cambios</div>
          <p class="bajada">Revisamos las ${r.filas} ${plural(r.filas, 'fila', 'filas')} de
            «${esc(im.archivo)}» y dicen lo mismo que el catálogo. No hay nada que aplicar.</p>
        </div>
        <div class="t-panel__acciones">
          <button type="button" class="t-cancelar" data-accion="ar-cancelar-importe">Cerrar</button>
        </div>`;
    }

    const ejemplos = r.ejemplos || [];
    return `
      <div class="ar-resumen">
        <div class="ar-resumen__titulo">Esto es lo que haría</div>
        <ul class="ar-cuenta">${lista.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        <p class="bajada">De las ${r.filas} ${plural(r.filas, 'fila', 'filas')} de «${esc(im.archivo)}»,
          ${r.sin_cambios} ${plural(r.sin_cambios, 'ya decía', 'ya decían')} lo mismo.
          <strong>Los saberes que el archivo no menciona quedan como están</strong>: no se archiva nada por no figurar.</p>
        ${ejemplos.length ? `
          <div class="ar-ejemplos__titulo">Algunos de los cambios</div>
          <ul class="ar-ejemplos">
            ${ejemplos.map((e) => `
              <li>
                <span class="ar-ejemplo__que">${esc(e.que)}</span>
                ${e.antes ? `<span class="ar-ejemplo__antes">${esc(e.antes)}</span>` : ''}
                ${e.despues ? `<span class="ar-ejemplo__despues">${esc(e.despues)}</span>` : ''}
              </li>`).join('')}
          </ul>` : ''}
        <p class="bajada">Nada se borra: lo que se archiva conserva sus respuestas y se puede restaurar.</p>
      </div>
      <div class="t-panel__acciones">
        <button type="button" class="t-descargar" data-accion="ar-aplicar" ${estado.aplicando ? 'disabled' : ''}>${estado.aplicando ? 'Aplicando…' : 'Aplicar los cambios'}</button>
        <button type="button" class="t-cancelar" data-accion="ar-cancelar-importe">Cancelar</button>
      </div>`;
  }

  function panel() {
    if (!estado.abierto) return '';
    const c = contexto();
    return `<div class="t-velo" data-accion="ar-cerrar"></div>
    <div class="t-panel ed-panel ar-panel" role="dialog" aria-modal="true">
      <div class="t-panel__cabecera">
        <h2 class="t-panel__titulo">Exportar e importar</h2>
        <button type="button" class="t-panel__cerrar" data-accion="ar-cerrar" aria-label="Cerrar">${svgCerrar()}</button>
      </div>

      ${estado.error ? `<div class="ed-aviso ed-aviso--error" role="alert">${esc(estado.error)}</div>` : ''}
      ${estado.aviso ? `<div class="ed-aviso" role="status">${esc(estado.aviso)}</div>` : ''}
      ${estado.trabajando ? `<div class="ar-trabajando">${esc(estado.trabajando)}</div>` : ''}

      ${estado.importe ? bloqueImporte() : `
        <section class="ar-seccion">
          <div class="ar-seccion__titulo">Exportar</div>
          <p class="bajada">El Excel trae una fila por contenido, con los ids en columnas. Es el
            archivo para repartir entre el equipo y corregir fuera del panel.</p>
          <div class="ar-opciones" role="radiogroup" aria-label="Qué exportar">
            <button type="button" class="ar-opcion ${estado.que === 'vista' ? 'ar-opcion--elegida' : ''}" data-accion="ar-que" data-que="vista" role="radio" aria-checked="${estado.que === 'vista'}">
              ${esc(c.nombreMateria || 'Esta materia')} · ${esc(c.textoAnio || '')}
            </button>
            <button type="button" class="ar-opcion ${estado.que === 'todo' ? 'ar-opcion--elegida' : ''}" data-accion="ar-que" data-que="todo" role="radio" aria-checked="${estado.que === 'todo'}">
              Todo el catálogo
            </button>
          </div>
          <div class="ar-botones">
            <button type="button" class="t-descargar" data-accion="ar-excel" ${estado.trabajando ? 'disabled' : ''}>Bajar el Excel</button>
            <button type="button" class="t-cancelar" data-accion="ar-json" ${estado.trabajando ? 'disabled' : ''}>Bajar el JSON</button>
          </div>
          <p class="ar-ayuda">El JSON es el respaldo del repositorio (<code>datos/catalogo.json</code>), no se corrige a mano.</p>
        </section>

        <section class="ar-seccion ar-seccion--importar">
          <div class="ar-seccion__titulo">Importar</div>
          <p class="bajada">Subí el Excel corregido, o un <code>catalogo.json</code>. Primero te
            mostramos qué cambiaría; no se toca nada hasta que confirmes.</p>
          <label class="ar-subir">
            <input type="file" accept=".xlsx,.xls,.json" data-accion="ar-elegir" ${estado.trabajando ? 'disabled' : ''}>
            <span>Elegir el archivo</span>
          </label>
          <p class="ar-ayuda">Las correcciones se cruzan por id. Lo que el archivo no menciona
            queda como está: ausencia no es baja.</p>
        </section>`}
    </div>`;
  }

  function svgCerrar() {
    return '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#55605A" '
      + 'stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>';
  }

  /* ---------- Enganche con el editor ---------- */

  function iniciar(cliente, { render, datosContexto }) {
    sb = cliente;
    pintar = render;
    contexto = datosContexto;
  }

  function abrir() {
    estado.abierto = true;
    estado.error = null;
    estado.aviso = null;
    estado.importe = null;
    estado.trabajando = null;
    pintar();
  }

  function cerrar() {
    estado.abierto = false;
    estado.importe = null;
    estado.error = null;
    estado.aviso = null;
    pintar();
  }

  // Devuelve un mensaje cuando la importación se aplicó, para que lo muestre el editor
  async function accion(nombre, el, alRefrescar) {
    switch (nombre) {
      case 'ar-abrir': abrir(); return null;
      case 'ar-cerrar': cerrar(); return null;
      case 'ar-que': estado.que = el.dataset.que; estado.aviso = null; pintar(); return null;
      case 'ar-excel': await exportarExcel(); return null;
      case 'ar-json': await exportarJSON(); return null;
      case 'ar-elegir': await elegirArchivo(el); return null;
      case 'ar-cancelar-importe': estado.importe = null; estado.error = null; pintar(); return null;
      case 'ar-aplicar': return await aplicar(alRefrescar);
      default: return undefined;
    }
  }

  return { iniciar, panel, accion, abierto: () => estado.abierto };
})();
