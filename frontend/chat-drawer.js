// ============================================================
//  chat-drawer.js — Lógica del centro de mensajería SIA.
//  Se carga vía chat-drawer-inyector.js (espera a que el markup
//  de chat-drawer.html ya esté en el DOM).
// ============================================================
(function () {
  if (window.SIA_CHAT) return;

  var API = window.location.origin;
  var $ = function (id) { return document.getElementById(id); };
  var token = function () { return sessionStorage.getItem('sia_token'); };
  var headers = function () { return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() }; };

  var estado = {
    config: null,
    conversaciones: [],
    activaId: null,
    socket: null,
    buscando: false,
    creadoElUltimoChat: null,
  };

  var FAB = $('siaChatFab');
  var FONDO = $('siaChatFondo');
  var DRAWER = $('siaChatDrawer');
  var BADGE = $('siaChatFabBadge');
  if (!FAB || !DRAWER) return;

  // Dentro del shell (SPA en iframe) el chat lo gestiona el panel padre:
  // se evita abrir un segundo socket que duplique las conexiones.
  const EN_SHELL = /[?&]shell=1/.test(location.search);

  // ── API ────────────────────────────────────────────────────
  async function peticion(url, opciones) {
    var res = await fetch(API + url, Object.assign({ headers: headers() }, opciones || {}));
    return res.json();
  }

  async function cargarConfig() {
    try {
      var data = await peticion('/api/chat/config');
      if (data.ok) {
        estado.config = data.config;
        actualizarControlesRol();
      }
    } catch (e) { /* sin conexión */ }
  }

  async function cargarConversaciones() {
    try {
      var data = await peticion('/api/chat/conversaciones');
      if (data.ok) {
        estado.conversaciones = data.conversaciones || [];
        renderLista();
        pintarBadge();
      }
    } catch (e) { /* sin conexión */ }
  }

  function pintarBadge() {
    var n = estado.conversaciones.reduce(function (acc, c) { return acc + (c.no_leidos || 0); }, 0);
    BADGE.textContent = n > 99 ? '99+' : String(n);
    BADGE.style.display = n > 0 ? 'flex' : 'none';
    var texto = n > 99 ? '99+' : String(n);
    document.querySelectorAll('[title="Notificaciones"]').forEach(function (bell) {
      var bolita = bell.querySelector('.sia-notif-badge');
      if (!bolita) {
        bolita = document.createElement('span');
        bolita.className = 'sia-notif-badge';
        bell.appendChild(bolita);
      }
      bolita.textContent = texto;
      bolita.classList.toggle('sia-show', n > 0);
    });
  }

  // ── Controles según rol ─────────────────────────────────────
  function actualizarControlesRol() {
    var c = estado.config;
    if (!c) return;
    var sub = '';
    if (c.rol === 'superadmin') sub = 'Superadministración';
    else if (c.rol === 'admin') sub = 'Administración · ' + (c.permitir_mensajes_abiertos ? 'mensajes abiertos' : 'mensajes cerrados');
    else if (c.rol === 'docente') sub = c.permitir_mensajes_abiertos ? 'Escribe a tus estudiantes o a la administración' : 'Escribe a tus estudiantes';
    else if (c.rol === 'estudiante') sub = 'Contacta a tus docentes de curso';
    else if (c.rol === 'acudiente') sub = 'Contacta a los docentes de tu acudido';
    var subEl = $('siaChatHeadSub');
    if (subEl) subEl.textContent = sub;

    var toggle = $('siaChatToggle');
    if (c.rol === 'admin') {
      toggle.style.display = '';
      toggle.textContent = c.permitir_mensajes_abiertos ? 'Abierto' : 'Cerrado';
      toggle.classList.toggle('sia-on', c.permitir_mensajes_abiertos);
    } else {
      toggle.style.display = 'none';
    }

    var busq = $('siaChatSearch');
    if (busq) {
      busq.style.display = '';
      busq.placeholder = 'Buscar…';
    }
  }

  // ── Lista de conversaciones ────────────────────────────────
  function fmtHora(fecha) {
    if (!fecha) return '';
    var d = new Date(fecha);
    if (isNaN(d.getTime())) return '';
    var hoy = new Date();
    var mismoDia = d.toDateString() === hoy.toDateString();
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    if (mismoDia) return hh + ':' + mm;
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function iniciales(nombre) {
    return (nombre || '?').split(' ').slice(0, 2).map(function (p) { return p.charAt(0); }).join('').toUpperCase();
  }

  function renderLista() {
    var cont = $('siaChatConversaciones');
    if (!cont) return;
    if (estado.buscando) return;
    if (!estado.conversaciones.length) {
      cont.innerHTML = '<div class="sia-chat-vacio">' + mensajeVacio() + '</div>';
      return;
    }
    cont.innerHTML = estado.conversaciones.map(function (c) {
      var activo = c.id === estado.activaId ? ' sia-activo' : '';
      var prev = c.ultimo_mensaje ? (c.ultimo_mensaje.length > 46 ? c.ultimo_mensaje.slice(0, 46) + '…' : c.ultimo_mensaje) : 'Sin mensajes aún';
      var bloqueado = c.bloqueado ? ' 🔒' : '';
      return '' +
        '<div class="sia-chat-conv' + activo + '" data-chat="' + c.id + '">' +
          '<div class="sia-chat-avatar">' + iniciales(c.nombre) + '</div>' +
          '<div class="sia-chat-conv-info">' +
            '<div class="sia-chat-conv-nombre">' + c.nombre + bloqueado + '</div>' +
            '<div class="sia-chat-conv-sub">' + (c.sub || '') + '</div>' +
            '<div class="sia-chat-conv-preview">' + prev + '</div>' +
          '</div>' +
          '<div class="sia-chat-conv-meta">' +
            '<span class="sia-chat-conv-hora">' + fmtHora(c.ultimo_at) + '</span>' +
            (c.no_leidos ? '<span class="sia-chat-noLeidos">' + c.no_leidos + '</span>' : '') +
          '</div>' +
        '</div>';
    }).join('');
    cont.querySelectorAll('.sia-chat-conv[data-chat]').forEach(function (el) {
      el.addEventListener('click', function () { abrirConversacion(el.getAttribute('data-chat')); });
    });
  }

function mensajeVacio() {
    var c = estado.config;
    if (!c) return 'Cargando…';
    return 'Usa el buscador para encontrar personas.';
  }

  // ── Abrir una conversación ──────────────────────────────────
  async function abrirConversacion(chatId) {
    estado.activaId = chatId;
    renderLista();
    $('siaChatConversacion').style.display = 'flex';
    $('siaChatMensajes').innerHTML = '<div class="sia-chat-vacio">Cargando…</div>';
    try {
      var data = await peticion('/api/chat/' + chatId + '/mensajes');
      if (!data.ok) {
        $('siaChatMensajes').innerHTML = '<div class="sia-chat-vacio">' + (data.mensaje || 'Error') + '</div>';
        return;
      }
      var c = data.chat;
      $('siaChatChatNombre').textContent = c.nombre + (c.bloqueado ? ' 🔒' : '');
      var bloqueado = c.bloqueado;
      $('siaChatBloqueadoBanner').style.display = bloqueado ? 'block' : 'none';
      $('siaChatBloqueadoBanner').textContent = bloqueado
        ? (c.yo_bloquee ? 'Bloqueaste este chat. Desbloquéalo si quieres volver a escribir.' : 'Este chat está bloqueado.')
        : '';
      $('siaChatBloquear').textContent = bloqueado ? (c.yo_bloquee ? 'Desbloquear' : 'Bloqueado') : 'Bloquear';
      $('siaChatBloquear').disabled = bloqueado && !c.yo_bloquee;
      $('siaChatForm').style.display = bloqueado && !c.yo_bloquee ? 'none' : '';
      $('siaChatTexto').disabled = bloqueado;

      var msgs = data.mensajes || [];
      var yo = JSON.parse(sessionStorage.getItem('sia_usuario') || '{}');
      var miId = yo.id;
      $('siaChatMensajes').innerHTML = msgs.length
        ? msgs.map(function (m) {
            var mio = m.remitente_id === miId;
            var h = new Date(m.created_at);
            var hh = String(h.getHours()).padStart(2, '0');
            var mm = String(h.getMinutes()).padStart(2, '0');
            return '<div class="sia-chat-msg ' + (mio ? 'sia-mio' : 'sia-suyo') + '">' +
                     (m.texto || '') +
                     '<span class="sia-chat-msg-hora">' + hh + ':' + mm + '</span>' +
                   '</div>';
          }).join('')
        : '<div class="sia-chat-vacio">Escribe el primer mensaje.</div>';
      $('siaChatMensajes').scrollTop = $('siaChatMensajes').scrollHeight;

      var idx = estado.conversaciones.findIndex(function (x) { return x.id === chatId; });
      if (idx >= 0) {
        estado.conversaciones[idx].no_leidos = 0;
        pintarBadge();
        renderLista();
      }
    } catch (e) {
      $('siaChatMensajes').innerHTML = '<div class="sia-chat-vacio">Error cargando el chat.</div>';
    }
  }

  async function abrirNuevoChat(tipo, enteId) {
    try {
      var data = await peticion('/api/chat/abrir', { method: 'POST', body: JSON.stringify({ tipo: tipo, ente_id: enteId }) });
      if (!data.ok) { alert(data.mensaje || 'No se pudo abrir el chat.'); return; }
      estado.buscando = false;
      $('siaChatSearch').value = '';
      await cargarConversaciones();
      if (data.chat) abrirConversacion(data.chat.id);
    } catch (e) { alert('Error de conexión.'); }
  }

  // ── Búsqueda (admin/superadmin) ─────────────────────────────
  var timerBusqueda = null;
  function onBuscar() {
    var q = $('siaChatSearch').value.trim();
    estado.buscando = q.length > 0;
    if (!estado.buscando) { renderLista(); return; }
    clearTimeout(timerBusqueda);
    timerBusqueda = setTimeout(function () {
      peticion('/api/chat/buscar?q=' + encodeURIComponent(q)).then(function (data) {
        if (!$('siaChatSearch') || $('siaChatSearch').value.trim() !== q) return;
        var cont = $('siaChatConversaciones');
        if (!data.ok || !data.resultados.length) {
          cont.innerHTML = '<div class="sia-chat-vacio">Sin resultados.</div>';
          return;
        }
        cont.innerHTML = data.resultados.map(function (r) {
          return '<div class="sia-chat-resultado" data-tipo="' + r.tipo + '" data-id="' + r.id + '">' +
                   '<div class="sia-chat-avatar">' + iniciales(r.nombre) + '</div>' +
                   '<div class="sia-chat-conv-info">' +
                     '<div class="sia-chat-conv-nombre">' + r.nombre + '</div>' +
                     '<div class="sia-chat-conv-sub">' + (r.sub || '') + '</div>' +
                   '</div>' +
                 '</div>';
        }).join('');
        cont.querySelectorAll('.sia-chat-resultado[data-id]').forEach(function (el) {
          el.addEventListener('click', function () {
            abrirNuevoChat(el.getAttribute('data-tipo'), el.getAttribute('data-id'));
          });
        });
      });
    }, 260);
  }

  // ── Enviar ──────────────────────────────────────────────────
  async function enviarMensaje() {
    var area = $('siaChatTexto');
    var texto = area.value.trim();
    if (!estado.activaId || !texto) return;
    area.value = '';
    area.style.height = 'auto';
    try {
      var res = await peticion('/api/chat/' + estado.activaId + '/enviar', {
        method: 'POST', body: JSON.stringify({ texto: texto })
      });
      if (!res.ok) {
        area.value = texto;
        alert(res.mensaje || 'No se pudo enviar el mensaje.');
        return;
      }
      abrirConversacion(estado.activaId);
      cargarConversaciones();
    } catch (e) {
      area.value = texto;
      alert('Error al enviar el mensaje.');
    }
  }

  // ── Bloquear / desbloquear ──────────────────────────────────
  async function alternarBloqueo() {
    if (!estado.activaId) return;
    var res = await peticion('/api/chat/' + estado.activaId + '/desbloquear', { method: 'POST', body: '{}' });
    var accion = res.ok ? 'desbloquear' : 'bloquear';
    if (!res.ok) {
      res = await peticion('/api/chat/' + estado.activaId + '/' + accion, { method: 'POST', body: '{}' });
    }
    if (res.ok) {
      abrirConversacion(estado.activaId);
      cargarConversaciones();
    } else {
      alert(res.mensaje || 'No se pudo cambiar el bloqueo.');
    }
  }

  // ── Toggle de configuración (admin) ─────────────────────────
  async function alternarConfig() {
    if (estado.config && estado.config.rol !== 'admin') return;
    var nuevo = !(estado.config && estado.config.permitir_mensajes_abiertos);
    try {
      var data = await peticion('/api/chat/config', {
        method: 'PUT', body: JSON.stringify({ permitir_mensajes_abiertos: nuevo })
      });
      if (data.ok) {
        estado.config.permitir_mensajes_abiertos = nuevo;
        actualizarControlesRol();
      } else alert(data.mensaje || 'No se pudo guardar.');
    } catch (e) { alert('Error de conexión.'); }
  }

  // ── Abrir / cerrar drawer ───────────────────────────────────
  function abrir() {
    if (window.SIA_cerrarOverlays) window.SIA_cerrarOverlays();
    DRAWER.classList.add('sia-abierto');
    FONDO.className = 'sia-abierto';
    if (!EN_SHELL) FAB.style.display = 'none';
    cargarConversaciones();
  }
  function cerrar() {
    DRAWER.classList.remove('sia-abierto');
    FONDO.className = '';
    if (!EN_SHELL) FAB.style.display = '';
  }

  // ── Socket (tiempo real) ────────────────────────────────────
  function conectarSocket() {
    if (estado.socket || typeof window.io !== 'function' || !token()) return;
    try {
      estado.socket = io(API, { auth: { token: token() } });
      estado.socket.on('chat:update', function (payload) {
        cargarConversaciones();
        if (estado.activaId && payload && payload.chat_id === estado.activaId) {
          abrirConversacion(estado.activaId);
        }
      });
      estado.socket.on('chat:leido', function () { cargarConversaciones(); });
    } catch (e) { /* socket no disponible */ }
  }

  // ── Cableado de eventos ─────────────────────────────────────
  FAB.addEventListener('click', abrir);
  $('siaChatClose').addEventListener('click', cerrar);
  FONDO.addEventListener('click', cerrar);
  $('siaChatVolver').addEventListener('click', function () {
    $('siaChatConversacion').style.display = 'none';
    estado.activaId = null;
    estado.buscando = false;
    $('siaChatSearch').value = '';
    renderLista();
  });
  $('siaChatEnviar').addEventListener('click', enviarMensaje);
  $('siaChatForm').addEventListener('submit', function (e) { e.preventDefault(); enviarMensaje(); });
  $('siaChatTexto').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarMensaje(); }
  });
  $('siaChatTexto').addEventListener('input', function () {
    var el = this; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 90) + 'px';
  });
  $('siaChatBloquear').addEventListener('click', alternarBloqueo);
  $('siaChatToggle').addEventListener('click', alternarConfig);
  $('siaChatSearch').addEventListener('input', onBuscar);

  // Campanitas "Notificaciones" existentes en los topbars abren el chat.
  document.querySelectorAll('[title="Notificaciones"]').forEach(function (b) {
    b.style.cursor = 'pointer';
    b.addEventListener('click', abrir);
  });

  // ── Init ────────────────────────────────────────────────────
  cargarConfig().then(function () { if (!EN_SHELL) conectarSocket(); });
  cargarConversaciones();
  pintarBadge();

  // Si socket.io tarda en cargarse, se reintenta la conexión un rato.
  var reintentos = 0;
  var timerIntento = setInterval(function () {
    if (EN_SHELL) { clearInterval(timerIntento); return; }
    if (estado.socket) { clearInterval(timerIntento); return; }
    if (reintentos++ >= 6) { clearInterval(timerIntento); return; }
    if (typeof window.io === 'function') conectarSocket();
  }, 1200);

  window.SIA_CHAT = { abrir: abrir, cerrar: cerrar };
  pintarBadge();
})();