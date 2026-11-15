// Verificación end-to-end del tiempo real del Reporte del estudiante.
// Se ejecuta contra el servidor de prueba en 127.0.0.1:3100 y la BD real.
require('dotenv').config();
const pool = require('./src/config/db');
const { io } = require('socket.io-client');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3100';
const CLAVE = 'Prueba2026!';
const EST = 'a1c0ffee-0000-4000-8000-000000000270';
const ACU = 'a1c0ffee-0000-4000-8000-000000000272';
const GRUPO = 'a1c0ffee-0000-4000-8000-000000000015';
const MATERIA = 'a1c0ffee-0000-4000-8000-000000000022';
const PERIODO = 'a1c0ffee-0000-4000-8000-000000000018'; // Bimestre 1 (activo)
const PERIODO_ABIERTO_HOY = 'a1c0ffee-0000-4000-8000-000000000021'; // Bimestre 4 (fecha_fin futura)
// El reporte solo cuenta fallas dentro del rango del periodo activo, así
// que la asistencia se registra en una fecha de ese rango (no hoy).
const FECHA_ASISTENCIA = '2026-03-10';
const SELLO = `verif-${Date.now()}`;

let fallos = 0;
function check(nombre, ok, detalle) {
  console.log(`${ok ? 'PASS' : 'FAIL'} · ${nombre}${detalle ? ' — ' + detalle : ''}`);
  if (!ok) fallos++;
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function esperarHasta(fn, timeout = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await fn()) return true;
    await esperar(100);
  }
  return false;
}

async function login(email) {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: CLAVE }),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(`Login ${email}: ${j.mensaje}`);
  return j;
}

async function api(token, method, path, body) {
  const headers = { Authorization: 'Bearer ' + token };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let j;
  try { j = await res.json(); } catch { j = { ok: false, mensaje: 'respuesta no JSON' }; }
  return { status: res.status, ...j };
}

function conectar(token, nombre) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'], reconnection: false });
    const eventos = [];
    s.on('reporte:update', (p) => eventos.push(p));
    s.on('connect', () => resolve({ s, eventos, nombre }));
    s.on('connect_error', (e) => reject(new Error(`socket ${nombre}: ${e.message}`)));
    setTimeout(() => reject(new Error(`timeout socket ${nombre}`)), 8000);
  });
}

(async () => {
  let estSock, acuSock;
  let itemId = null, obsId = null, tareaId = null;
  try {
    const docente = await login('docente1@colegio-prueba.sia');
    const estudiante = await login('estudiante1@colegio-prueba.sia');
    const acudiente = await login('acudiente1@colegio-prueba.sia');
    const admin = await login('rector@colegio-prueba.sia');
    check('login docente/estudiante/acudiente/admin', true,
      `docente=${docente.usuario.id.slice(-4)} est=${estudiante.usuario.id.slice(-4)} acu=${acudiente.usuario.id.slice(-4)} admin=${admin.usuario.id.slice(-4)}`);

    estSock = await conectar(estudiante.token, 'estudiante');
    acuSock = await conectar(acudiente.token, 'acudiente');
    check('sockets conectados (estudiante y acudiente)', true);

    console.log('\n── (a) Docente guarda nota → reporte del estudiante y acudiente ──');
    const item = await api(docente.token, 'POST', '/api/plan-evaluacion', {
      materia_id: MATERIA, periodo_id: PERIODO, grupo_id: GRUPO,
      nombre: `Verificación ${SELLO}`, peso_pct: 20, orden: 1,
    });
    check('crear actividad del plan', item.ok, item.mensaje || JSON.stringify(item));
    if (!item.ok) throw new Error('No se pudo crear el ítem del plan');
    itemId = item.id;

    estSock.eventos.length = 0;
    acuSock.eventos.length = 0;
    const celda = await api(docente.token, 'PUT', '/api/plan-evaluacion/celda', {
      plan_item_id: itemId, estudiante_id: EST, grupo_id: GRUPO, valor: 8.5,
    });
    check('docente guarda celda 8.5', celda.ok, celda.mensaje);

    const evEstNota = await esperarHasta(() => estSock.eventos.some((e) => e.estudiante_id === EST && e.motivo === 'nota'));
    const evAcuNota = await esperarHasta(() => acuSock.eventos.some((e) => e.estudiante_id === EST && e.motivo === 'nota'));
    check('reporte:update al ESTUDIANTE por nota', evEstNota, JSON.stringify(estSock.eventos[0] || null));
    check('reporte:update al ACUDIENTE por nota', evAcuNota, JSON.stringify(acuSock.eventos[0] || null));

    const repEstNota = await api(estudiante.token, 'GET', `/api/reportes/estudiante/${EST}`);
    const repAcuNota = await api(acudiente.token, 'GET', `/api/reportes/estudiante/${EST}`);
    const matEst = (repEstNota.materias || []).find((m) => m.materia_id === MATERIA);
    const matAcu = (repAcuNota.materias || []).find((m) => m.materia_id === MATERIA);
    check('reporte del estudiante refleja la nota (8.5)', matEst && matEst.promedio === 8.5, `promedio=${matEst && matEst.promedio}`);
    check('reporte del acudiente refleja la nota (8.5)', matAcu && matAcu.promedio === 8.5, `promedio=${matAcu && matAcu.promedio}`);

    console.log('\n── (b) Admin agrega observación → estudiante y acudiente ──');
    estSock.eventos.length = 0;
    acuSock.eventos.length = 0;
    const textoObs = `Observación de verificación ${SELLO}`;
    const obs = await api(admin.token, 'POST', `/api/reportes/estudiante/${EST}/observaciones`, {
      tipo: 'academica', observacion: textoObs,
    });
    check('admin crea observación', obs.ok, obs.mensaje);
    if (!obs.ok) throw new Error('No se pudo crear la observación');
    obsId = obs.id;

    const evEstObs = await esperarHasta(() => estSock.eventos.some((e) => e.estudiante_id === EST && e.motivo === 'observacion'));
    const evAcuObs = await esperarHasta(() => acuSock.eventos.some((e) => e.estudiante_id === EST && e.motivo === 'observacion'));
    check('reporte:update al ESTUDIANTE por observación', evEstObs);
    check('reporte:update al ACUDIENTE por observación', evAcuObs);

    const obsEst = await api(estudiante.token, 'GET', `/api/reportes/estudiante/${EST}/observaciones`);
    const obsAcu = await api(acudiente.token, 'GET', `/api/reportes/estudiante/${EST}/observaciones`);
    check('observación visible al estudiante', (obsEst.observaciones || []).some((o) => o.id === obsId && o.observacion === textoObs));
    check('observación visible al acudiente', (obsAcu.observaciones || []).some((o) => o.id === obsId && o.observacion === textoObs));

    const notiEst = await api(estudiante.token, 'GET', '/api/notificaciones');
    const notiAcu = await api(acudiente.token, 'GET', '/api/notificaciones');
    check('notificación interna al estudiante', (notiEst.notificaciones || []).some((n) => n.ref_id === obsId && n.tipo === 'comunicado'));
    check('notificación interna al acudiente', (notiAcu.notificaciones || []).some((n) => n.ref_id === obsId && n.tipo === 'comunicado'));

    // Editar la observación NO debe duplicar la notificación.
    const notiAntes = (await api(estudiante.token, 'GET', '/api/notificaciones')).notificaciones
      .filter((n) => n.ref_id === obsId).length;
    estSock.eventos.length = 0;
    const obsUpd = await api(admin.token, 'PUT', `/api/reportes/estudiante/${EST}/observaciones/${obsId}`, { observacion: textoObs + ' (editada)' });
    check('admin edita observación', obsUpd.ok);
    const evEstObsUpd = await esperarHasta(() => estSock.eventos.some((e) => e.estudiante_id === EST && e.motivo === 'observacion'));
    check('reporte:update al editar observación', evEstObsUpd);
    const notiDespues = (await api(estudiante.token, 'GET', '/api/notificaciones')).notificaciones
      .filter((n) => n.ref_id === obsId).length;
    check('editar observación NO crea otra notificación', notiDespues === notiAntes, `antes=${notiAntes} después=${notiDespues}`);

    console.log('\n── (c) Docente cambia asistencia → los tres reportes ──');
    estSock.eventos.length = 0;
    acuSock.eventos.length = 0;
    const asis = await api(docente.token, 'POST', '/api/asistencia', {
      materia_id: MATERIA, fecha: FECHA_ASISTENCIA, registros: [{ estudiante_id: EST, estado: 'ausente', observacion: 'Prueba tiempo real' }],
    });
    check('docente registra asistencia (ausente)', asis.ok, asis.mensaje);
    const evEstAsis = await esperarHasta(() => estSock.eventos.some((e) => e.estudiante_id === EST && e.motivo === 'asistencia'));
    const evAcuAsis = await esperarHasta(() => acuSock.eventos.some((e) => e.estudiante_id === EST && e.motivo === 'asistencia'));
    check('reporte:update al ESTUDIANTE por asistencia', evEstAsis);
    check('reporte:update al ACUDIENTE por asistencia', evAcuAsis);

    for (const [rol, ses] of [['estudiante', estudiante], ['acudiente', acudiente], ['docente', docente]]) {
      const rep = await api(ses.token, 'GET', `/api/reportes/estudiante/${EST}`);
      const mat = (rep.materias || []).find((m) => m.materia_id === MATERIA);
      check(`reporte del ${rol}: faltas=1 y fallas de la materia=1`,
        rep.asistencia && rep.asistencia.faltas === 1 && mat && mat.fallas === 1,
        `faltas=${rep.asistencia && rep.asistencia.faltas} fallasMateria=${mat && mat.fallas}`);
    }

    // Asistencia diaria (tabla asistencia_dia) — también debe avisar.
    estSock.eventos.length = 0;
    acuSock.eventos.length = 0;
    const asisDia = await api(docente.token, 'PUT', '/api/asistencia-dia', {
      grupo_id: GRUPO, estudiante_id: EST, fecha: FECHA_ASISTENCIA, estado: 'falta',
    });
    check('docente guarda asistencia diaria', asisDia.ok, asisDia.mensaje);
    const evEstDia = await esperarHasta(() => estSock.eventos.some((e) => e.estudiante_id === EST && e.motivo === 'asistencia'));
    const evAcuDia = await esperarHasta(() => acuSock.eventos.some((e) => e.estudiante_id === EST && e.motivo === 'asistencia'));
    check('reporte:update al ESTUDIANTE por asistencia diaria', evEstDia);
    check('reporte:update al ACUDIENTE por asistencia diaria', evAcuDia);

    console.log('\n── Extra: notas.controller (crear/eliminar) y entrega calificada ──');
    estSock.eventos.length = 0;
    const nota = await api(docente.token, 'POST', '/api/notas', {
      estudiante_id: EST, materia_id: MATERIA, periodo_id: PERIODO,
      tipo_nota: 'Verificación', descripcion: SELLO, valor: 9, valor_max: 10, peso_pct: 10,
    });
    check('notas.controller crea nota', nota.ok, nota.mensaje);
    const evEstNota2 = await esperarHasta(() => estSock.eventos.some((e) => e.estudiante_id === EST && e.motivo === 'nota'));
    check('reporte:update al ESTUDIANTE por notas.controller', evEstNota2);
    if (nota.ok) {
      estSock.eventos.length = 0;
      const delNota = await api(docente.token, 'DELETE', `/api/notas/${nota.id}`);
      check('notas.controller elimina nota', delNota.ok);
      const evEstDel = await esperarHasta(() => estSock.eventos.some((e) => e.estudiante_id === EST && e.motivo === 'nota'));
      check('reporte:update al eliminar nota', evEstDel);
    }

    const tarea = await api(docente.token, 'POST', '/api/tareas', {
      materia_id: MATERIA, grupo_id: GRUPO, titulo: `Tarea ${SELLO}`,
      descripcion: 'Prueba tiempo real', fecha_entrega: '2026-12-01', valor_max: 10,
      periodo_id: PERIODO_ABIERTO_HOY,
    });
    check('docente crea tarea', tarea.ok, tarea.mensaje);
    if (tarea.ok) {
      tareaId = tarea.id;
      const entrega = await api(estudiante.token, 'POST', `/api/tareas/${tareaId}/entrega`, { comentario: 'prueba' });
      check('estudiante entrega tarea', entrega.ok, entrega.mensaje);
      estSock.eventos.length = 0;
      acuSock.eventos.length = 0;
      const calif = await api(docente.token, 'PUT', `/api/tareas/${tareaId}/entrega`, {
        estudiante_id: EST, calificacion: 9, feedback_doc: 'Prueba tiempo real',
      });
      check('docente califica entrega', calif.ok, calif.mensaje);
      const evEstCal = await esperarHasta(() => estSock.eventos.some((e) => e.estudiante_id === EST && e.motivo === 'entrega'));
      const evAcuCal = await esperarHasta(() => acuSock.eventos.some((e) => e.estudiante_id === EST && e.motivo === 'entrega'));
      check('reporte:update al ESTUDIANTE por entrega calificada', evEstCal);
      check('reporte:update al ACUDIENTE por entrega calificada', evAcuCal);
    }

  } catch (err) {
    check('ejecución sin excepciones', false, err.message);
  } finally {
    try {
      if (itemId) {
        await pool.query('DELETE FROM notas WHERE plan_item_id = ?', [itemId]);
        await pool.query('DELETE FROM plan_evaluacion_items WHERE id = ?', [itemId]);
      }
      await pool.query('DELETE FROM asistencia WHERE estudiante_id = ? AND materia_id = ? AND fecha = ?', [EST, MATERIA, FECHA_ASISTENCIA]);
      await pool.query('DELETE FROM asistencia_dia WHERE grupo_id = ? AND estudiante_id = ? AND fecha = ?', [GRUPO, EST, FECHA_ASISTENCIA]);
      if (obsId) {
        await pool.query('DELETE FROM notificaciones WHERE ref_id = ?', [obsId]);
        await pool.query('DELETE FROM reporte_observaciones WHERE id = ?', [obsId]);
      }
      if (tareaId) {
        await pool.query('DELETE FROM notificaciones WHERE ref_id = ?', [tareaId]);
        await pool.query('DELETE FROM tareas WHERE id = ?', [tareaId]);
      }
      console.log('\nLimpieza de datos de prueba: OK');
    } catch (err) {
      console.error('Limpieza:', err.message);
    }
    if (estSock) estSock.s.disconnect();
    if (acuSock) acuSock.s.disconnect();
    await pool.end();
    console.log(`\nRESULTADO: ${fallos === 0 ? 'TODO OK' : fallos + ' fallo(s)'}`);
    process.exit(fallos === 0 ? 0 : 1);
  }
})();
