/* ============================================================================
   Catalogo — carga datos/catalogo.json y datos/escuelas.json una sola vez y
   arma los índices que necesita el formulario. Nada de esto toca el servidor:
   el catálogo viaja con la página.

   Jerarquía: Área → Espacio curricular → Eje → Saber → Contenidos sugeridos
   ============================================================================ */

const Catalogo = (function () {
  'use strict';

  let datos = null;       // { areas, espacios, ejes, saberes, contenidos }
  let institucion = null; // { departamentos, escuelas }
  const idx = {};
  const cacheTramos = new Map();

  const porOrden = (a, b) => (a.orden || 0) - (b.orden || 0);

  function agrupar(lista, clave) {
    const mapa = new Map();
    for (const item of lista) {
      const k = item[clave];
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(item);
    }
    for (const arr of mapa.values()) arr.sort(porOrden);
    return mapa;
  }

  async function cargar() {
    const [c, e] = await Promise.all([
      fetch('datos/catalogo.json').then((r) => { if (!r.ok) throw new Error('catalogo'); return r.json(); }),
      fetch('datos/escuelas.json').then((r) => { if (!r.ok) throw new Error('escuelas'); return r.json(); }),
    ]);
    datos = c;
    institucion = e;
    construirIndices();
  }

  function construirIndices() {
    idx.areaPorId = new Map(datos.areas.map((a) => [a.id, a]));
    idx.espacioPorId = new Map(datos.espacios.map((x) => [x.id, x]));
    idx.ejePorId = new Map(datos.ejes.map((x) => [x.id, x]));
    idx.saberPorId = new Map(datos.saberes.map((x) => [x.id, x]));
    idx.contenidoPorId = new Map(datos.contenidos.map((x) => [x.id, x]));

    idx.espaciosPorArea = agrupar(datos.espacios, 'area_id');
    idx.ejesPorEspacio = agrupar(datos.ejes, 'espacio_id');
    // Los saberes con calidad 'mala' vienen de páginas que el OCR leyó mal:
    // no se le muestran al docente hasta que el equipo los corrija.
    idx.saberesPorEje = agrupar(datos.saberes.filter((s) => s.calidad !== 'mala'), 'eje_id');
    idx.contenidosPorSaber = agrupar(datos.contenidos, 'saber_id');

    idx.departamentoPorId = new Map(institucion.departamentos.map((d) => [d.id, d]));
    idx.escuelaPorId = new Map(institucion.escuelas.map((x) => [x.id, x]));
    idx.escuelasPorDepartamento = new Map();
    for (const esc of institucion.escuelas) {
      if (!idx.escuelasPorDepartamento.has(esc.departamento_id)) idx.escuelasPorDepartamento.set(esc.departamento_id, []);
      idx.escuelasPorDepartamento.get(esc.departamento_id).push(esc);
    }
    const numero = (e) => parseInt(e.numero, 10) || 0;
    for (const arr of idx.escuelasPorDepartamento.values()) arr.sort((a, b) => numero(a) - numero(b));
  }

  /* ---------- Áreas y espacios ---------- */

  const PREFIJO_ARTISTICA = 'Educación Artística - ';

  function areas() { return datos.areas.slice().sort(porOrden); }
  function area(id) { return idx.areaPorId.get(id) || null; }
  function espacio(id) { return idx.espacioPorId.get(id) || null; }
  function espaciosPorArea(areaId) { return idx.espaciosPorArea.get(areaId) || []; }
  function eje(id) { return idx.ejePorId.get(id) || null; }
  function saber(id) { return idx.saberPorId.get(id) || null; }
  function contenido(id) { return idx.contenidoPorId.get(id) || null; }

  function esArtistica(esp) { return esp.nombre.startsWith(PREFIJO_ARTISTICA); }

  // «Educación Artística - Música» → «Música»; «Tutoría: Fortalecimiento…» → «Tutoría»;
  // «Lengua y Cultura Originarias (Wichí, Qom, Pilagá)» → «Lengua y Cultura Originarias»
  function nombreCorto(esp) {
    let n = esp.nombre;
    if (n.startsWith(PREFIJO_ARTISTICA)) n = n.slice(PREFIJO_ARTISTICA.length);
    n = n.split(':')[0];
    n = n.split(' (')[0];
    return n.trim();
  }

  // Bajada de la tarjeta de área: «Lengua · Lenguas Extranjeras · Educación Artística»
  function subtituloArea(areaId) {
    const partes = [];
    for (const esp of espaciosPorArea(areaId)) {
      if (esArtistica(esp)) {
        if (!partes.includes('Educación Artística')) partes.push('Educación Artística');
        continue;
      }
      const parentesis = esp.nombre.match(/\(([^)]+)\)/);
      if (parentesis) {
        parentesis[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => partes.push(s));
        continue;
      }
      partes.push(nombreCorto(esp));
    }
    return partes.join(' · ');
  }

  // Divide los espacios de un área en sueltos y agrupados (Educación Artística)
  function espaciosAgrupados(areaId) {
    const sueltos = [];
    const artisticas = [];
    for (const esp of espaciosPorArea(areaId)) (esArtistica(esp) ? artisticas : sueltos).push(esp);
    return { sueltos, artisticas };
  }

  /* ---------- Saberes ---------- */

  // Saberes visibles de un espacio para un año, repartidos por trimestre y en el
  // orden del diseño (eje, luego saber). Si el espacio no diferencia por año
  // (saberes_por_ciclo), se toman los saberes con anio null.
  function saberesPorTramo(espacioId, anio) {
    const clave = espacioId + '|' + anio;
    if (cacheTramos.has(clave)) return cacheTramos.get(clave);
    const esp = espacio(espacioId);
    const tramos = { 1: [], 2: [], 3: [] };
    if (esp) {
      for (const ej of idx.ejesPorEspacio.get(espacioId) || []) {
        for (const s of idx.saberesPorEje.get(ej.id) || []) {
          const vale = esp.saberes_por_ciclo ? s.anio == null : (s.anio === anio || s.anio == null);
          if (!vale) continue;
          const t = [1, 2, 3].includes(s.trimestre) ? s.trimestre : 1;
          tramos[t].push(s);
        }
      }
    }
    cacheTramos.set(clave, tramos);
    return tramos;
  }

  function contenidosDeSaber(saberId) { return idx.contenidosPorSaber.get(saberId) || []; }

  // Sugerencias del catálogo para lo que el docente escribe en un saber.
  // Todas las palabras tienen que aparecer (como subcadena) en el texto normalizado.
  function sugerencias(saberId, consulta) {
    const q = normalizarTexto(consulta);
    if (!q) return { lista: [], exacta: null, tokens: [] };
    const tokens = q.split(' ');
    const lista = [];
    let exacta = null;
    for (const c of contenidosDeSaber(saberId)) {
      const tn = c.texto_normalizado || normalizarTexto(c.texto);
      if (tokens.every((t) => tn.includes(t))) lista.push(c);
      if (tn === q) exacta = c;
    }
    return { lista, exacta, tokens };
  }

  /* ---------- Escuelas ---------- */

  function departamentos() { return institucion.departamentos.slice(); }
  function departamento(id) { return idx.departamentoPorId.get(id) || null; }
  function escuela(id) { return idx.escuelaPorId.get(id) || null; }

  // Busca por número, nombre, localidad o departamento. Devuelve grupos por
  // departamento en el orden oficial, solo los que tienen resultados.
  function buscarEscuelas(consulta, departamentoId) {
    const q = normalizarTexto(consulta);
    const tokens = q ? q.split(' ') : [];
    const grupos = [];
    let total = 0;
    for (const dep of institucion.departamentos) {
      if (departamentoId && dep.id !== departamentoId) continue;
      const encontradas = (idx.escuelasPorDepartamento.get(dep.id) || []).filter((e) => {
        if (!tokens.length) return true;
        const b = e.busqueda || normalizarTexto(e.nombre + ' ' + e.localidad + ' ' + dep.nombre);
        return tokens.every((t) => b.includes(t));
      });
      if (encontradas.length) {
        grupos.push({ departamento: dep, escuelas: encontradas });
        total += encontradas.length;
      }
    }
    return { grupos, total, tokens };
  }

  return {
    cargar,
    areas, area, espacio, espaciosPorArea, espaciosAgrupados, eje, saber, contenido,
    esArtistica, nombreCorto, subtituloArea,
    saberesPorTramo, contenidosDeSaber, sugerencias,
    departamentos, departamento, escuela, buscarEscuelas,
  };
})();
