// ============================================================
//  sia-chat-curso.js — Chat del curso (ROADMAP Ronda F, F5).
//  Un chat POR CURSO donde solo escriben los docentes (y el
//  sistema). Estudiantes y acudientes solo leen. El sistema avisa
//  de actividades, notas, comunicados y videollamadas (con el
//  código de sala y el enlace directo para entrar con un clic).
//
//  Uso:  SIAChatCurso.montar(grupoId)          → monta en un
//         contenedor fijo bajo la página (o donde se le diga).
//         SIAChatCurso.desmontar()             → lo quita.
//  Requiere sessionStorage.sia_token (login).
// ============================================================
(function () {
  if (window.SIAChatCurso) return;

  var API = window.location.origin;
  var grupoId = null;
  var puedeEscribir = false;
  var socket = null;
  var contenedor = null;

  var CSS = `
  #ccRaiz { margin: 1rem 0; }
  .cc-tarjeta { background: rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08);
    border-radius:14px; overflow:hidden; display:flex; flex-direction:column; max-width:720px; }
  .cc-cab { padding:.8rem 1rem; border-bottom:1px solid rgba(255,255,255,.08); }
  .cc-titulo { font-weight:700; font-size:.95rem; }
  .cc-sub { font-size:.74rem; color:var(--text-3,#94a3b8); margin-top:2px; }
  .cc-lista { padding:.8rem 1rem; display:flex; flex-direction:column; gap:.55rem;
    max-height:340px; overflow-y:auto; }
  .cc-vacio { color:var(--text-3,#94a3b8); font-size:.82rem; text-align:center; padding:1rem 0; }
  .cc-msg { max-width:82%; padding:.5rem .7rem; border-radius:12px; font-size:.84rem; line-height:1.35;
    background:rgba(74,144,217,.18); border:1px solid rgba(74,144,217,.35); align-self:flex-start; }
  .cc-msg.mio { align-self:flex-end; background:rgba(34,197,94,.16); border-color:rgba(34,197,94,.4); }
  .cc-msg.sistema { align-self:stretch; max-width:100%; background:rgba(148,163,184,.12);
    border-color:rgba(148,163,184,.3); border-left:3px solid #38bdf8; }
  .cc-autor { display:block; font-size:.68rem; font-weight:700; letter-spacing:.03em;
    text-transform:uppercase; opacity:.75; margin-bottom:2px; }
  .cc-hora { display:block; font-size:.62rem; opacity:.6; margin-top:3px; }
  .cc-enlace { display:inline-block; margin-top:.4rem; padding:.3rem .6rem; border-radius:8px;
    background:#2563eb; color:#fff; font-size:.76rem; font-weight:700; text-decoration:none; }
  .cc-enlace:hover { background:#1d4ed8; }
  .cc-codigo { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:.76rem;
    background:rgba(0,0,0,.25); padding:.1rem .35rem; border-radius:6px; }
  .cc-escribir { display:flex; gap:.5rem; padding:.7rem 1rem; border-top:1px solid rgba(255,255,255,.08); }
  .cc-escribir input { flex:1; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12);
    border-radius:10px; padding:.45rem .7rem; color:var(--text-1,#e2e8f0); font-size:.85rem; }
  .cc-escribir button { background:#2563eb; color:#fff; border:0; border-radius:10px;
    padding:.45rem .9rem; font-weight:700; font-size:.82rem; cursor:pointer; }
  .cc-escribir button:hover { background:#1d4ed8; }
  .cc-error { color:#f87171; font-size:.78rem; padding:0 1rem .6rem; }
  `;

  function token() { return sessionStorage.getItem('sia_token'); }
  function cabeceras(extra) {
    var h = { Authorization: 'Bearer ' + token() };
    if (extra) Object.assign(h, extra);
    return h;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function horaTxt(iso) {
    try { return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }); }
    catch (e) { return ''; }
  }

  function burbuja(m) {
    var div = document.createElement('div');
    var soyYo = m.origen === 'usuario' && m.remitente_id === usuarioActualId();
    div.className = 'cc-msg' + (soyYo ? ' mio' : '') + (m.origen === 'sistema' ? ' sistema' : '');

    var html = '<span class="cc-autor">' + esc(m.remitente_nombre || 'Sistema') + '</span>';
    html += '<span>' + esc(m.texto).replace(/\n/g, '<br>') + '</span>';

    if (m.datos && m.datos.sala) {
      html += '<div style="margin-top:4px">Código de sala: <span class="cc-codigo">' + esc(m.datos.sala) + '</span></div>';
    }
    if (m.datos && m.datos.url) {
      html += '<a class="cc-enlace" href="' + esc(m.datos.url) + '" target="_blank" rel="noopener">Entrar a la videollamada ▶</a>';
    }
    html += '<span class="cc-hora">' + horaTxt(m.created_at) + '</span>';
    div.innerHTML = html;
    return div;
  }

  function usuarioActualId() {
    try { return JSON.parse(sessionStorage.getItem('sia_usuario') || '{}').id || null; }
    catch (e) { return null; }
  }

  function pintar(m, alFinal) {
    if (!contenedor) return;
    var lista = contenedor.querySelector('.cc-lista');
    if (!lista) return;
    var vacio = lista.querySelector('.cc-vacio');
    if (vacio) vacio.remove();
    if (alFinal !== false) lista.appendChild(burbuja(m));
    else lista.insertBefore(burbuja(m), lista.firstChild);
    lista.scrollTop = lista.scrollHeight;
  }

  function conectarSocket() {
    if (socket || typeof window.io !== 'function') return;
    try {
      socket = window.io(window.location.origin, { auth: { token: token() } });
      socket.on('chat-curso:mensaje', function (data) {
        if (data && String(data.grupo_id) === String(grupoId) && data.mensaje) pintar(data.mensaje);
      });
    } catch (e) { /* sin tiempo real: igual funciona al recargar */ }
  }

  async function cargar() {
    var res = await fetch(API + '/api/chat/curso/' + grupoId, { headers: cabeceras() });
    var data = await res.json();
    if (!data.ok) {
      contenedor.querySelector('.cc-lista').innerHTML =
        '<div class="cc-vacio">' + esc(data.mensaje || 'No se pudo abrir el chat del curso.') + '</div>';
      return;
    }
    puedeEscribir = !!(data.chat && data.chat.puede_escribir);
    var lista = contenedor.querySelector('.cc-lista');
    lista.innerHTML = '';
    if (!data.mensajes.length) {
      lista.innerHTML = '<div class="cc-vacio">Todavía no hay mensajes en este chat.</div>';
    } else {
      data.mensajes.forEach(function (m) { pintar(m); });
    }
    if (puedeEscribir) {
      var z = contenedor.querySelector('.cc-escribir');
      if (z) z.style.display = '';
    }
  }

  async function enviar() {
    if (!puedeEscribir) return;
    var input = contenedor.querySelector('.cc-texto');
    var err = contenedor.querySelector('.cc-error');
    var texto = (input.value || '').trim();
    if (!texto) return;
    input.value = '';
    try {
      var res = await fetch(API + '/api/chat/curso/' + grupoId + '/mensajes', {
        method: 'POST',
        headers: cabeceras({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ texto: texto }),
      });
      var data = await res.json();
      if (!data.ok) {
        err.textContent = data.mensaje || 'No se pudo enviar.';
        if (err) err.style.display = '';
        return;
      }
      // El socket lo pinta; si no hay socket, refrescamos.
      if (!socket) cargar();
    } catch (e) {
      err.textContent = 'Error de conexión.';
      if (err) err.style.display = '';
    }
  }

  function asegurarSocketLib() {
    if (typeof window.io === 'function') return;
    if (document.querySelector('script[src*="socket.io.js"]')) return;
    var s = document.createElement('script');
    s.src = '/socket.io/socket.io.js';
    document.head.appendChild(s);
  }

  function montar(gId, destino) {
    if (!gId) return null;
    grupoId = gId;

    if (!document.getElementById('ccEstilos')) {
      var st = document.createElement('style');
      st.id = 'ccEstilos';
      st.textContent = CSS;
      document.head.appendChild(st);
    }

    desmontar();
    var html = `
      <div class="cc-tarjeta" id="ccTarjeta">
        <div class="cc-cab">
          <div class="cc-titulo">💬 Chat del curso</div>
          <div class="cc-sub">Avisos del profesor y del sistema (actividades, notas y videollamadas). Los estudiantes y acudientes solo leen.</div>
        </div>
        <div class="cc-lista"></div>
        <div class="cc-error" style="display:none"></div>
        <div class="cc-escribir" style="display:none">
          <input type="text" class="cc-texto" maxlength="2000" placeholder="Escribe un mensaje para el curso..." />
          <button type="button" class="cc-boton">Enviar</button>
        </div>
      </div>`;

    var host = destino || document.getElementById('chatCursoContenedor') || document.querySelector('main') || document.body;
    if (host.id === 'chatCursoContenedor' || !document.getElementById('chatCursoContenedor')) {
      contenedor = document.createElement('div');
      contenedor.id = 'ccRaiz';
      contenedor.innerHTML = html;
      host.appendChild(contenedor);
    } else {
      host.insertAdjacentHTML('beforeend', html);
      contenedor = host.querySelector('#ccRaiz');
    }

    contenedor.querySelector('.cc-boton').addEventListener('click', enviar);
    contenedor.querySelector('.cc-texto').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') enviar();
    });

    asegurarSocketLib();
    conectarSocket();
    cargar().catch(function () {});
    return contenedor;
  }

  function desmontar() {
    if (socket) { try { socket.disconnect(); } catch (e) {} socket = null; }
    if (contenedor && contenedor.parentNode) contenedor.parentNode.removeChild(contenedor);
    contenedor = null;
  }

  window.SIAChatCurso = { montar: montar, desmontar: desmontar };
})();
