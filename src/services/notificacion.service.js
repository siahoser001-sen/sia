const pool = require('../config/db');
const { randomUUID } = require('crypto');

// Instancia de socket.io (se registra al iniciar sockets; sirve para
// avisar al usuario en vivo cuando llega una notificación nueva).
let io = null;
function setSocketIO(instancia) { io = instancia; }

// Marcador que cualquier notificación puede usar en titulo/mensaje:
// el backend lo reemplaza por el nombre real de la institución
// (del destinatario o el que se pase explícito por contexto).
const MARCADOR_INSTITUCION = '#nombreinstitucion';

// Reemplaza #nombreinstitucion en un texto usando el nombre dado
// (o un fallback genérico si no hay nombre disponible).
function aplicarInstitucion(texto, nombre) {
  if (typeof texto !== 'string' || !texto.includes(MARCADOR_INSTITUCION)) return texto;
  const reemplazo = nombre || 'tu institución';
  return texto.split(MARCADOR_INSTITUCION).join(reemplazo);
}

// Nombre de la institución a la que pertenece un usuario.
async function nombreInstitucionDe(destinatarioId) {
  const [rows] = await pool.query(
    `SELECT i.nombre
     FROM usuarios u
     LEFT JOIN instituciones i ON i.id = u.institucion_id
     WHERE u.id = ?
     LIMIT 1`,
    [destinatarioId]
  );
  return rows[0]?.nombre || null;
}

async function crearNotificacion({ destinatario, tipo, titulo, mensaje, ref_id = null, ref_tabla = null, institucion_nombre = null }) {
  try {
    const nombre = institucion_nombre || (await nombreInstitucionDe(destinatario)) || 'tu institución';
    await pool.query(
      'INSERT INTO notificaciones (id, destinatario, tipo, titulo, mensaje, ref_id, ref_tabla) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [randomUUID(), destinatario, tipo,
       aplicarInstitucion(titulo, nombre),
       aplicarInstitucion(mensaje, nombre),
       ref_id, ref_tabla]
    );
    if (io) io.to(`usuario:${destinatario}`).emit('notificaciones:update');
  } catch (err) {
    console.error('⚠️ Error creando notificación:', err.message);
  }
}

// Inserta la misma notificación para muchos destinatarios en lotes
// (p. ej. un comunicado dirigido a todo un colegio). El texto ya va
// resuelto porque normalmente todos comparten una sola institución.
async function crearNotificacionLote({ destinatarios, tipo, titulo, mensaje, ref_id = null, ref_tabla = null, institucion_nombre = null }) {
  if (!Array.isArray(destinatarios) || !destinatarios.length) return;
  try {
    const nombre        = institucion_nombre || 'tu institución';
    const tituloFinal   = aplicarInstitucion(titulo, nombre);
    const mensajeFinal  = aplicarInstitucion(mensaje, nombre);
    const LOTE = 100;

    for (let i = 0; i < destinatarios.length; i += LOTE) {
      const lote = destinatarios.slice(i, i + LOTE);
      const placeholders = lote.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const params = [];
      for (const dest of lote) {
        params.push(dest, tipo, tituloFinal, mensajeFinal, ref_id, ref_tabla);
      }
      await pool.query(
        `INSERT INTO notificaciones (destinatario, tipo, titulo, mensaje, ref_id, ref_tabla)
         VALUES ${placeholders}`,
        params
      );
    }

    if (io) {
      for (const dest of destinatarios) io.to(`usuario:${dest}`).emit('notificaciones:update');
    }
  } catch (err) {
    console.error('⚠️ Error creando lote de notificaciones:', err.message);
  }
}

module.exports = { crearNotificacion, crearNotificacionLote, setSocketIO };