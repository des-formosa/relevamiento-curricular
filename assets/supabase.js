/* ============================================================================
   Envío a Supabase.

   La clave pública (anon) queda visible en el navegador: es inevitable en un
   sitio estático. Por eso el rol anon no puede escribir en ninguna tabla; solo
   tiene EXECUTE sobre la función registrar_aporte(payload jsonb), que valida y
   escribe todo en una transacción.

   Mientras CONFIG_SUPABASE.url esté vacía, el envío corre en MODO PRUEBA:
   simula la demora, no manda nada y la confirmación lo avisa.
   ============================================================================ */

const CONFIG_SUPABASE = {
  url: 'https://gtvgdtyyipdhubuhtgyc.supabase.co',
  // Clave pública (publishable). Es segura de exponer: el rol anónimo solo
  // puede leer escuelas y ejecutar registrar_aporte().
  claveAnon: 'sb_publishable_5eK1cRIfuuU72QWHBPKqFg_FNQ3YoMF',
};

// Librería oficial, por CDN y con versión fijada. Se carga solo si hace falta.
const URL_LIBRERIA_SUPABASE = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';

const Envio = (function () {
  'use strict';

  let cliente = null;
  let cargaLibreria = null;

  function configurado() {
    return Boolean(CONFIG_SUPABASE.url && CONFIG_SUPABASE.claveAnon);
  }

  function cargarLibreria() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    if (cargaLibreria) return cargaLibreria;
    cargaLibreria = new Promise((resolver, rechazar) => {
      const script = document.createElement('script');
      script.src = URL_LIBRERIA_SUPABASE;
      script.async = true;
      script.onload = () => resolver();
      script.onerror = () => { cargaLibreria = null; rechazar(new Error('No se pudo cargar la librería de Supabase')); };
      document.head.appendChild(script);
    });
    return cargaLibreria;
  }

  async function obtenerCliente() {
    if (cliente) return cliente;
    await cargarLibreria();
    cliente = window.supabase.createClient(CONFIG_SUPABASE.url, CONFIG_SUPABASE.claveAnon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return cliente;
  }

  // Se llama al llegar al resumen, para que el envío después sea inmediato.
  function precargar() {
    if (configurado()) cargarLibreria().catch(() => {});
  }

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  /*
    payload = {
      docente: { nombre, apellido, clave? },   // clave: uuid que agrupa las materias de una misma persona
      escuela: { id } | { nombre, departamento_id, localidad },
      espacio_id, anio,
      selecciones: [{ saber_id, tipo: 'catalogo'|'libre', contenido_sugerido_id, texto, texto_normalizado, orden }],
      saberes_no_trabajados: [saber_id, ...]
    }
    Devuelve { ok: true, prueba?: true, datos? } o { ok: false, mensaje, codigo }.
    Cuando la función SQL rechaza el envío (codigo '22023'), `mensaje` ya viene
    escrito para el docente y se puede mostrar tal cual.
  */
  async function enviarAporte(payload) {
    if (!configurado()) {
      await esperar(600);
      return { ok: true, prueba: true };
    }
    try {
      const sb = await obtenerCliente();
      const { data, error } = await sb.rpc('registrar_aporte', { payload });
      if (error) return { ok: false, mensaje: error.message || 'La base de datos rechazó el envío.', codigo: error.code || null };
      return { ok: true, datos: data };
    } catch (e) {
      return { ok: false, mensaje: (e && e.message) || 'No hubo respuesta del servidor.', codigo: null };
    }
  }

  return { configurado, precargar, enviarAporte };
})();
