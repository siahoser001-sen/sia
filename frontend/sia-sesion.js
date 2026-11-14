/* SIA · Control de sesión
   ─────────────────────────────────────────────────────────────────────────
   El JWT del sistema dura 8 horas (JWT_EXPIRES_IN). Si una pestaña queda
   abierta más tiempo que eso, TODAS las peticiones a la API responden 401
   y el panel se queda a medias: las tablas vacías ("No hay cursos creados"),
   los modales en "Cargando..." para siempre y los botones sin efecto.
   El usuario no ve ningún error, sólo parece que "ningún botón funciona".

   Este archivo centraliza el control de sesión para todas las páginas:
     1. Al cargar: si el token ya venció, sale de inmediato al login
        (en vez de pintar un panel roto).
     2. En caliente: si cualquier petición a la API responde 401, la sesión
        está caída -> se limpia y se vuelve al login con un aviso claro.
     3. Periódico: revisa la caducidad aunque el usuario no pulse nada, para
        que la expiración no sorprenda en media acción.

   Se carga al inicio del <head> de las páginas que usan la sesión.
*/
(function () {
  'use strict';

  var TOKEN_KEY = 'sia_token';
  var USER_KEY  = 'sia_usuario';
  var MOTIVO_KEY = 'sia_sesion_motivo';
  var RUTA_LOGIN = '/frontend/login.html';

  /* ── Utilidades ─────────────────────────────────────────────── */
  function leerToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function limpiarSesion() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
    } catch (e) {}
  }
  function guardarMotivo(motivo) {
    try { sessionStorage.setItem(MOTIVO_KEY, motivo || 'expirada'); } catch (e) {}
  }

  /* Lee el payload del JWT (base64url) sin verificar la firma:
     aquí sólo interesa la fecha de caducidad. */
  function decodificarPayload(token) {
    try {
      var partes = String(token).split('.');
      if (partes.length !== 3) return null;
      var b64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var bin = atob(b64);
      try { return JSON.parse(decodeURIComponent(escape(bin))); }
      catch (e2) { return JSON.parse(bin); }
    } catch (e) { return null; }
  }

  function segundosParaExpirar(token) {
    var p = decodificarPayload(token);
    if (!p || !p.exp) return null;            // sin expiración: no se controla
    return Math.floor(p.exp - (Date.now() / 1000));
  }

  /* ── Salida al login ────────────────────────────────────────── */
  var saliendo = false;
  function salirAlLogin(motivo) {
    if (saliendo) return;
    saliendo = true;
    guardarMotivo(motivo);
    limpiarSesion();
    var destino = RUTA_LOGIN + '?sesion=' + encodeURIComponent(motivo || 'expirada');
    try {
      var top = window.top;
      // Si la página vive dentro del shell (iframe), se saca al login
      // la ventana de arriba y no se queda dentro del iframe.
      if (top && top !== window.self && top.location) { top.location.replace(destino); return; }
    } catch (e) {}
    window.location.replace(destino);
  }

  var token = leerToken();
  if (!token) return;          // sin sesión no hay nada que controlar

  /* ── 1) Al cargar: token ya vencido ─────────────────────────── */
  var restante = segundosParaExpirar(token);
  if (restante !== null && restante <= 0) {
    salirAlLogin('expirada');
    return;
  }

  /* ── 2) En caliente: cualquier 401 de la API = sesión caída ── */
  var fetchOriginal = window.fetch;
  if (typeof fetchOriginal === 'function') {
    window.fetch = function (input, init) {
      return fetchOriginal.apply(this, arguments).then(function (res) {
        if (res && res.status === 401) {
          var url = '';
          try {
            url = typeof input === 'string' ? input
                 : (input && typeof input.url === 'string' ? input.url : '');
          } catch (e) {}
          // El login y el recuperación de contraseña gestionan sus propios 401.
          if (!/\/api\/auth\/(login|registro|recuperar|reset)/i.test(url)) {
            salirAlLogin('expirada');
          }
        }
        return res;
      });
    };
  }

  /* ── 3) Vigilancia periódica de la caducidad ───────────────── */
  // Si la pestaña queda abierta y la sesión expira, se avisa al login en vez
  // de dejar un panel muerto donde nada responde.
  setInterval(function () {
    var t = leerToken();
    if (!t) return;
    var s = segundosParaExpirar(t);
    if (s !== null && s <= 0) salirAlLogin('expirada');
  }, 30000);

  /* ── Aviso en la misma página si la sesión está por caer ───── */
  if (restante !== null && restante > 0 && restante < 120) {
    var aviso = document.createElement('div');
    aviso.setAttribute('role', 'status');
    aviso.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99998;max-width:320px;' +
      'padding:12px 14px;border-radius:12px;background:#7c2d12;color:#fff;font:600 13px/1.4 system-ui,sans-serif;' +
      'box-shadow:0 10px 30px rgba(0,0,0,.35)';
    aviso.textContent = 'Tu sesión está por expirar. Vuelve a iniciar sesión para no perder tu trabajo.';
    var enlace = document.createElement('a');
    enlace.href = RUTA_LOGIN;
    enlace.textContent = ' Iniciar sesión';
    enlace.style.cssText = 'color:#fff;text-decoration:underline';
    aviso.appendChild(enlace);
    var cerrar = document.createElement('button');
    cerrar.type = 'button';
    cerrar.textContent = '✕';
    cerrar.setAttribute('aria-label', 'Cerrar aviso');
    cerrar.style.cssText = 'float:right;background:none;border:0;color:#fff;cursor:pointer;font-size:14px;margin-left:8px';
    cerrar.addEventListener('click', function () { aviso.remove(); });
    aviso.appendChild(cerrar);
    var montar = function () { if (document.body) document.body.appendChild(aviso); };
    if (document.body) montar(); else document.addEventListener('DOMContentLoaded', montar);
  }
})();
