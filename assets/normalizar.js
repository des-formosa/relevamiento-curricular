/* ============================================================================
   normalizarTexto(t)
   Baja a minúsculas, quita acentos (ñ → n, ü → u), reemplaza puntuación por
   espacio y colapsa espacios. Se usa en el autocompletado, en el anti-duplicado
   dentro de un aporte y en el agrupamiento de textos libres del dashboard.

   La función normalizar_texto(t) en SQL (sql/03_funciones.sql) TIENE que dar
   exactamente el mismo resultado. Si se cambia una, se cambia la otra.

   Ejemplos (coinciden con texto_normalizado del catálogo):
     'Retoman los saberes de 1° año'  → 'retoman los saberes de 1 ano'
     'E.P.E.S. N° 41 "Dr. Pereyra"'   → 'e p e s n 41 dr pereyra'
   ============================================================================ */

function normalizarTexto(t) {
  return String(t == null ? '' : t)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
