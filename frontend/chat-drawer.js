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
    archivoPendiente: null,
    transcripcionPendiente: '',
    urlsAdjuntos: [],
    grabadora: null,
    stream: null,
    reconocimiento: null,
    transcripcionAudio: '',
    fragmentosAudio: [],
    tamanioAudio: 0,
    inicioGrabacion: 0,
    timerGrabacion: null,
    timerTranscripcion: null,
    cancelandoGrabacion: false,
    limiteGrabacion: false,
    transcripcionLista: true,
    transcripcionNoDisponible: false,
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
        // El estado vacío de la lista depende de la config: si las
        // conversaciones respondieron antes que esta petición, se quedaba
        // mostrando "Cargando…" para siempre.
        renderLista();
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

  function iconoArchivo(nombre) {
    var ext = (nombre || '').split('.').pop().toLowerCase();
    if (['webm', 'ogg', 'mp4', 'mp3', 'wav'].includes(ext)) return '🎧';
    if (['jpg', 'jpeg', 'png'].includes(ext)) return '🖼️';
    if (ext === 'pdf') return '📕';
    if (['docx', 'xlsx', 'pptx'].includes(ext)) return '📄';
    if (ext === 'zip') return '🗜️';
    return '📎';
  }

  function revocarUrlsAdjuntos() {
    estado.urlsAdjuntos.forEach(function (url) { URL.revokeObjectURL(url); });
    estado.urlsAdjuntos = [];
  }

  async function obtenerUrlAdjunto(mensaje) {
    var chatId = estado.activaId;
    var res = await fetch(API + '/api/chat/' + chatId + '/adjuntos/' + encodeURIComponent(mensaje.id), {
      headers: { Authorization: 'Bearer ' + token() },
    });
    if (!res.ok) throw new Error('No se pudo cargar el adjunto.');
    var url = URL.createObjectURL(await res.blob());
    estado.urlsAdjuntos.push(url);
    return url;
  }

  function iniciarDescarga(url, nombre) {
    var enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombre || 'adjunto';
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
  }

  function prepararDescarga(mensaje, enlace) {
    enlace.addEventListener('click', async function (evento) {
      evento.preventDefault();
      if (enlace.dataset.cargando === '1') return;
      if (enlace.dataset.url) {
        iniciarDescarga(enlace.dataset.url, mensaje.archivo_nombre);
        return;
      }
      enlace.dataset.cargando = '1';
      enlace.textContent = 'Descargando…';
      try {
        var url = await obtenerUrlAdjunto(mensaje);
        enlace.dataset.url = url;
        enlace.setAttribute('aria-disabled', 'false');
        iniciarDescarga(url, mensaje.archivo_nombre);
      } catch (e) {
        enlace.textContent = 'No se pudo descargar ' + (mensaje.archivo_nombre || 'el adjunto');
      } finally {
        enlace.dataset.cargando = '';
      }
    });
  }

  function prepararReproductor(mensaje, reproductor, estadoAudio) {
    var cargar = async function () {
      if (reproductor.dataset.cargando === '1' || reproductor.dataset.url) return;
      reproductor.dataset.cargando = '1';
      estadoAudio.textContent = 'Cargando audio…';
      try {
        var url = await obtenerUrlAdjunto(mensaje);
        reproductor.dataset.url = url;
        reproductor.src = url;
        reproductor.load();
        estadoAudio.textContent = '';
      } catch (e) {
        estadoAudio.textContent = 'No se pudo cargar el audio.';
      } finally {
        reproductor.dataset.cargando = '';
      }
    };

    if (typeof IntersectionObserver === 'function') {
      var observador = new IntersectionObserver(function (entradas) {
        if (entradas.some(function (entrada) { return entrada.isIntersecting; })) {
          observador.disconnect();
          cargar();
        }
      }, { root: $('siaChatMensajes'), rootMargin: '80px' });
      observador.observe(reproductor);
    } else {
      reproductor.addEventListener('click', cargar, { once: true });
    }
  }

  function elementoMensaje(m, miId) {
    var mio = m.remitente_id === miId;
    var h = new Date(m.created_at);
    var hora = String(h.getHours()).padStart(2, '0') + ':' + String(h.getMinutes()).padStart(2, '0');
    var nodo = document.createElement('div');
    nodo.className = 'sia-chat-msg ' + (mio ? 'sia-mio' : 'sia-suyo');

    if (m.archivo_id) {
      var cabecera = document.createElement('div');
      cabecera.className = 'sia-chat-msg-adjunto';
      var icono = document.createElement('span');
      icono.textContent = iconoArchivo(m.archivo_nombre);
      cabecera.appendChild(icono);

      var enlace = document.createElement('a');
      enlace.className = 'sia-chat-msg-descarga';
      enlace.textContent = m.archivo_nombre || 'Adjunto';
      enlace.href = '#';
      enlace.setAttribute('aria-disabled', 'false');
      enlace.download = m.archivo_nombre || 'adjunto';
      prepararDescarga(m, enlace);
      cabecera.appendChild(enlace);
      nodo.appendChild(cabecera);

      var reproductor = null;
      if (m.tipo === 'audio') {
        reproductor = document.createElement('audio');
        reproductor.className = 'sia-chat-msg-audio';
        reproductor.controls = true;
        reproductor.preload = 'none';
        nodo.appendChild(reproductor);
        var estadoAudio = document.createElement('small');
        estadoAudio.className = 'sia-chat-msg-estado-audio';
        nodo.appendChild(estadoAudio);
        prepararReproductor(m, reproductor, estadoAudio);
      }
    }

    if (m.texto) {
      var texto = document.createElement('div');
      texto.textContent = m.texto;
      nodo.appendChild(texto);
    }
    if (m.tipo === 'audio' && m.transcripcion) {
      var transcripcion = document.createElement('div');
      transcripcion.className = 'sia-chat-msg-transcripcion';
      var etiqueta = document.createElement('small');
      etiqueta.textContent = 'Transcripción';
      var contenido = document.createElement('div');
      contenido.textContent = m.transcripcion;
      transcripcion.appendChild(etiqueta);
      transcripcion.appendChild(contenido);
      nodo.appendChild(transcripcion);
    }

    var marcaTiempo = document.createElement('span');
    marcaTiempo.className = 'sia-chat-msg-hora';
    marcaTiempo.textContent = hora;
    nodo.appendChild(marcaTiempo);
    return nodo;
  }

  function limpiarAdjuntoPendiente() {
    estado.archivoPendiente = null;
    estado.transcripcionPendiente = '';
    $('siaChatArchivo').value = '';
    $('siaChatAdjuntoSeleccionado').style.display = 'none';
  }

  function mostrarAdjuntoPendiente(file) {
    estado.archivoPendiente = file;
    $('siaChatAdjuntoIcono').textContent = iconoArchivo(file.name);
    $('siaChatAdjuntoNombre').textContent = file.name;
    $('siaChatAdjuntoSeleccionado').style.display = 'flex';
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
    if (estado.activaId !== chatId) {
      if (estado.grabadora) cancelarGrabacion();
      limpiarAdjuntoPendiente();
    }
    estado.activaId = chatId;
    revocarUrlsAdjuntos();
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
      if (bloqueado && estado.grabadora) cancelarGrabacion();
      $('siaChatBloqueadoBanner').style.display = bloqueado ? 'block' : 'none';
      $('siaChatBloqueadoBanner').textContent = bloqueado
        ? (c.yo_bloquee ? 'Bloqueaste este chat. Desbloquéalo si quieres volver a escribir.' : 'Este chat está bloqueado.')
        : '';
      $('siaChatBloquear').textContent = bloqueado ? (c.yo_bloquee ? 'Desbloquear' : 'Bloqueado') : 'Bloquear';
      $('siaChatBloquear').disabled = bloqueado && !c.yo_bloquee;
      $('siaChatForm').style.display = bloqueado && !c.yo_bloquee ? 'none' : '';
      $('siaChatTexto').disabled = bloqueado;
      $('siaChatAdjuntar').disabled = bloqueado;
      $('siaChatGrabar').disabled = bloqueado;
      $('siaChatEnviar').disabled = bloqueado;

      var msgs = data.mensajes || [];
      var yo = JSON.parse(sessionStorage.getItem('sia_usuario') || '{}');
      var miId = yo.id;
      var contMensajes = $('siaChatMensajes');
      contMensajes.replaceChildren();
      if (msgs.length) {
        msgs.forEach(function (m) { contMensajes.appendChild(elementoMensaje(m, miId)); });
      } else {
        contMensajes.innerHTML = '<div class="sia-chat-vacio">Escribe el primer mensaje.</div>';
      }
      contMensajes.scrollTop = contMensajes.scrollHeight;

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

  var TAMANIO_MAXIMO_ADJUNTO = 5 * 1024 * 1024;
  var EXTENSIONES_AUDIO_UI = new Set(['webm', 'ogg', 'mp4', 'mp3', 'wav']);

  function limpiarInterfazGrabacion() {
    if (estado.timerGrabacion) clearInterval(estado.timerGrabacion);
    estado.timerGrabacion = null;
    $('siaChatGrabacion').style.display = 'none';
    $('siaChatForm').style.display = '';
  }

  function detenerPistas() {
    if (!estado.stream) return;
    estado.stream.getTracks().forEach(function (pista) { pista.stop(); });
    estado.stream = null;
  }

  function detenerReconocimiento() {
    if (!estado.reconocimiento) return;
    try { estado.reconocimiento.stop(); } catch (e) { /* ya se había detenido */ }
  }

  function actualizarEnvioGrabacion() {
    var boton = $('siaChatEnviarGrabacion');
    boton.disabled = !estado.transcripcionLista;
    if (!estado.transcripcionLista) $('siaChatGrabacionEstado').textContent = 'Esperando transcripción…';
  }

  function cancelarGrabacion() {
    if (estado.timerTranscripcion) clearTimeout(estado.timerTranscripcion);
    estado.timerTranscripcion = null;
    estado.cancelandoGrabacion = true;
    detenerReconocimiento();
    if (estado.grabadora && estado.grabadora.state !== 'inactive') {
      estado.grabadora.stop();
      return;
    }
    detenerPistas();
    estado.grabadora = null;
    estado.reconocimiento = null;
    estado.cancelandoGrabacion = false;
    estado.transcripcionAudio = '';
    estado.transcripcionPendiente = '';
    limpiarAdjuntoPendiente();
    limpiarInterfazGrabacion();
  }

  function actualizarRelojGrabacion() {
    var segundos = Math.floor((Date.now() - estado.inicioGrabacion) / 1000);
    var minutosTexto = String(Math.floor(segundos / 60)).padStart(2, '0');
    var segundosTexto = String(segundos % 60).padStart(2, '0');
    $('siaChatGrabacionTiempo').textContent = minutosTexto + ':' + segundosTexto;
  }

  function extensionAudio(mime) {
    var tipo = (mime || '').split(';')[0].toLowerCase();
    if (tipo.indexOf('ogg') >= 0) return 'ogg';
    if (tipo.indexOf('mp4') >= 0 || tipo.indexOf('aac') >= 0) return 'mp4';
    if (tipo.indexOf('mpeg') >= 0 || tipo.indexOf('mp3') >= 0) return 'mp3';
    if (tipo.indexOf('wav') >= 0) return 'wav';
    return 'webm';
  }

  function iniciarReconocimiento() {
    var Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    estado.transcripcionAudio = '';
    estado.transcripcionLista = !Constructor;
    estado.transcripcionNoDisponible = !Constructor;
    if (!Constructor) {
      $('siaChatGrabacionEstado').textContent =
        'Este navegador no permite transcribir; se enviará solo el audio.';
      return;
    }

    try {
      var reconocimiento = new Constructor();
      estado.reconocimiento = reconocimiento;
      reconocimiento.lang = 'es-CO';
      reconocimiento.continuous = true;
      reconocimiento.interimResults = true;
      reconocimiento.onresult = function (evento) {
        var final = '', parcial = '';
        for (var i = 0; i < reconocimiento.results.length; i++) {
          var resultado = reconocimiento.results[i];
          if (resultado.isFinal) final += resultado[0].transcript + ' ';
          else parcial += resultado[0].transcript + ' ';
        }
        estado.transcripcionAudio = final.trim();
        $('siaChatTranscripcionVista').textContent = (final + parcial).trim();
      };
      reconocimiento.onerror = function () {
        estado.transcripcionLista = true;
        estado.transcripcionNoDisponible = true;
        $('siaChatGrabacionEstado').textContent = 'No se pudo transcribir; se enviará solo el audio.';
        actualizarEnvioGrabacion();
      };
      reconocimiento.onend = function () {
        estado.transcripcionLista = true;
        if (estado.transcripcionNoDisponible) {
          $('siaChatGrabacionEstado').textContent = 'No se pudo transcribir; se enviará solo el audio.';
        } else if (estado.grabadora && estado.grabadora.state === 'recording') {
          $('siaChatGrabacionEstado').textContent = 'Grabando audio…';
        } else {
          $('siaChatGrabacionEstado').textContent = estado.limiteGrabacion
            ? 'Se detuvo al alcanzar el límite de 5 MB.'
            : 'Grabación lista.';
        }
        actualizarEnvioGrabacion();
      };
      reconocimiento.start();
    } catch (e) {
      estado.transcripcionLista = true;
      estado.transcripcionNoDisponible = true;
      estado.reconocimiento = null;
      $('siaChatGrabacionEstado').textContent = 'No se pudo transcribir; se enviará solo el audio.';
    }
  }

  async function iniciarGrabacion() {
    if (estado.archivoPendiente) {
      alert('Quita el archivo adjunto antes de grabar un audio.');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof window.MediaRecorder !== 'function') {
      alert('Este navegador no permite grabar audio.');
      return;
    }

    try {
      estado.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      var opciones = {};
      ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].some(function (tipo) {
        if (window.MediaRecorder.isTypeSupported(tipo)) {
          opciones.mimeType = tipo;
          return true;
        }
        return false;
      });
      estado.grabadora = new window.MediaRecorder(estado.stream, opciones);
      estado.fragmentosAudio = [];
      estado.tamanioAudio = 0;
      estado.cancelandoGrabacion = false;
      estado.limiteGrabacion = false;
      estado.transcripcionNoDisponible = false;
      if (estado.timerTranscripcion) clearTimeout(estado.timerTranscripcion);
      estado.timerTranscripcion = null;
      estado.inicioGrabacion = Date.now();
      estado.transcripcionAudio = '';
      estado.transcripcionLista = false;
      $('siaChatTranscripcionVista').textContent = '';
      $('siaChatGrabacionEstado').textContent = 'Grabando audio…';
      $('siaChatDetenerGrabacion').style.display = '';
      $('siaChatEnviarGrabacion').style.display = 'none';
      $('siaChatEnviarGrabacion').disabled = true;
      $('siaChatForm').style.display = 'none';
      $('siaChatGrabacion').style.display = 'block';
      actualizarRelojGrabacion();
      estado.timerGrabacion = setInterval(actualizarRelojGrabacion, 250);
      iniciarReconocimiento();

      var grabadora = estado.grabadora;
      grabadora.ondataavailable = function (evento) {
        if (!evento.data || !evento.data.size || estado.cancelandoGrabacion) return;
        if (estado.tamanioAudio + evento.data.size > TAMANIO_MAXIMO_ADJUNTO) {
          estado.limiteGrabacion = true;
          detenerGrabacion();
          return;
        }
        estado.fragmentosAudio.push(evento.data);
        estado.tamanioAudio += evento.data.size;
        if (estado.tamanioAudio >= TAMANIO_MAXIMO_ADJUNTO - 128 * 1024) {
          estado.limiteGrabacion = true;
          detenerGrabacion();
        }
      };
      grabadora.onerror = function () {
        alert('Ocurrió un error al grabar el audio.');
        cancelarGrabacion();
      };
      grabadora.onstop = function () {
        if (estado.timerGrabacion) clearInterval(estado.timerGrabacion);
        estado.timerGrabacion = null;
        detenerPistas();
        estado.grabadora = null;
        estado.reconocimiento = null;
        if (estado.cancelandoGrabacion) {
          estado.cancelandoGrabacion = false;
          estado.transcripcionAudio = '';
          limpiarAdjuntoPendiente();
          $('siaChatTranscripcionVista').textContent = '';
          limpiarInterfazGrabacion();
          return;
        }

        var blob = new Blob(estado.fragmentosAudio, { type: grabadora.mimeType || 'audio/webm' });
        if (!blob.size || blob.size > TAMANIO_MAXIMO_ADJUNTO) {
          alert('No se pudo preparar una grabación de hasta 5 MB.');
          limpiarInterfazGrabacion();
          return;
        }
        var extension = extensionAudio(blob.type);
        var mime = (blob.type || 'audio/webm').split(';')[0];
        estado.archivoPendiente = new File([blob], 'mensaje-de-voz.' + extension, { type: mime });
        estado.transcripcionPendiente = estado.transcripcionAudio.trim();
        $('siaChatDetenerGrabacion').style.display = 'none';
        $('siaChatEnviarGrabacion').style.display = '';
        $('siaChatGrabacionEstado').textContent = estado.transcripcionNoDisponible
          ? 'Este navegador no permite transcribir; se enviará solo el audio.'
          : estado.limiteGrabacion
            ? 'Se detuvo al alcanzar el límite de 5 MB.'
            : 'Grabación lista.';
        if (!estado.transcripcionLista) {
          actualizarEnvioGrabacion();
          estado.timerTranscripcion = setTimeout(function () {
            estado.timerTranscripcion = null;
            estado.transcripcionLista = true;
            actualizarEnvioGrabacion();
          }, 2000);
        } else {
          $('siaChatEnviarGrabacion').disabled = false;
        }
      };
      grabadora.start(1000);
    } catch (e) {
      detenerReconocimiento();
      detenerPistas();
      estado.grabadora = null;
      estado.reconocimiento = null;
      estado.fragmentosAudio = [];
      estado.tamanioAudio = 0;
      limpiarInterfazGrabacion();
      alert('No se pudo iniciar la grabación. Revisa el permiso del micrófono.');
    }
  }

  function detenerGrabacion() {
    if (estado.grabadora && estado.grabadora.state === 'recording') {
      try { estado.grabadora.stop(); } catch (e) { /* ya se había detenido */ }
    }
    detenerReconocimiento();
  }

  // ── Enviar ──────────────────────────────────────────────────
  async function enviarMensaje(esGrabacion) {
    var area = $('siaChatTexto');
    var texto = area.value.trim();
    var archivo = estado.archivoPendiente;
    if (!estado.activaId || (!texto && !archivo)) return;
    var chatId = estado.activaId;
    var boton = esGrabacion ? $('siaChatEnviarGrabacion') : $('siaChatEnviar');
    boton.disabled = true;

    try {
      var res;
      if (archivo) {
        var formData = new FormData();
        formData.append('texto', texto);
        formData.append('archivo', archivo, archivo.name);
        if (EXTENSIONES_AUDIO_UI.has(archivo.name.split('.').pop().toLowerCase())) {
          formData.append('transcripcion', estado.transcripcionPendiente || '');
        }
        var respuesta = await fetch(API + '/api/chat/' + chatId + '/enviar', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token() },
          body: formData,
        });
        res = await respuesta.json();
      } else {
        res = await peticion('/api/chat/' + chatId + '/enviar', {
          method: 'POST', body: JSON.stringify({ texto: texto })
        });
      }
      if (!res.ok) {
        alert(res.mensaje || 'No se pudo enviar el mensaje.');
        return;
      }

      area.value = '';
      area.style.height = 'auto';
      limpiarAdjuntoPendiente();
      if (esGrabacion) {
        estado.transcripcionAudio = '';
        $('siaChatTranscripcionVista').textContent = '';
        limpiarInterfazGrabacion();
      }
      await abrirConversacion(chatId);
      cargarConversaciones();
    } catch (e) {
      alert('Error al enviar el mensaje.');
    } finally {
      boton.disabled = false;
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
    if (estado.grabadora) cancelarGrabacion();
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
    if (estado.grabadora) cancelarGrabacion();
    limpiarAdjuntoPendiente();
    $('siaChatConversacion').style.display = 'none';
    estado.activaId = null;
    estado.buscando = false;
    $('siaChatSearch').value = '';
    renderLista();
  });
  $('siaChatEnviar').addEventListener('click', function () { enviarMensaje(false); });
  $('siaChatForm').addEventListener('submit', function (e) { e.preventDefault(); enviarMensaje(false); });
  $('siaChatAdjuntar').addEventListener('click', function () { $('siaChatArchivo').click(); });
  $('siaChatArchivo').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    if (file.size > TAMANIO_MAXIMO_ADJUNTO) {
      alert('El archivo supera el máximo permitido de 5 MB.');
      limpiarAdjuntoPendiente();
      return;
    }
    mostrarAdjuntoPendiente(file);
  });
  $('siaChatQuitarAdjunto').addEventListener('click', limpiarAdjuntoPendiente);
  $('siaChatGrabar').addEventListener('click', iniciarGrabacion);
  $('siaChatCancelarGrabacion').addEventListener('click', cancelarGrabacion);
  $('siaChatDetenerGrabacion').addEventListener('click', detenerGrabacion);
  $('siaChatEnviarGrabacion').addEventListener('click', function () { enviarMensaje(true); });
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