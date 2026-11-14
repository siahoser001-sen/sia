/* ============================================================
   SIA — Utilidades de interfaz compartidas
   Ronda D · D2: los mensajes de ÉXITO se ocultan a los 5 s.
   ------------------------------------------------------------
   Los mensajes de error NO se auto-ocultan: permanecen visibles
   hasta que el usuario navegue o ejecute otra acción.
   ============================================================ */
(function () {
  'use strict';

  var MS = 5000;

  // Patrón A: elementos con clase base "msg" + tipo ("exito"/"error").
  // Limpia cualquier temporizador previo; si es éxito, limpia el
  // mensaje (vuelve a "msg" vacío) a los 5 s.
  window.siaExitoMsg = function (el, tipo) {
    if (!el) return;
    if (el.__siaMsgTimer) { clearTimeout(el.__siaMsgTimer); el.__siaMsgTimer = null; }
    if (tipo === 'error') return;
    el.__siaMsgTimer = setTimeout(function () {
      el.__siaMsgTimer = null;
      el.className = 'msg';
      el.textContent = '';
    }, MS);
  };

  // Patrón B: elementos con clase fija "msg-ok" que se muestran
  // agregando la clase "visible". Se ocultan a los 5 s.
  window.siaExitoVisible = function (el) {
    if (!el) return;
    if (el.__siaMsgTimer) { clearTimeout(el.__siaMsgTimer); el.__siaMsgTimer = null; }
    el.__siaMsgTimer = setTimeout(function () {
      el.__siaMsgTimer = null;
      el.classList.remove('visible');
    }, MS);
  };
})();
