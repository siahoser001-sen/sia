// ============================================================
//  reporte-update.service.js
//  Aviso en vivo del "Reporte del estudiante" (expediente).
//
//  El reporte pinta notas, asistencia, compromisos y observaciones.
//  Cuando alguno de esos datos cambia (lo edite un docente o un
//  admin), se emite `reporte:update` al propio estudiante y a cada
//  acudiente vinculado, para que la página abierta se refresque sin
//  recargar. El payload siempre lleva `estudiante_id` porque un
//  acudiente puede tener varios hijos y solo debe refrescar el que
//  está viendo.
//
//  Ninguna función de aquí lanza: un fallo al avisar por socket
//  nunca debe tumbar la operación que sí quedó guardada en MySQL.
// ============================================================

const pool = require('../config/db');
const { crearNotificacion } = require('./notificacion.service');

// Estudiante + todos sus acudientes (sin repetir).
async function destinatariosReporte(estudianteId) {
  const destinos = new Set();
  if (!estudianteId) return destinos;
  destinos.add(estudianteId);
  try {
    const [rows] = await pool.query(
      `SELECT acudiente_id FROM acudientes_estudiantes WHERE estudiante_id = ?`,
      [estudianteId]
    );
    for (const r of rows) {
      if (r.acudiente_id) destinos.add(r.acudiente_id);
    }
  } catch (err) {
    console.error('destinatariosReporte:', err.message);
  }
  return destinos;
}

// Emite `reporte:update` a la sala de cada destinatario.
// `extra` agrega contexto (motivo, materia_id, ref_id, ...) sin
// reemplazar el `estudiante_id`, que es el campo que filtra el front.
async function notificarReporte(io, estudianteId, extra = {}) {
  if (!io || !estudianteId) return;
  try {
    const destinos = await destinatariosReporte(estudianteId);
    const payload = { estudiante_id: estudianteId, ...extra };
    for (const destino of destinos) {
      io.to(`usuario:${destino}`).emit('reporte:update', payload);
    }
  } catch (err) {
    console.error('notificarReporte:', err.message);
  }
}

// Nuevo compromiso u observación: además del aviso en vivo, deja la
// notificación interna (tabla `notificaciones`) para el estudiante y
// sus acudientes. Solo se llama al CREAR; editar/eliminar solo emite
// `reporte:update`.
//
// Nota: `notificaciones.tipo` es un ENUM cerrado y no tiene tipos
// propios para el expediente, así que se usa 'comunicado' (el título
// y el mensaje distinguen si es observación o compromiso).
const MENSAJES_NUEVO = {
  observacion: {
    titulo: 'Nueva observación en el reporte',
    mensaje: 'Se registró una nueva observación en el reporte del estudiante.',
  },
  compromiso: {
    titulo: 'Nuevo compromiso en el reporte',
    mensaje: 'Se registró un nuevo compromiso en el reporte del estudiante.',
  },
};

async function notificarNuevoRegistroReporte(io, estudianteId, clase, refId, refTabla) {
  if (!estudianteId) return;
  const aviso = MENSAJES_NUEVO[clase];
  if (!aviso) return;

  try {
    const destinos = await destinatariosReporte(estudianteId);
    for (const destino of destinos) {
      await crearNotificacion({
        destinatario: destino,
        tipo:         'comunicado',
        titulo:       aviso.titulo,
        mensaje:      aviso.mensaje,
        ref_id:       refId || null,
        ref_tabla:    refTabla || null,
      });
    }
  } catch (err) {
    console.error('notificarNuevoRegistroReporte:', err.message);
  }

  await notificarReporte(io, estudianteId, { motivo: clase, ref_id: refId || null });
}

module.exports = { notificarReporte, notificarNuevoRegistroReporte, destinatariosReporte };
