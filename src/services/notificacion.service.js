// ============================================================
//  notificacion.service.js — Notificaciones internas del sistema
//  Crea registros en sia.notificaciones (la campanita del dashboard).
//  Siempre se usa junto al email.service para doble canal.
// ============================================================

const pool = require('../config/db');

async function crearNotificacion({ destinatario, tipo, titulo, mensaje, ref_id = null, ref_tabla = null }) {
  try {
    await pool.query(
      `INSERT INTO sia.notificaciones
         (destinatario, tipo, titulo, mensaje, ref_id, ref_tabla)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [destinatario, tipo, titulo, mensaje, ref_id, ref_tabla]
    );
  } catch (err) {
    console.error('⚠️  Error creando notificación interna:', err.message);
  }
}

module.exports = { crearNotificacion };
