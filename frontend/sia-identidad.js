/* SIA · Identidad: logo de la institución y foto de perfil.
   Se carga al final de todas las páginas con sidebar.
   - Muestra el logo institucional en el sidebar (o el logo por defecto de SIA).
   - Para el rol admin (que pertenece a una institución), convierte el espacio
     del logo en un botón "+" que abre la subida del logo.
   - Aplica la foto de perfil del usuario (usuarios.foto_url) al avatar del
     sidebar y al modal "Ver perfil". La foto vive en el servidor, así que se
     ve en cualquier dispositivo y ante quien consulte su perfil.
*/
(function () {
  var API = window.location.origin;
  var token = sessionStorage.getItem('sia_token');
  if (!token) return;

  var LOGO_DEFECTO = 'static/logo/SIA_LOGO.svg?v=2';

  function leerUsuario() {
    try { return JSON.parse(sessionStorage.getItem('sia_usuario') || '{}'); } catch (e) { return {}; }
  }
  function guardarUsuario(u) {
    try { sessionStorage.setItem('sia_usuario', JSON.stringify(u)); } catch (e) {}
  }
  function urlCompleta(ruta) {
    if (!ruta) return '';
    if (/^(https?:)?\/\//.test(ruta) || ruta.indexOf('data:') === 0) return ruta;
    if (ruta.charAt(0) === '/') return API + ruta;
    return ruta;
  }

  function esAdminConInstitucion() {
    var u = leerUsuario();
    return u.rol === 'admin' && !!u.institucion_id;
  }

  /* ── Visor de imagen (agrandar + reemplazar) ── */
  var contextoVisor = null;

  function crearVisor() {
    if (document.getElementById('visorImgOverlay')) return;
    var dv = document.createElement('div');
    dv.id = 'visorImgOverlay';
    dv.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:99999;align-items:center;justify-content:center;flex-direction:column;gap:14px;padding:20px';
    dv.innerHTML =
      '<img id="visorImg" alt="" style="max-width:90vw;max-height:72vh;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.55);object-fit:contain;background:#fff;border:1px solid rgba(255,255,255,0.25)">' +
      '<div style="display:flex;gap:10px;align-items:center">' +
        '<button type="button" id="visorBtnReemplazar" style="padding:8px 16px;border:0;border-radius:8px;background:#3b82f6;color:#fff;font-family:inherit;font-size:0.85rem;font-weight:700;cursor:pointer">Reemplazar</button>' +
        '<button type="button" id="visorBtnCerrar" style="padding:8px 16px;border:1px solid rgba(255,255,255,0.35);border-radius:8px;background:transparent;color:#fff;font-family:inherit;font-size:0.85rem;cursor:pointer">Cerrar</button>' +
      '</div>' +
      '<input type="file" id="visorInputFile" accept="image/jpeg,image/png,image/webp" style="display:none">';
    document.body.appendChild(dv);

    dv.addEventListener('click', function (e) { if (e.target === dv) cerrarVisor(); });
    document.getElementById('visorBtnCerrar').addEventListener('click', cerrarVisor);
    document.getElementById('visorBtnReemplazar').addEventListener('click', function () {
      var inp = document.getElementById('visorInputFile');
      if (inp) inp.click();
    });
    document.getElementById('visorInputFile').addEventListener('change', function () {
      var inp = document.getElementById('visorInputFile');
      if (!inp.files || !inp.files[0]) { inp.value = ''; return; }
      var archivo = inp.files[0];
      inp.value = '';
      if (contextoVisor === 'logo') subirLogo(archivo);
      else if (contextoVisor === 'foto') subirFoto(archivo);
    });
  }

  function abrirVisor(url, contexto) {
    crearVisor();
    if (!url) return;
    var img = document.getElementById('visorImg');
    var btn = document.getElementById('visorBtnReemplazar');
    var ov  = document.getElementById('visorImgOverlay');
    img.src = url;
    contextoVisor = contexto || null;
    btn.style.display = contexto ? '' : 'none';
    ov.style.display = 'flex';
  }

  function cerrarVisor() {
    var ov = document.getElementById('visorImgOverlay');
    if (ov) ov.style.display = 'none';
  }

  /* ── Logo institucional ── */
  function abrirSubirLogo() {
    var inp = document.getElementById('inputLogoInst');
    if (inp) inp.click();
  }

  function subirLogo(archivo) {
    var entrada = document.getElementById('inputLogoInst');
    var formData = new FormData();
    formData.append('imagen', archivo);
    fetch(API + '/api/instituciones/logo', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: formData,
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) { alert(data.mensaje || 'No se pudo subir el logo.'); if (entrada) entrada.value = ''; return; }
        var u = leerUsuario();
        u.institucion_logo = data.logo_url;
        guardarUsuario(u);
        aplicarLogo(data.logo_url);
        cerrarVisor();
        if (entrada) entrada.value = '';
      })
      .catch(function () {
        if (entrada) entrada.value = '';
        alert('Error al subir el logo. Intenta de nuevo.');
      });
  }

  function aplicarLogo(logoUrl) {
    var img = document.getElementById('logoInstImg');
    if (!img) return;
    var fb  = document.getElementById('logoFb');
    var admin = esAdminConInstitucion();
    var url = logoUrl ? urlCompleta(logoUrl) : LOGO_DEFECTO;

    if (admin && !logoUrl) {
      // Admin sin logo: el espacio muestra un botón "+"
      img.style.display = 'none';
      if (fb) {
        fb.style.display = 'flex';
        fb.innerHTML = '+';
        fb.style.fontSize = '22px';
        fb.style.cursor = 'pointer';
        fb.title = 'Subir logo de la institución';
        fb.onclick = abrirSubirLogo;
      }
    } else {
      img.style.display = '';
      img.src = url;
      img.style.cursor = 'pointer';
      img.title = admin ? 'Ver y reemplazar logo de la institución' : 'Ver logo de la institución';
      img.onclick = function () { abrirVisor(url, admin ? 'logo' : null); };
      if (fb) fb.style.display = 'none';
    }
  }

  /* ── Foto de perfil ── */
  function pintarInicialAvatar() {
    var el = document.getElementById('sidebarAvatar');
    if (!el) return;
    var u = leerUsuario();
    var nombre = u.nombres || u.nombre || 'SIA';
    el.innerHTML = '';
    el.textContent = nombre.charAt(0).toUpperCase();
  }

  function pintarPreviewFoto(fotoUrl) {
    var el = document.getElementById('perfilFotoPreview');
    if (!el) return;
    if (fotoUrl) {
      el.innerHTML = '<img src="' + urlCompleta(fotoUrl) + '" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.parentElement.textContent=\'?\';this.parentElement.dataset.sinFoto=1">';
      el.dataset.sinFoto = '';
      el.style.cursor = 'pointer';
      el.title = 'Mi foto de perfil';
      el.onclick = function () { abrirVisor(urlCompleta(fotoUrl), 'foto'); };
    } else {
      var u = leerUsuario();
      var iniciales = (u.nombres || 'SIA').split(' ').filter(Boolean).map(function (p) { return p.charAt(0); }).join('').slice(0, 2).toUpperCase();
      el.innerHTML = '';
      el.textContent = iniciales || 'SIA';
      el.style.cursor = '';
      el.title = '';
      el.onclick = null;
    }
  }

  function aplicarAvatar(fotoUrl) {
    var el = document.getElementById('sidebarAvatar');
    if (el) {
      if (fotoUrl) {
        var u = urlCompleta(fotoUrl);
        el.innerHTML = '<img src="' + u + '" style="width:100%;height:100%;object-fit:cover;display:block" onerror="SIAIdentidad.pintarInicialAvatar()">';
        el.dataset.foto = '1';
        el.style.cursor = 'pointer';
        el.title = 'Mi foto de perfil';
        el.onclick = function () { abrirVisor(u, 'foto'); };
      } else {
        if (el.dataset.foto) {
          delete el.dataset.foto;
          pintarInicialAvatar();
        }
        el.style.cursor = '';
        el.title = '';
        el.onclick = null;
      }
    }
    pintarPreviewFoto(fotoUrl);
  }

  function subirFoto(archivo) {
    var entrada = document.getElementById('inputFotoPerfil');
    var formData = new FormData();
    formData.append('imagen', archivo);
    fetch(API + '/api/auth/foto', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: formData,
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) { alert(data.mensaje || 'No se pudo subir la foto.'); if (entrada) entrada.value = ''; return; }
        var u = leerUsuario();
        u.foto_url = data.foto_url;
        guardarUsuario(u);
        aplicarAvatar(data.foto_url);
        cerrarVisor();
        if (entrada) entrada.value = '';
      })
      .catch(function () {
        if (entrada) entrada.value = '';
        alert('Error al subir la foto. Intenta de nuevo.');
      });
  }

  /* ── UI de foto en el modal "Ver perfil" ── */
  function injectarFotoUI() {
    var overlay = document.getElementById('overlayPerfil');
    if (!overlay || document.getElementById('perfilFotoBox')) return;
    var modal = overlay.querySelector('.modal');
    if (!modal) return;
    var intro = modal.querySelector('p');
    if (!intro) return;

    var box = document.createElement('div');
    box.id = 'perfilFotoBox';
    box.style.cssText = 'display:flex;align-items:center;gap:0.9rem;margin-bottom:1rem;padding-bottom:1rem;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.15))';
    box.innerHTML =
      '<div id="perfilFotoPreview" style="width:64px;height:64px;border-radius:50%;overflow:hidden;flex-shrink:0;border:2px solid var(--glass-border-hi,rgba(255,255,255,0.4));background:rgba(59,130,246,0.25);display:flex;align-items:center;justify-content:center;font-family:var(--font-d,\'Nunito\',sans-serif);font-weight:800;font-size:18px;color:var(--blue-light,#93C5FD)">SIA</div>' +
      '<div style="min-width:0;flex:1">' +
        '<div style="font-family:var(--font-d,\'Nunito\',sans-serif);font-size:0.86rem;font-weight:700;color:var(--text-1)">Foto de perfil</div>' +
        '<div style="font-size:0.72rem;color:var(--text-3);margin:2px 0 8px;line-height:1.4">Se ve en tu avatar y ante cualquiera que consulte tu perfil.</div>' +
        '<button type="button" id="btnSubirFotoPerfil" class="btn btn-ghost btn-sm" style="pointer-events:auto">Cambiar foto</button>' +
      '</div>' +
      '<input type="file" id="inputFotoPerfil" accept="image/jpeg,image/png,image/webp" style="display:none">';

    var siguiente = intro.nextSibling;
    while (siguiente && siguiente.nodeType === 3 && !siguiente.nodeValue.trim()) siguiente = siguiente.nextSibling;
    modal.insertBefore(box, siguiente || intro);

    var boton = document.getElementById('btnSubirFotoPerfil');
    var input = document.getElementById('inputFotoPerfil');
    if (boton) boton.addEventListener('click', function () { if (input) input.click(); });
  }

  function init() {
    var u = leerUsuario();
    crearVisor();
    injectarFotoUI();
    aplicarLogo(u.institucion_logo || null);
    aplicarAvatar(u.foto_url || null);

    // Avatar de otras personas en listas (solo ver en grande)
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.tagName === 'IMG' && t.hasAttribute('data-visor')) {
        var src = t.currentSrc || t.src;
        if (src) abrirVisor(src, null);
      }
    });

    var inputLogo = document.getElementById('inputLogoInst');
    if (inputLogo) inputLogo.addEventListener('change', function () {
      if (inputLogo.files && inputLogo.files[0]) subirLogo(inputLogo.files[0]);
      else inputLogo.value = '';
    });

    var inputFoto = document.getElementById('inputFotoPerfil');
    if (inputFoto) inputFoto.addEventListener('change', function () {
      if (inputFoto.files && inputFoto.files[0]) subirFoto(inputFoto.files[0]);
      else inputFoto.value = '';
    });

    // Refresca logo y foto desde el servidor para que los cambios del admin
    // (o de otro dispositivo) se vean sin tener que cerrar sesión.
    fetch(API + '/api/auth/perfil', { headers: { Authorization: 'Bearer ' + token } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) return;
        var actual = leerUsuario();
        actual.foto_url = data.usuario.foto_url || null;
        actual.institucion_logo = data.usuario.institucion_logo || null;
        actual.institucion_nombre = data.usuario.institucion_nombre || actual.institucion_nombre;
        actual.nombres = data.usuario.nombres || actual.nombres;
        actual.apellidos = data.usuario.apellidos || actual.apellidos;
        guardarUsuario(actual);
        aplicarLogo(actual.institucion_logo);
        aplicarAvatar(actual.foto_url);
        var inst = document.getElementById('sidebarInst');
        if (inst && actual.institucion_nombre) inst.textContent = actual.institucion_nombre;
      })
      .catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.SIAIdentidad = {
    pintarInicialAvatar: pintarInicialAvatar,
    aplicarAvatar: aplicarAvatar,
    aplicarLogo: aplicarLogo,
  };
})();