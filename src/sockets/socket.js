// ============================================================
//  sockets/socket.js
//  Tiempo real para: aviso de llamada iniciada/finalizada y
//  sincronización del pizarrón (solo el docente puede dibujar).
// ============================================================

const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const pool = require('../config/db');
const { estaRevocado } = require('../utils/revocacion');
const { setSocketIO } = require('../services/notificacion.service');
const { setIO: setIOChatCurso } = require('../services/chat-curso.service');
const {
  condicionMateriaEnGrupo,
  condicionDocenteEnGrupo,
} = require('../utils/materias-curso.util');

const colasPizarron = new Map();

function initSockets(io) {
  // Da acceso al io al servicio de notificaciones para avisar a cada
  // usuario en vivo cuando le llega una notificación (punto 4).
  setSocketIO(io);
  // Igual para el chat del curso (Ronda F, F5): el sistema publica ahí
  // creación/cierre de actividades, notas y videollamadas.
  setIOChatCurso(io);
  // Autenticación en el handshake: el cliente debe mandar el JWT
  // en socket.handshake.auth.token (mismo token del login). Además
  // del verify, se rechaza si la sesión fue revocada (logout o
  // cambio de contraseña), igual que en authMiddleware.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Token no proporcionado.'));

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return next(new Error('Token inválido o expirado.'));
    }

    if (estaRevocado(payload.jti)) {
      return next(new Error('Sesión revocada.'));
    }

    try {
      const [rows] = await pool.query(`SELECT token_version FROM usuarios WHERE id = ? LIMIT 1`, [payload.id]);
      if (!rows.length || (payload.ver || 0) !== (rows[0].token_version || 0)) {
        return next(new Error('Sesión revocada.'));
      }
    } catch (err) {
      console.error('socket auth error:', err.message);
      return next(new Error('No se pudo validar la sesión.'));
    }

    socket.usuario = payload;
    next();
  });

  io.on('connection', (socket) => {
    const { id: usuarioId, rol } = socket.usuario;

    // Cada usuario se une a su sala personal. Así el backend puede
    // notificarle en vivo (ej. "notificaciones:update") sin recargar.
    socket.join(`usuario:${usuarioId}`);

    // ── Chat del curso (Ronda F, F5): unión automática a la sala
    //    `curso:{grupoId}` de cada curso al que el usuario pertenece
    //    (docentes y directores, estudiantes matriculados, acudientes
    //    y admin de la institución). La autorización fina para ENVIAR
    //    se revalida en el endpoint (nunca se confía en el socket).
    unirseAChatsDeCurso(socket, usuarioId, rol).catch(err =>
      console.error('unirseAChatsDeCurso:', err.message)
    );

    // ── Unirse a la sala de una materia (llamadas + pizarrón) ──
    socket.on('unirse-materia', async ({ docente_materia_id }) => {
      if (!docente_materia_id) return;

      const autorizado = await verificarAcceso(docente_materia_id, usuarioId, rol);
      if (!autorizado) {
        socket.emit('error-autorizacion', { mensaje: 'No tienes acceso a esta materia.' });
        return;
      }

      const contexto = { docente_materia_id, grupo_id: null };
      socket.data.rol = rol;
      socket.data.puedeDibujar = rol === 'docente';
      await unirseAlPizarron(socket, contexto);
    });

    // ── Unirse al pizarrón de un CURSO (H3) ────────────────────
    //  El docente que dirige el salón (o cualquier docente con materias
    //  en él) puede abrir el pizarrón para TODO el curso, sin depender de
    //  una materia concreta. Estudiantes y acudientes entran a mirar.
    socket.on('unirse-grupo', async ({ grupo_id }) => {
      if (!grupo_id) return;

      const acceso = await verificarAccesoGrupo(grupo_id, usuarioId, rol);
      if (!acceso) {
        socket.emit('error-autorizacion', { mensaje: 'No tienes acceso a este curso.' });
        return;
      }

      socket.data.rol = rol;
      socket.data.puedeDibujar = acceso.puedeDibujar;
      await unirseAlPizarron(socket, { docente_materia_id: null, grupo_id });
    });

    // ── Pizarrón: validar permiso y persistir antes de difundir. ──
    socket.on('pizarron:trazo', async (payload, responder) => {
      if (!socket.data.puedeDibujar) {
        return responderSocket(responder, false, 'No tienes permiso para modificar este pizarrón.');
      }
      const contexto = contextoPizarron(socket.data);
      const sala = salaPizarron(socket.data);
      const trazo = normalizarTrazo(payload);
      if (!contexto || !sala || !trazo) {
        return responderSocket(responder, false, 'El trazo no es válido.');
      }

      try {
        await encolarOperacionPizarron(sala, async () => {
          const id = randomUUID();
          await pool.query(
            `INSERT INTO pizarron_trazos
              (id, sesion_clase_id, docente_materia_id, grupo_id, docente_id, datos_trazo)
             VALUES (?, NULL, ?, ?, ?, ?)`,
            [
              id,
              contexto.docente_materia_id,
              contexto.grupo_id,
              usuarioId,
              JSON.stringify(trazo),
            ]
          );
          socket.to(sala).emit('pizarron:trazo', { id, trazo });
          responderSocket(responder, true, null, { id });
        });
      } catch (err) {
        console.error('Guardar trazo de pizarrón:', err.message);
        socket.emit('pizarron:error', { mensaje: 'No se pudo guardar el cambio en el pizarrón.' });
        responderSocket(responder, false, 'No se pudo guardar el cambio.');
      }
    });

    socket.on('pizarron:limpiar', async (_payload, responder) => {
      if (!socket.data.puedeDibujar) {
        return responderSocket(responder, false, 'No tienes permiso para borrar este pizarrón.');
      }
      const contexto = contextoPizarron(socket.data);
      const sala = salaPizarron(socket.data);
      if (!contexto || !sala) {
        return responderSocket(responder, false, 'No hay un pizarrón seleccionado.');
      }

      try {
        await encolarOperacionPizarron(sala, async () => {
          await pool.query(
            `DELETE FROM pizarron_trazos WHERE ${contexto.columna} = ?`,
            [contexto.id]
          );
          socket.to(sala).emit('pizarron:limpiar');
          responderSocket(responder, true);
        });
      } catch (err) {
        console.error('Borrar pizarrón:', err.message);
        socket.emit('pizarron:error', { mensaje: 'No se pudo borrar el pizarrón.' });
        responderSocket(responder, false, 'No se pudo borrar el pizarrón.');
      }
    });

    socket.on('disconnect', () => {
      // No se requiere limpieza manual: socket.io libera las salas solo.
    });
  });
}

// Une el socket a las salas `curso:{grupoId}` que le corresponden según
// su rol (Ronda F, F5). Solo define QUÉ salas escucha; la autorización
// para enviar se valida siempre en el endpoint HTTP.
async function unirseAChatsDeCurso(socket, usuarioId, rol) {
  let rows = [];
  if (rol === 'admin' || rol === 'superadmin') {
    [rows] = await pool.query(
      `SELECT g.id FROM grupos g
        JOIN grados gr ON gr.id = g.grado_id
       WHERE gr.institucion_id = ? AND g.activo = TRUE`,
      [socket.usuario.institucion_id]
    );
  } else if (rol === 'docente') {
    [rows] = await pool.query(
      `SELECT DISTINCT g.id FROM grupos g
        LEFT JOIN docentes_materias dm ON dm.grupo_id = g.id
       WHERE g.activo = TRUE
         AND (g.director_id = ? OR dm.docente_id = ?)`,
      [usuarioId, usuarioId]
    );
  } else if (rol === 'estudiante') {
    [rows] = await pool.query(
      `SELECT grupo_id AS id FROM matriculas
        WHERE estudiante_id = ? AND estado = 'activa'`,
      [usuarioId]
    );
  } else if (rol === 'acudiente') {
    [rows] = await pool.query(
      `SELECT DISTINCT mt.grupo_id AS id
         FROM acudientes_estudiantes ae
         JOIN matriculas mt ON mt.estudiante_id = ae.estudiante_id
        WHERE ae.acudiente_id = ? AND mt.estado = 'activa'`,
      [usuarioId]
    );
  }
  for (const r of rows) socket.join(`curso:${r.id}`);
}

// Sala del pizarrón activa para un socket: puede ser de una materia
// (modo clásico) o de un curso completo (H3).
function salaPizarron(data) {
  if (data.docente_materia_id) return `materia:${data.docente_materia_id}`;
  if (data.grupo_id) return `grupo:${data.grupo_id}`;
  return null;
}

function contextoPizarron(data) {
  if (data.docente_materia_id) {
    return {
      columna: 'docente_materia_id',
      id: data.docente_materia_id,
      docente_materia_id: data.docente_materia_id,
      grupo_id: null,
    };
  }
  if (data.grupo_id) {
    return {
      columna: 'grupo_id',
      id: data.grupo_id,
      docente_materia_id: null,
      grupo_id: data.grupo_id,
    };
  }
  return null;
}

async function unirseAlPizarron(socket, contexto) {
  const sala = salaPizarron(contexto);
  if (!sala) return;

  const salaAnterior = salaPizarron(socket.data);
  if (salaAnterior && salaAnterior !== sala) socket.leave(salaAnterior);
  socket.data.docente_materia_id = contexto.docente_materia_id;
  socket.data.grupo_id = contexto.grupo_id;
  socket.join(sala);

  try {
    const trazos = await encolarOperacionPizarron(sala, async () => {
      const [rows] = await pool.query(
        `SELECT id, orden, datos_trazo
           FROM pizarron_trazos
          WHERE ${contexto.columna} = ?
          ORDER BY orden ASC`,
        [contexto.id]
      );
      return rows;
    });
    socket.emit('pizarron:carga', {
      trazos,
      puede_dibujar: Boolean(socket.data.puedeDibujar),
    });
  } catch (err) {
    console.error('Cargar pizarrón:', err.message);
    socket.emit('pizarron:error', { mensaje: 'No se pudo cargar el pizarrón guardado.' });
  }
}

function encolarOperacionPizarron(sala, operacion) {
  const anterior = colasPizarron.get(sala) || Promise.resolve();
  const siguiente = anterior.catch(() => undefined).then(operacion);
  colasPizarron.set(sala, siguiente);
  siguiente.then(
    () => {
      if (colasPizarron.get(sala) === siguiente) colasPizarron.delete(sala);
    },
    () => {
      if (colasPizarron.get(sala) === siguiente) colasPizarron.delete(sala);
    }
  );
  return siguiente;
}

function responderSocket(responder, ok, mensaje, extra = {}) {
  if (typeof responder === 'function') {
    responder({ ok, ...(mensaje ? { mensaje } : {}), ...extra });
  }
}

function normalizarTrazo(trazo) {
  if (!trazo || typeof trazo !== 'object' || Array.isArray(trazo)) return null;
  if (!/^#[0-9a-f]{6}$/i.test(trazo.color || '')) return null;

  if (trazo.tipo === 'texto') {
    if (typeof trazo.texto !== 'string' || !trazo.texto.trim() || trazo.texto.length > 4000) return null;
    if (
      typeof trazo.x !== 'number' || !Number.isFinite(trazo.x) || Math.abs(trazo.x) > 10000
      || typeof trazo.y !== 'number' || !Number.isFinite(trazo.y) || Math.abs(trazo.y) > 10000
    ) return null;
    return { tipo: 'texto', texto: trazo.texto, x: trazo.x, y: trazo.y, color: trazo.color };
  }

  if (!Array.isArray(trazo.points) || trazo.points.length < 2 || trazo.points.length > 1024) return null;
  const points = trazo.points.map((point) => {
    if (
      !point
      || typeof point.x !== 'number' || !Number.isFinite(point.x) || Math.abs(point.x) > 10000
      || typeof point.y !== 'number' || !Number.isFinite(point.y) || Math.abs(point.y) > 10000
    ) return null;
    return { x: point.x, y: point.y };
  });
  if (points.includes(null)) return null;
  const width = trazo.width;
  if (typeof width !== 'number' || !Number.isFinite(width) || width < 1 || width > 50) return null;
  const herramienta = trazo.herramienta === 'borrador' ? 'borrador' : 'lapiz';
  return { tipo: 'trazo', herramienta, points, color: trazo.color, width };
}

// H3: quién puede entrar al pizarrón de un curso y quién puede dibujar.
//  - admin/superadmin: entran como espectadores.
//  - docente: entra si dirige el curso o si dicta alguna materia en él;
//    en ambos casos puede dibujar.
//  - estudiante/acudiente del curso: entran como espectadores.
// Devuelve null si no tiene acceso.
async function verificarAccesoGrupo(grupoId, usuarioId, rol) {
  try {
    if (rol === 'admin' || rol === 'superadmin') {
      return { puedeVer: true, puedeDibujar: false };
    }

    if (rol === 'docente') {
      const [rows] = await pool.query(
        `SELECT (g.director_id = ?) AS es_director,
                (SELECT COUNT(*) FROM docentes_materias dm
                  WHERE dm.grupo_id = g.id AND dm.docente_id = ?) AS materias
           FROM grupos g
          WHERE g.id = ? AND g.activo = TRUE
          LIMIT 1`,
        [usuarioId, usuarioId, grupoId]
      );
      if (!rows.length) return null;
      // es_director puede venir como 1/0 o true/false según el driver.
      if (!rows[0].es_director && !rows[0].materias) return null;
      return { puedeVer: true, puedeDibujar: true };
    }

    if (rol === 'estudiante') {
      const [rows] = await pool.query(
        `SELECT id FROM matriculas
          WHERE grupo_id = ? AND estudiante_id = ? AND estado = 'activa'
          LIMIT 1`,
        [grupoId, usuarioId]
      );
      return rows.length ? { puedeVer: true, puedeDibujar: false } : null;
    }

    if (rol === 'acudiente') {
      const [rows] = await pool.query(
        `SELECT mt.id
           FROM acudientes_estudiantes ae
           JOIN matriculas mt ON mt.estudiante_id = ae.estudiante_id
          WHERE mt.grupo_id = ? AND ae.acudiente_id = ? AND mt.estado = 'activa'
          LIMIT 1`,
        [grupoId, usuarioId]
      );
      return rows.length ? { puedeVer: true, puedeDibujar: false } : null;
    }

    return null;
  } catch (err) {
    console.error('verificarAccesoGrupo (socket) error:', err.message);
    return null;
  }
}

// Reutiliza la misma regla de negocio que el middleware HTTP
// (docente dueño de la materia, o estudiante matriculado en el grupo).
async function verificarAcceso(docenteMateriaId, usuarioId, rol) {
  try {
    if (rol === 'docente') {
      const [rows] = await pool.query(
        `SELECT id FROM docentes_materias WHERE id = ? AND docente_id = ?`,
        [docenteMateriaId, usuarioId]
      );
      return rows.length > 0;
    }
    if (rol === 'estudiante') {
      const [rows] = await pool.query(
        `SELECT dm.id
         FROM docentes_materias dm
         JOIN materias m ON m.id = dm.materia_id
         JOIN matriculas mt ON mt.estudiante_id = ? AND mt.estado = 'activa'
         WHERE dm.id = ? AND m.activa = TRUE
           AND ${condicionDocenteEnGrupo('dm', 'm', 'mt.grupo_id')}
           AND ${condicionMateriaEnGrupo('m', 'mt.grupo_id')}`,
        [usuarioId, docenteMateriaId]
      );
      return rows.length > 0;
    }
    return rol === 'admin' || rol === 'superadmin';
  } catch (err) {
    console.error('verificarAcceso (socket) error:', err.message);
    return false;
  }
}

module.exports = { initSockets };
