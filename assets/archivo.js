/* ============================================================================
   Exportar e importar el catálogo — para el equipo de Planificación.

   El equipo trabaja en Excel y no maneja ids. Lo que funciona para ellos es
   una PLANILLA por materia: una fila por saber, con año, trimestre, eje, el
   texto del saber y sus contenidos en columnas. Se baja desde acá ya
   completa, se corrige en Excel y se vuelve a subir.

   Subirla REEMPLAZA la materia (sql/12_reemplazar_materia.sql), pero con
   cuidado: solo los años que vienen en el archivo, y lo que no cambió
   —o cambió apenas, que es una corrección— conserva su identidad y sus
   respuestas. Antes de tocar nada se muestra cómo va a quedar.

   Si el archivo trae la columna saber_id completa, es el Excel de
   correcciones de antes (sql/11): se corrige saber por saber y lo que no
   está en el archivo no se toca. Se sigue aceptando, pero ya no se ofrece.
   ============================================================================ */

const Archivo = (function () {
  'use strict';

  const URL_SHEETJS = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

  // El Excel de correcciones por id (sql/11). Se reconoce por sus títulos.
  const COLUMNAS_ID = {
    'materia': 'materia', 'eje id': 'eje_id', 'eje': 'eje', 'saber id': 'saber_id',
    'ano': 'anio', 'anio': 'anio', 'trimestre': 'trimestre', 'saber': 'saber',
    'estado del saber': 'saber_estado', 'contenido id': 'contenido_id',
    'contenido': 'contenido', 'estado del contenido': 'contenido_estado',
  };

  let sb = null;
  let pintar = () => {};
  let contexto = () => ({});    // { espacio_id, anio, nombreMateria, textoAnio }

  const estado = {
    abierto: false,
    trabajando: null,    // texto de lo que está pasando
    error: null,
    aviso: null,
    importe: null,       // { modo, archivo, datos, resumen } después de mirar
    aplicando: false,
  };

  /* ---------- Utilidades ---------- */

  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function plural(n, uno, varios) { return Number(n) === 1 ? uno : varios; }

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

  function materia() {
    const c = contexto();
    const esp = (typeof Catalogo !== 'undefined' && Catalogo.espacio(c.espacio_id)) || {};
    return {
      id: c.espacio_id,
      nombre: c.nombreMateria || esp.nombre || '',
      completo: esp.nombre || c.nombreMateria || '',
      porCiclo: Boolean(esp.saberes_por_ciclo),
      anios: esp.anios_dictados || [1, 2, 3],
    };
  }

  const textoAnios = (lista) => {
    const t = lista.map((a) => `${a}°`);
    return t.length > 1 ? `${t.slice(0, -1).join(', ')} y ${t[t.length - 1]}` : t[0] || '';
  };

  /* ---------- Bajar la planilla ---------- */

  async function bajarPlanilla() {
    const m = materia();
    estado.error = null;
    estado.aviso = null;
    estado.trabajando = `Armando la planilla de ${m.nombre}…`;
    pintar();
    try {
      const [{ data, error }] = await Promise.all([
        sb.rpc('catalogo_filas', { p_espacio_id: m.id, p_anio: null }),
        cargarSheetJS(),
      ]);
      if (error) throw new Error(error.message);
      if (data && data.error) throw new Error(data.error);

      // Una fila por saber activo, con sus contenidos activos. catalogo_filas
      // ya viene en el orden del equipo (año, trimestre y ciclado): las filas
      // salen así, y ese orden es el que vuelve cuando la suben.
      const ejes = [];
      const saberes = new Map();
      for (const f of data || []) {
        if (!ejes.some((e) => e.id === f.eje_id)) ejes.push({ id: f.eje_id, nombre: f.eje, orden: Number(f.eje_orden) || 0 });
        if (f.saber_estado !== 'activo') continue;
        if (!saberes.has(f.saber_id)) {
          saberes.set(f.saber_id, { codigo: f.saber_id, anio: f.anio, trimestre: f.trimestre,
            eje: f.eje, posicion: saberes.size, texto: f.saber, contenidos: [] });
        }
        if (f.contenido && f.contenido_estado === 'activo') saberes.get(f.saber_id).contenidos.push(f.contenido);
      }
      ejes.sort((a, b) => a.orden - b.orden);
      const lista = [...saberes.values()].sort((a, b) =>
        (a.anio || 0) - (b.anio || 0) || a.trimestre - b.trimestre || a.posicion - b.posicion);

      const nCont = Math.max(6, ...lista.map((s) => s.contenidos.length));
      const titulos = ['Año', 'Trimestre', 'Eje', 'Saber',
        ...Array.from({ length: nCont }, (_, i) => `Contenido ${i + 1}`), 'Código (no tocar)'];
      const filas = lista.map((s) => [
        m.porCiclo ? '' : s.anio, s.trimestre, s.eje, s.texto,
        ...Array.from({ length: nCont }, (_, i) => s.contenidos[i] || ''), s.codigo,
      ]);

      const X = window.XLSX;
      const hoja = X.utils.aoa_to_sheet([titulos, ...filas]);
      hoja['!cols'] = [{ wch: 6 }, { wch: 10 }, { wch: 34 }, { wch: 70 },
        ...Array.from({ length: nCont }, () => ({ wch: 40 })), { wch: 30 }];
      hoja['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length, c: titulos.length - 1 } }) };

      const libro = X.utils.book_new();
      X.utils.book_append_sheet(libro, hoja, 'Saberes');
      X.utils.book_append_sheet(libro, hojaInstrucciones(m, ejes), 'Cómo se completa');
      const limpio = normalizarTexto(m.nombre).replace(/\s+/g, '-');
      X.writeFile(libro, `planilla-${limpio}-${new Date().toISOString().slice(0, 10)}.xlsx`);

      estado.trabajando = null;
      estado.aviso = `Se bajó la planilla de ${m.nombre}: ${lista.length} ${plural(lista.length, 'saber', 'saberes')}. `
        + 'Corregila en Excel y subila acá mismo. La segunda hoja explica cómo completarla.';
    } catch (e) {
      estado.trabajando = null;
      estado.error = (e && e.message) || 'No pudimos armar la planilla.';
    }
    pintar();
  }

  // La hoja de instrucciones, para quien la abre sin haber visto nunca el panel
  function hojaInstrucciones(m, ejes) {
    const numeros = m.anios.map(String);
    const anio = m.porCiclo
      ? 'Dejala vacía: en esta materia los saberes son para todo el Ciclo Básico.'
      : `Escribí solo el número: ${numeros.length > 1 ? `${numeros.slice(0, -1).join(', ')} o ${numeros[numeros.length - 1]}` : numeros[0]}.`;
    const filas = [
      [`Planilla de ${m.completo}`, ''],
      ['', ''],
      ['Cómo está armada', 'Una fila por saber. Los contenidos de cada saber van en las columnas «Contenido 1», «Contenido 2», etcétera, uno por columna.'],
      ['Año', anio],
      ['Trimestre', '1, 2 o 3.'],
      ['Eje', 'Copiá uno de los ejes de abajo tal cual, o escribí solo el número del eje en romano (I, II, III…).'],
      ['Saber', 'El texto completo del saber.'],
      ['Contenidos', 'Los que hagan falta, uno por columna. Si necesitás más, agregá columnas con el mismo título: «Contenido 11», «Contenido 12»…'],
      ['Código (no tocar)', 'Lo usa el sistema para reconocer cada saber. No lo cambies. En un saber nuevo, dejalo vacío. Si copiás una fila para hacer un saber nuevo, borrale el código.'],
      ['', ''],
      ['El orden', 'El orden de las filas es el orden en que el docente ve los saberes de cada trimestre: el de más arriba va primero. Para cambiarlo, cortá la fila entera y pegala donde va.'],
      ['Cuidado al ordenar', 'No uses «Ordenar» del filtro sobre otra columna (por ejemplo, por Eje): cambiaría el orden de los saberes. Filtrar para ver un solo año sí se puede.'],
      ['', ''],
      ['Para agregar un saber', 'Agregá una fila con el código vacío.'],
      ['Para sacar un saber', 'Borrá la fila entera. No se pierde nada: queda archivado con sus respuestas.'],
      ['Para corregir', 'Cambiá el texto directamente. El saber conserva sus respuestas.'],
      ['IMPORTANTE', 'La planilla reemplaza la materia. Dentro de cada año que venga en la planilla, los saberes que no estén se sacan. Si querés corregir solo algunos, dejá los demás en la planilla tal como están.'],
      ['Si mandás un solo año', 'Los otros años de la materia no se tocan.'],
      ['', ''],
      ['Cómo se sube', 'Panel → Editar catálogo → elegir la materia arriba → Exportar e importar → Elegir el archivo. Antes de cambiar nada, el panel muestra cómo va a quedar. Si está bien: Aplicar, y después Publicar.'],
      ['', ''],
      [`Ejes de ${m.completo}`, ''],
      ...ejes.map((e) => ['', e.nombre]),
    ];
    const hoja = window.XLSX.utils.aoa_to_sheet(filas);
    hoja['!cols'] = [{ wch: 24 }, { wch: 110 }];
    return hoja;
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
      estado.aviso = 'Se descargó catalogo.json con el catálogo activo. Es el respaldo del repositorio (datos/catalogo.json).';
    } catch (e) {
      estado.trabajando = null;
      estado.error = (e && e.message) || 'No pudimos armar el archivo.';
    }
    pintar();
  }

  /* ---------- Leer lo que suben ---------- */

  async function hojaDeExcel(buffer) {
    await cargarSheetJS();
    const libro = window.XLSX.read(buffer, { type: 'array' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    if (!hoja) throw new Error('El Excel no tiene ninguna hoja con datos.');
    const crudas = window.XLSX.utils.sheet_to_json(hoja, { header: 1, blankrows: false, defval: '' });
    if (crudas.length < 2) throw new Error('El Excel no tiene filas debajo de los títulos.');
    return crudas;
  }

  const celda = (v) => (v == null ? '' : String(v).trim());

  // ¿Qué es cada columna? Devuelve también si es el Excel de correcciones por id
  function leerTitulos(titulos) {
    const col = { contenidos: [] };
    titulos.forEach((t, i) => {
      const n = normalizarTexto(celda(t));
      if (/^contenido( \d+)?$/.test(n)) col.contenidos.push(i);
      else if (n === 'ano' || n === 'anio') col.anio = i;
      else if (n === 'trimestre') col.trimestre = i;
      else if (n === 'eje') col.eje = i;
      else if (n === 'eje id') col.eje_id = i;
      else if (n === 'saber') col.saber = i;
      else if (n === 'saber id') col.saber_id = i;
      else if (n.startsWith('codigo')) col.codigo = i;
      else if (n === 'materia') col.materia = i;
    });
    return col;
  }

  // La planilla —o cualquier Excel con año, trimestre, eje, saber y contenidos—
  // en saberes. Sirve igual si viene una fila por saber (la planilla) que una
  // fila por contenido (el Excel que armó el equipo para Lengua).
  function saberesDePlanilla(crudas, m) {
    const col = leerTitulos(crudas[0]);
    const faltan = ['saber', 'trimestre'].filter((k) => col[k] == null);
    if (col.eje == null && col.eje_id == null) faltan.push('eje');
    if (!m.porCiclo && col.anio == null) faltan.push('año');
    if (faltan.length) {
      throw new Error(`Al Excel le faltan columnas: ${faltan.join(', ')}. `
        + 'Bajá la planilla de la materia desde acá y completá esa.');
    }

    const errores = [];
    const materias = new Set();
    const porClave = new Map();
    crudas.slice(1).forEach((fila, i) => {
      const n = i + 2;          // +2: la 1 son los títulos y Excel cuenta desde 1
      const texto = celda(fila[col.saber]);
      const contenidos = col.contenidos.map((c) => celda(fila[c])).filter(Boolean);
      if (!texto && !contenidos.length) return;       // fila en blanco
      if (col.materia != null && celda(fila[col.materia])) materias.add(celda(fila[col.materia]));

      const anio = m.porCiclo ? '' : celda(fila[col.anio]);
      const trimestre = celda(fila[col.trimestre]);
      const clave = `${normalizarTexto(texto)}|${anio}|${trimestre}`;
      const eje = celda(fila[col.eje_id != null ? col.eje_id : col.eje]) || celda(fila[col.eje]);
      const codigo = col.codigo != null ? celda(fila[col.codigo]) : '';

      const previo = porClave.get(clave);
      if (previo) {
        // Otra fila del mismo saber (una fila por contenido): se suman
        if (normalizarTexto(previo.eje) !== normalizarTexto(eje)) {
          errores.push({ fila: n, mensaje: `Este saber dice otro eje que en la fila ${previo.fila}.` });
        }
        for (const c of contenidos) {
          if (!previo.contenidos.some((x) => normalizarTexto(x) === normalizarTexto(c))) previo.contenidos.push(c);
        }
        if (!previo.codigo && codigo) previo.codigo = codigo;
        return;
      }
      porClave.set(clave, { fila: n, codigo, anio, trimestre, eje, texto, contenidos });
    });

    // El archivo dice de qué materia es: tiene que ser la elegida en el panel
    const nombres = [m.nombre, m.completo].map((x) => normalizarTexto(x));
    const otra = [...materias].find((x) => !nombres.includes(normalizarTexto(x)));
    if (otra) {
      throw new Error(`Este archivo es de «${otra}» y en el panel está elegida «${m.nombre}». `
        + 'Elegí la materia correcta arriba y volvé a subirlo.');
    }
    return { saberes: [...porClave.values()], errores };
  }

  // El Excel de correcciones por id, en las filas que espera sql/11
  function filasPorId(crudas) {
    const claves = crudas[0].map((t) => COLUMNAS_ID[normalizarTexto(celda(t))] || null);
    return crudas.slice(1).map((fila, i) => {
      const o = { fila: i + 2 };
      claves.forEach((clave, c) => { if (clave) o[clave] = celda(fila[c]); });
      return o;
    });
  }

  // catalogo.json → filas por id: es el respaldo, trae todos los ids
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
      const base = { eje_id: s.eje_id || '', saber_id: s.id || '', anio: s.anio == null ? '' : String(s.anio),
        trimestre: s.trimestre == null ? '' : String(s.trimestre), saber: s.texto || '' };
      const suyos = porSaber.get(s.id) || [];
      if (!suyos.length) { filas.push(Object.assign({ fila: ++n }, base)); continue; }
      for (const co of suyos) {
        filas.push(Object.assign({ fila: ++n }, base, { contenido_id: co.id || '', contenido: co.texto || '' }));
      }
    }
    return filas;
  }

  async function elegirArchivo(input) {
    const f = input && input.files && input.files[0];
    if (!f) return;
    const m = materia();
    estado.error = null;
    estado.aviso = null;
    estado.importe = null;
    estado.trabajando = 'Leyendo el archivo…';
    pintar();
    try {
      let modo, datos;
      if (/\.json$/i.test(f.name)) {
        modo = 'correccion';
        datos = filasDeJSON(await f.text());
      } else {
        const crudas = await hojaDeExcel(await f.arrayBuffer());
        const col = leerTitulos(crudas[0]);
        const conIds = col.saber_id != null && crudas.slice(1).some((fila) => celda(fila[col.saber_id]));
        if (conIds) {
          modo = 'correccion';
          datos = filasPorId(crudas);
        } else {
          modo = 'reemplazo';
          datos = saberesDePlanilla(crudas, m);
        }
      }

      if (modo === 'reemplazo' && datos.errores.length) {
        estado.trabajando = null;
        estado.importe = { modo, archivo: f.name, datos, resumen: { errores: datos.errores } };
      } else {
        estado.trabajando = modo === 'reemplazo'
          ? `Comparando ${datos.saberes.length} saberes con lo que hay en ${m.nombre}…`
          : 'Revisando el archivo…';
        pintar();
        const { data, error } = modo === 'reemplazo'
          ? await sb.rpc('reemplazar_materia', { p_espacio_id: m.id, p_saberes: datos.saberes, p_aplicar: false, p_archivo: f.name })
          : await sb.rpc('importar_catalogo', { p_filas: datos, p_aplicar: false, p_archivo: f.name });
        if (error) throw new Error(error.message);
        estado.trabajando = null;
        estado.importe = { modo, archivo: f.name, datos, resumen: data, materia: m };
      }
    } catch (e) {
      estado.trabajando = null;
      estado.error = (e && e.message) || 'No pudimos leer el archivo.';
    }
    if (input) input.value = '';
    pintar();
  }

  async function aplicar(alRefrescar) {
    const im = estado.importe;
    if (!im || estado.aplicando) return null;
    estado.aplicando = true;
    estado.error = null;
    pintar();
    try {
      const { data, error } = im.modo === 'reemplazo'
        ? await sb.rpc('reemplazar_materia', { p_espacio_id: im.materia.id, p_saberes: im.datos.saberes, p_aplicar: true, p_archivo: im.archivo })
        : await sb.rpc('importar_catalogo', { p_filas: im.datos, p_aplicar: true, p_archivo: im.archivo });
      if (error) throw new Error(error.message);
      estado.aplicando = false;
      estado.importe = null;
      estado.abierto = false;
      estado.aviso = null;
      if (alRefrescar) await alRefrescar();
      const hecho = im.modo === 'reemplazo'
        ? `${im.materia.nombre} actualizada: ${cambiosReemplazo(data).join(', ') || 'sin cambios'}.`
        : resumenCorto(data);
      return hecho + ' Queda todo en el historial. Acordate de publicar para que lo vean los docentes.';
    } catch (e) {
      estado.aplicando = false;
      estado.error = (e && e.message) || 'No pudimos aplicar los cambios.';
      pintar();
    }
    return null;
  }

  /* ---------- Cómo se cuenta lo que va a pasar ---------- */

  const RENGLONES_REEMPLAZO = [
    ['saberes_se_mantienen', 'saber queda igual', 'saberes quedan igual'],
    ['saberes_corregidos', 'saber corregido', 'saberes corregidos'],
    ['saberes_se_mueven', 'saber cambia de trimestre, año o eje', 'saberes cambian de trimestre, año o eje'],
    ['trimestres_reordenados', 'trimestre cambia el orden de sus saberes', 'trimestres cambian el orden de sus saberes'],
    ['saberes_vuelven', 'saber que estaba archivado vuelve', 'saberes que estaban archivados vuelven'],
    ['saberes_nuevos', 'saber nuevo', 'saberes nuevos'],
    ['saberes_salen', 'saber sale (queda archivado, con sus respuestas)', 'saberes salen (quedan archivados, con sus respuestas)'],
    ['contenidos_nuevos', 'contenido nuevo', 'contenidos nuevos'],
    ['contenidos_corregidos', 'contenido corregido', 'contenidos corregidos'],
    ['contenidos_vuelven', 'contenido que vuelve', 'contenidos que vuelven'],
    ['contenidos_salen', 'contenido sale', 'contenidos salen'],
  ];

  function cambiosReemplazo(r, conIguales) {
    return RENGLONES_REEMPLAZO
      .filter(([k]) => Number(r[k] || 0) > 0 && (conIguales || k !== 'saberes_se_mantienen'))
      .map(([k, uno, varios]) => `${r[k]} ${plural(r[k], uno, varios)}`);
  }

  const RENGLONES_CORRECCION = [
    ['saberes_nuevos', 'saber nuevo', 'saberes nuevos'],
    ['saberes_editados', 'saber corregido', 'saberes corregidos'],
    ['saberes_archivados', 'saber que se archiva', 'saberes que se archivan'],
    ['saberes_restaurados', 'saber que se restaura', 'saberes que se restauran'],
    ['contenidos_nuevos', 'contenido nuevo', 'contenidos nuevos'],
    ['contenidos_editados', 'contenido corregido', 'contenidos corregidos'],
    ['contenidos_archivados', 'contenido que se archiva', 'contenidos que se archivan'],
    ['contenidos_restaurados', 'contenido que se restaura', 'contenidos que se restauran'],
  ];

  function cambiosCorreccion(r) {
    return RENGLONES_CORRECCION.filter(([k]) => Number(r[k] || 0) > 0)
      .map(([k, uno, varios]) => `${r[k]} ${plural(r[k], uno, varios)}`);
  }

  function resumenCorto(r) {
    const c = cambiosCorreccion(r);
    return c.length ? 'Importado: ' + c.join(', ') + '.' : 'El archivo no traía ningún cambio.';
  }

  /* ---------- Pantalla ---------- */

  function bloqueErrores(errores) {
    return `
      <div class="ar-resumen ar-resumen--error">
        <div class="ar-resumen__titulo">${errores.length} ${plural(errores.length, 'fila tiene un problema', 'filas tienen problemas')}</div>
        <p class="bajada">No se cambió nada. Corregí esas filas en el Excel y volvé a subirlo.</p>
        <ul class="ar-errores">
          ${errores.slice(0, 10).map((e) => `<li><strong>Fila ${esc(e.fila)}</strong> · ${esc(e.mensaje)}</li>`).join('')}
        </ul>
        ${errores.length > 10 ? `<p class="bajada">Y ${errores.length - 10} más.</p>` : ''}
      </div>
      <div class="t-panel__acciones">
        <button type="button" class="t-cancelar" data-accion="ar-cancelar-importe">Entendido</button>
      </div>`;
  }

  function bloqueEjemplos(ejemplos) {
    if (!ejemplos || !ejemplos.length) return '';
    return `
      <div class="ar-ejemplos__titulo">Algunos de los cambios</div>
      <ul class="ar-ejemplos">
        ${ejemplos.map((e) => `
          <li>
            <span class="ar-ejemplo__que">${esc(e.que)}</span>
            ${e.antes ? `<span class="ar-ejemplo__antes">${esc(e.antes)}</span>` : ''}
            ${e.despues ? `<span class="ar-ejemplo__despues">${esc(e.despues)}</span>` : ''}
          </li>`).join('')}
      </ul>`;
  }

  function bloqueReemplazo(im) {
    const r = im.resumen || {};
    const m = im.materia || materia();
    const lista = cambiosReemplazo(r, true);
    const anios = (r.anios || []).filter((a) => a > 0);
    const quedan = m.anios.filter((a) => !anios.includes(a));
    const alcance = r.por_ciclo
      ? 'Se reemplaza toda la materia.'
      : quedan.length
        ? `Se reemplaza solo ${textoAnios(anios)} año. ${textoAnios(quedan)} no se ${plural(quedan.length, 'toca', 'tocan')}.`
        : `Se reemplazan ${textoAnios(anios)} año.`;

    if (!cambiosReemplazo(r, false).length) {
      return `
        <div class="ar-resumen">
          <div class="ar-resumen__titulo">La planilla dice lo mismo que el catálogo</div>
          <p class="bajada">Revisamos los ${r.filas} saberes de «${esc(im.archivo)}» y ${m.nombre} ya está así. No hay nada que aplicar.</p>
        </div>
        <div class="t-panel__acciones">
          <button type="button" class="t-cancelar" data-accion="ar-cancelar-importe">Cerrar</button>
        </div>`;
    }

    return `
      <div class="ar-resumen">
        <div class="ar-resumen__titulo">Así va a quedar ${esc(m.nombre)}</div>
        <p class="bajada"><strong>${esc(alcance)}</strong></p>
        <ul class="ar-cuenta">${lista.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        ${bloqueEjemplos(r.ejemplos)}
        <p class="bajada">Nada se borra: lo que sale queda archivado con sus respuestas y se puede recuperar
          volviendo a subir una planilla que lo tenga.</p>
      </div>
      <div class="t-panel__acciones">
        <button type="button" class="t-descargar" data-accion="ar-aplicar" ${estado.aplicando ? 'disabled' : ''}>${estado.aplicando ? 'Aplicando…' : `Aplicar a ${esc(m.nombre)}`}</button>
        <button type="button" class="t-cancelar" data-accion="ar-cancelar-importe">Cancelar</button>
      </div>`;
  }

  function bloqueCorreccion(im) {
    const r = im.resumen || {};
    const lista = cambiosCorreccion(r);
    if (!lista.length) {
      return `
        <div class="ar-resumen">
          <div class="ar-resumen__titulo">El archivo no trae cambios</div>
          <p class="bajada">Revisamos las ${r.filas} ${plural(r.filas, 'fila', 'filas')} de «${esc(im.archivo)}» y dicen lo mismo que el catálogo.</p>
        </div>
        <div class="t-panel__acciones">
          <button type="button" class="t-cancelar" data-accion="ar-cancelar-importe">Cerrar</button>
        </div>`;
    }
    return `
      <div class="ar-resumen">
        <div class="ar-resumen__titulo">Esto es lo que haría</div>
        <ul class="ar-cuenta">${lista.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        <p class="bajada">Este archivo corrige saber por saber: <strong>lo que no menciona queda como está</strong>.</p>
        ${bloqueEjemplos(r.ejemplos)}
      </div>
      <div class="t-panel__acciones">
        <button type="button" class="t-descargar" data-accion="ar-aplicar" ${estado.aplicando ? 'disabled' : ''}>${estado.aplicando ? 'Aplicando…' : 'Aplicar los cambios'}</button>
        <button type="button" class="t-cancelar" data-accion="ar-cancelar-importe">Cancelar</button>
      </div>`;
  }

  function bloqueImporte() {
    const im = estado.importe;
    const errores = (im.resumen && im.resumen.errores) || [];
    if (errores.length) return bloqueErrores(errores);
    return im.modo === 'reemplazo' ? bloqueReemplazo(im) : bloqueCorreccion(im);
  }

  function panel() {
    if (!estado.abierto) return '';
    const m = materia();
    return `<div class="t-velo" data-accion="ar-cerrar"></div>
    <div class="t-panel ed-panel ar-panel" role="dialog" aria-modal="true">
      <div class="t-panel__cabecera">
        <h2 class="t-panel__titulo">Cambiar con una planilla</h2>
        <button type="button" class="t-panel__cerrar" data-accion="ar-cerrar" aria-label="Cerrar">${svgCerrar()}</button>
      </div>

      ${estado.error ? `<div class="ed-aviso ed-aviso--error" role="alert">${esc(estado.error)}</div>` : ''}
      ${estado.aviso ? `<div class="ed-aviso" role="status">${esc(estado.aviso)}</div>` : ''}
      ${estado.trabajando ? `<div class="ar-trabajando">${esc(estado.trabajando)}</div>` : ''}

      ${estado.importe ? bloqueImporte() : `
        <section class="ar-seccion">
          <div class="ar-seccion__titulo">1 · Bajá la planilla</div>
          <p class="bajada">La planilla de ${esc(m.nombre)}, con todos sus años: una fila por saber y sus
            contenidos en columnas. Corregila en Excel.</p>
          <div class="ar-botones">
            <button type="button" class="t-descargar" data-accion="ar-planilla" ${estado.trabajando ? 'disabled' : ''}>Bajar la planilla de ${esc(m.nombre)}</button>
          </div>
        </section>

        <section class="ar-seccion ar-seccion--importar">
          <div class="ar-seccion__titulo">2 · Subila corregida</div>
          <p class="bajada">Antes de cambiar nada te mostramos cómo va a quedar ${esc(m.nombre)}.</p>
          <label class="ar-subir">
            <input type="file" accept=".xlsx,.xls,.json" data-accion="ar-elegir" ${estado.trabajando ? 'disabled' : ''}>
            <span>Elegir el archivo</span>
          </label>
          <p class="ar-ayuda">Solo cambian los años que vengan en la planilla. Lo que no cambió conserva sus respuestas.</p>
        </section>
        <p class="ar-ayuda ar-respaldo">Para quien mantiene el sistema:
          <button type="button" class="ar-enlace" data-accion="ar-json" ${estado.trabajando ? 'disabled' : ''}>bajar el catálogo completo en JSON</button>
          (el respaldo del repositorio, <code>datos/catalogo.json</code>).</p>`}
    </div>`;
  }

  function svgCerrar() {
    return '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#535D71" '
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
      case 'ar-planilla': await bajarPlanilla(); return null;
      case 'ar-json': await exportarJSON(); return null;
      case 'ar-elegir': await elegirArchivo(el); return null;
      case 'ar-cancelar-importe': estado.importe = null; estado.error = null; pintar(); return null;
      case 'ar-aplicar': return await aplicar(alRefrescar);
      default: return undefined;
    }
  }

  return { iniciar, panel, accion, abierto: () => estado.abierto };
})();
