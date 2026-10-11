// ============================================================
//  chat-drawer-inyector.js — Carga el centro de mensajería en
//  cualquier página: CSS + markup (chat-drawer.html) + script
//  (chat-drawer.js) y asegura el cliente de socket.io.
//  Uso: <script src="chat-drawer-inyector.js"></script>
// ============================================================
(function () {
  if (document.getElementById('siaChatRoot')) return;

  var raiz = document.createElement('div');
  raiz.id = 'siaChatRoot';
  document.body.appendChild(raiz);

  function txt(url) { return fetch(url).then(function (r) { return r.text(); }); }

  // Cliente socket.io (si la página no lo cargó ya).
  if (typeof window.io !== 'function' && !document.querySelector('script[src*="socket.io.js"]')) {
    var sio = document.createElement('script');
    sio.src = '/socket.io/socket.io.js';
    document.head.appendChild(sio);
  }

  // CSS.
  txt('chat-drawer.css').then(function (css) {
    var st = document.createElement('style');
    st.textContent = css;
    raiz.appendChild(st);
  }).catch(function () {});

  // Markup; el script de lógica se agrega DESPUÉS para que el DOM ya exista.
  txt('chat-drawer.html').then(function (html) {
    raiz.insertAdjacentHTML('beforeend', html);
    var js = document.createElement('script');
    js.src = 'chat-drawer.js';
    raiz.appendChild(js);
  }).catch(function () {});
})();

// ── Exclusividad de overlays (bug de fondos superpuestos) ──────
// Si se abre un overlay "principal" — ajustes o el selector de fondo —
// se cierra el otro automáticamente en cualquier página, con cualquier rol.
(function () {
  function cerrarOtroSingleton(nuevo) {
    ['overlayAjustes', 'overlayFondo'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el !== nuevo && el.classList.contains('visible')) {
        el.classList.remove('visible');
      }
    });
  }
  var obs = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === 'attributes' && m.attributeName === 'class' &&
          m.target.classList && m.target.classList.contains('visible') &&
          (m.target.id === 'overlayAjustes' || m.target.id === 'overlayFondo')) {
        cerrarOtroSingleton(m.target);
      }
    }
  });
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'], subtree: true });
  // Expuesto: cierra cualquier modal abierto (lo usa el chat al abrirse).
  window.SIA_cerrarOverlays = function () {
    document.querySelectorAll('.overlay.visible').forEach(function (o) { o.classList.remove('visible'); });
  };
})();