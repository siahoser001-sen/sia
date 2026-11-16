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

  var style = document.createElement('style');
  style.textContent =
    '.sia-sidebar.sidebar{position:fixed;top:0;left:0;bottom:0;width:230px;z-index:100;display:flex;flex-direction:column;gap:0;padding:1.2rem;background:var(--sidebar-bg,rgba(8,14,40,.94));border-right:1px solid var(--glass-border,rgba(255,255,255,.13));color:var(--text-1,#f1f5f9);font-family:var(--font-b,system-ui,sans-serif);overflow-y:auto}' +
    '.sia-sidebar .sidebar-logo{display:flex;align-items:center;gap:.75rem;padding:.5rem;margin-bottom:.6rem}' +
    '.sia-sidebar .sidebar-logo img{width:38px;height:38px;object-fit:contain}' +
    '.sia-sidebar .logo-fallback{width:38px;height:38px;align-items:center;justify-content:center}' +
    '.sia-sidebar .logo-txt{min-width:0}.sia-sidebar .sigla{font-weight:800;font-size:1.05rem}' +
    '.sia-sidebar .rol,.sia-sidebar .sidebar-inst,.sia-sidebar .profile-role{color:var(--text-3,rgba(226,232,240,.48));font-size:.68rem}' +
    '.sia-sidebar .sidebar-inst{padding:0 .6rem .8rem}' +
    '.sia-sidebar .sidebar-nav{flex:1;display:flex;flex-direction:column;gap:2px}' +
    '.sia-sidebar .nav-section{padding:1rem .6rem .4rem;color:var(--text-3,rgba(226,232,240,.48));font-size:.6rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase}' +
    '.sia-sidebar .nav-item{display:flex;align-items:center;gap:.65rem;padding:.65rem .7rem;border:1px solid transparent;border-radius:var(--r-md,14px);color:var(--text-2,rgba(226,232,240,.72));font-size:.78rem;text-decoration:none;transition:background 150ms,color 150ms}' +
    '.sia-sidebar .nav-item:hover{background:var(--glass-bg,rgba(255,255,255,.06));color:var(--text-1,#f1f5f9)}' +
    '.sia-sidebar .nav-item.activo{background:rgba(59,130,246,.22);border-color:rgba(59,130,246,.3);color:var(--blue-light,#93c5fd)}' +
    '.sia-sidebar .nav-icon{width:16px;text-align:center;flex:none}' +
    '.sia-sidebar .sidebar-profile{display:flex;align-items:center;gap:.65rem;padding:.7rem .6rem;border-top:1px solid var(--glass-border,rgba(255,255,255,.13));cursor:pointer}' +
    '.sia-sidebar .avatar-sm{width:34px;height:34px;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:50%;background:rgba(59,130,246,.2);color:var(--blue-light,#93c5fd);font-weight:800}' +
    '.sia-sidebar .avatar-sm img{width:100%;height:100%;object-fit:cover}' +
    '.sia-sidebar .profile-info{min-width:0}.sia-sidebar .profile-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.78rem;font-weight:700}' +
    'body.sia-sidebar-page>main.main{width:min(1120px,calc(100% - 250px));max-width:1120px;margin-left:250px;margin-right:auto}' +
    'html.shell body.sia-sidebar-page>main.main{width:100%;max-width:none;margin:0;padding:1rem}' +
    '@media(max-width:900px){.sia-sidebar.sidebar{display:none}body.sia-sidebar-page>main.main{width:100%;max-width:none;margin:0;padding:1rem}}';
  document.head.appendChild(style);

  function inicializarSidebar() {
    var nombrePagina = window.location.pathname.split('/').pop();
    var params = new URLSearchParams(window.location.search);
    var usuario = {};
    try { usuario = JSON.parse(sessionStorage.getItem('sia_usuario') || '{}'); } catch (e) {}
    var rol = usuario.rol || 'estudiante';
    var contexto = {
      materiaId: params.get('materia') || '',
      cursoId: params.get('curso') || ''
    };

    document.body.classList.add('sia-sidebar-page');
    document.body.insertAdjacentHTML('afterbegin',
      '<aside class="sidebar sia-sidebar">' +
        '<div class="sidebar-logo">' +
          '<img src="static/logo/SIA_LOGO.svg?v=2" id="logoInstImg" alt="SIA" onerror="this.style.display=\'none\';document.getElementById(\'logoFb\').style.display=\'flex\'">' +
          '<div class="logo-fallback" id="logoFb" style="display:none">S</div>' +
          '<input type="file" id="inputLogoInst" accept="image/jpeg,image/png,image/webp" style="display:none">' +
          '<div class="logo-txt"><div class="sigla">SIA</div><div class="rol" id="sidebarRol">—</div></div>' +
        '</div>' +
        '<div class="sidebar-inst" id="sidebarInst">Mi institución</div>' +
        '<nav class="sidebar-nav" id="sidebarNav"></nav>' +
        '<div class="sidebar-profile" id="btnPerfil">' +
          '<div class="avatar-sm" id="sidebarAvatar">A</div>' +
          '<div class="profile-info"><div class="profile-name" id="perfilNombre">—</div><div class="profile-role">Ver perfil</div></div>' +
        '</div>' +
      '</aside>');

    var avatar = document.getElementById('sidebarAvatar');
    var nombre = usuario.nombres || usuario.nombre || 'Usuario';
    avatar.textContent = nombre.charAt(0).toUpperCase();
    document.getElementById('perfilNombre').textContent = nombre;
    document.getElementById('sidebarRol').textContent = usuario.rol || '—';
    if (usuario.institucion_nombre) document.getElementById('sidebarInst').textContent = usuario.institucion_nombre;

    var secciones = {
      estudiante: [
        { icon: '📊', label: 'Dashboard', key: 'dashboard', href: 'dashboard.html', group: 'Principal' },
        { icon: '📖', label: 'Mis materias', key: 'mis-materias', href: 'mis-materias.html', group: 'Principal' },
        { icon: '📂', label: 'Actividades', key: 'actividades', tab: 'actividades', group: 'Académico' },
        { icon: '📊', label: 'Notas', key: 'notas', tab: 'notas', group: 'Académico' },
        { icon: '🧑‍🏫', label: 'Tablero', key: 'tablero', tab: 'tablero', group: 'Académico' },
        { icon: '📅', label: 'Asistencia', key: 'asistencia', tab: 'asistencia', group: 'Académico' },
        { icon: '📢', label: 'Comunicados', key: 'comunicados', href: 'comunicados.html', group: 'General' },
        { icon: '🗓️', label: 'Calendario', key: 'calendario', href: 'calendario.html', group: 'General' }
      ],
      admin: [
        { icon: '📊', label: 'Dashboard', key: 'dashboard', href: 'dashboard.html', group: 'Principal' },
        { icon: '👨‍🏫', label: 'Docentes', key: 'panel-admin', href: 'panel-admin.html', group: 'Principal' },
        { icon: '🎓', label: 'Gestión académica', key: 'academico', href: 'academico.html', group: 'Principal' },
        { icon: '📢', label: 'Comunicados', key: 'comunicados', href: 'comunicados.html', group: 'General' },
        { icon: '📅', label: 'Calendario', key: 'calendario', href: 'calendario.html', group: 'General' }
      ],
      docente: [
        { icon: '📊', label: 'Dashboard', key: 'dashboard', href: 'dashboard.html', group: 'Principal' },
        { icon: '📝', label: 'Mis clases', key: 'mis-clases', href: 'mis-clases.html', group: 'Principal' },
        { icon: '📢', label: 'Comunicados', key: 'comunicados', href: 'comunicados.html', group: 'General' },
        { icon: '📅', label: 'Calendario', key: 'calendario', href: 'calendario.html', group: 'General' }
      ],
      acudiente: [
        { icon: '📊', label: 'Dashboard', key: 'dashboard', href: 'dashboard.html', group: 'Principal' },
        { icon: '👦', label: 'Mi acudido', key: 'reporte-estudiante', href: 'reporte-estudiante.html', group: 'Principal' },
        { icon: '📢', label: 'Comunicados', key: 'comunicados', href: 'comunicados.html', group: 'General' },
        { icon: '📅', label: 'Calendario', key: 'calendario', href: 'calendario.html', group: 'General' }
      ],
      superadmin: [
        { icon: '📊', label: 'Dashboard', key: 'dashboard', href: 'dashboard.html', group: 'Principal' },
        { icon: '🏫', label: 'Instituciones', key: 'panel-superadmin', href: 'panel-superadmin.html', group: 'Principal' }
      ]
    };
    var nav = document.getElementById('sidebarNav');
    var grupoActual = '';

    function urlMateria(tab) {
      var query = new URLSearchParams();
      if (contexto.materiaId) query.set('materia', contexto.materiaId);
      if (contexto.cursoId) query.set('curso', contexto.cursoId);
      query.set('tab', tab);
      return 'materia-estudiante.html?' + query.toString();
    }

    // El curso funciona como una materia más: su tablero propio usa el id
    // del grupo y materia=0. Si hay una materia en contexto se mantiene el
    // atajo a la pestaña de tablero de esa materia.
    function urlTablero() {
      if (contexto.materiaId) return urlMateria('tablero');
      if (contexto.cursoId) {
        return 'pizarron.html?grupo=' + encodeURIComponent(contexto.cursoId) + '&materia=0&modo=ver';
      }
      return 'mis-materias.html';
    }

    function claveActiva(item) {
      if (nombrePagina === 'materia-estudiante.html' && item.tab) {
        return (params.get('tab') || (contexto.materiaId || contexto.cursoId ? 'actividades' : 'asistencia')) === item.tab;
      }
      if (item.key === 'dashboard') return nombrePagina === 'dashboard.html';
      if (item.key === 'mis-materias') return nombrePagina === 'mis-materias.html';
      return nombrePagina === item.key + '.html';
    }

    function renderizar() {
      nav.textContent = '';
      grupoActual = '';
      (secciones[rol] || secciones.estudiante).forEach(function (item) {
        if (grupoActual !== item.group) {
          grupoActual = item.group;
          var titulo = document.createElement('div');
          titulo.className = 'nav-section';
          titulo.textContent = grupoActual;
          nav.appendChild(titulo);
        }
        var enlace = document.createElement('a');
        enlace.className = 'nav-item';
        enlace.href = item.key === 'tablero'
          ? urlTablero()
          : (item.tab ? urlMateria(item.tab) : item.href);
        enlace.dataset.navKey = item.key;
        if (claveActiva(item)) enlace.classList.add('activo');
        var icono = document.createElement('span');
        icono.className = 'nav-icon';
        icono.textContent = item.icon;
        var texto = document.createElement('span');
        texto.textContent = item.label;
        enlace.appendChild(icono);
        enlace.appendChild(texto);
        nav.appendChild(enlace);
      });
    }

    function setContext(nuevo) {
      if (!nuevo) return;
      if (nuevo.materiaId) contexto.materiaId = String(nuevo.materiaId);
      if (nuevo.cursoId) contexto.cursoId = String(nuevo.cursoId);
      renderizar();
    }

    renderizar();
    window.SIA_UI = { setContext: setContext };

    nav.addEventListener('click', function (event) {
      var enlace = event.target.closest('a[data-nav-key]');
      if (enlace && window.top !== window.self) {
        event.preventDefault();
        window.top.location.href = enlace.href;
      }
    });

    if (nombrePagina === 'dashboard.html' && rol === 'estudiante' && !contexto.materiaId && !contexto.cursoId) {
      var token = '';
      try { token = sessionStorage.getItem('sia_token') || ''; } catch (e) {}
      if (token) {
        var headers = { Authorization: 'Bearer ' + token };
        fetch(window.location.origin + '/api/clases/mis-materias-estudiante', { headers: headers })
          .then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
          })
          .then(function (data) {
            if (!data.ok) throw new Error(data.mensaje || 'No se pudieron cargar las materias.');
            var materia = Array.isArray(data.materias) && data.materias.find(function (item) { return item.materia_id; });
            if (materia) {
              setContext({ materiaId: materia.materia_id });
              return;
            }
            return fetch(window.location.origin + '/api/matriculas/mi-curso', { headers: headers })
              .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
              })
              .then(function (curso) {
                if (!curso.ok) throw new Error(curso.mensaje || 'No se pudo cargar el curso.');
                if (curso.matricula && curso.matricula.grupo_id) setContext({ cursoId: curso.matricula.grupo_id });
              });
          })
          .catch(function (error) {
            console.error('Error preparando las rutas académicas de la barra lateral:', error);
          });
      }
    }
  }

  if (document.body) inicializarSidebar();
  else document.addEventListener('DOMContentLoaded', inicializarSidebar, { once: true });
})();
