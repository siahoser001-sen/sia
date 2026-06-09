const pool = require('../config/db');
const { randomUUID } = require('crypto');

async function crearNotificacion({ destinatario, tipo, titulo, mensaje, ref_id = null, ref_tabla = null }) {
  try {
    await pool.query(
      'INSERT INTO notificaciones (id, destinatario, tipo, titulo, mensaje, ref_id, ref_tabla) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [randomUUID(), destinatario, tipo, titulo, mensaje, ref_id, ref_tabla]
    );
  } catch (err) {
    console.error('⚠️ Error creando notificación:', err.message);
  }
}

module.exports = { crearNotificacion };
