/* SIA · Utilidades comunes del frontend
   ─────────────────────────────────────────────────────────────────────────
   Se carga en el <head> de todas las páginas con sesión, antes que cualquier
   script en línea, para que sus funciones estén disponibles siempre.

   SIAarg(v): escape para usar un dato dentro de un `onclick` en línea.
   Un onclick vive en dos contextos a la vez:
     1. el atributo HTML  -> hay que escapar " & < >
     2. la cadena de JS   -> hay que escapar ' y \
   Si sólo se escapa uno de los dos, el atributo se rompe y el botón queda
   sin hacer nada (no da error, simplemente no responde).
   Por eso aquí se escapan los dos contextos, en ese orden.
*/
(function () {
  'use strict';

  window.SIAarg = function (v) {
    return String(v == null ? '' : v)
      .replace(/\\/g, '\\\\')     // 1) contexto JS
      .replace(/'/g, "\\'")
      .replace(/&/g, '&amp;')     // 2) contexto HTML
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  /* Versión "sólo texto" para contenido insertado con innerHTML. */
  window.SIAtext = function (v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };
})();
