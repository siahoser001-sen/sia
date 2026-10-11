// ============================================================
//  sockets/socket.js
//  Tiempo real para: aviso de llamada iniciada/finalizada y
//  sincronización del pizarrón (solo el docente puede dibujar).
// ============================================================

const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { estaRevocado } = require('../utils/revocacion');
const { setSocketIO } = require('../services/notificacion.service');

function initSockets(io) {
  // Da acceso al io al servicio de notificaciones para avisar a cada
  // usuario en vivo cuando le llega una notificación (punto 4).
  setSocketIO(io);
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

    // ── Unirse a la sala de una materia (llamadas + pizarrón) ──
    socket.on('unirse-materia', async ({ docente_materia_id }) => {
      if (!docente_materia_id) return;

      const autorizado = await verificarAcceso(docente_materia_id, usuarioId, rol);
      if (!autorizado) {
        socket.emit('error-autorizacion', { mensaje: 'No tienes acceso a esta materia.' });
        return;
      }

      socket.data.docente_materia_id = docente_materia_id;
      socket.data.rol = rol;
      socket.join(`materia:${docente_materia_id}`);
    });

    // ── Pizarrón: solo el docente puede emitir trazos ──────────
    socket.on('pizarron:trazo', (payload) => {
      const { docente_materia_id } = socket.data;
      if (!docente_materia_id) return;
      if (socket.data.rol !== 'docente') {
        // Nunca confiar en el frontend: se descarta aquí aunque
        // el botón de dibujar esté oculto en el HTML del estudiante.
        return;
      }
      socket.to(`materia:${docente_materia_id}`).emit('pizarron:trazo', payload);
    });

    socket.on('pizarron:limpiar', () => {
      const { docente_materia_id } = socket.data;
      if (!docente_materia_id || socket.data.rol !== 'docente') return;
      socket.to(`materia:${docente_materia_id}`).emit('pizarron:limpiar');
    });

    socket.on('disconnect', () => {
      // No se requiere limpieza manual: socket.io libera las salas solo.
    });
  });
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
         JOIN matriculas mt ON mt.grupo_id = dm.grupo_id
         WHERE dm.id = ? AND mt.estudiante_id = ? AND mt.estado = 'activa'`,
        [docenteMateriaId, usuarioId]
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
