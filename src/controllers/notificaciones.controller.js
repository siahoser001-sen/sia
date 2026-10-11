// ============================================================
//  notificaciones.controller.js — Lectura de notificaciones
//  internas del usuario autenticado (tabla `notificaciones`,
//  en 02_sia_v2.sql). El lado de escritura vive en
//  src/services/notificacion.service.js (crearNotificacion).
// ============================================================

const pool = require('../config/db');

// ── GET /api/notificaciones (cualquier usuario autenticado) ──
exports.listarNotificaciones = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, tipo, titulo, mensaje, leida, ref_id, ref_tabla, created_at
       FROM notificaciones
       WHERE destinatario = ?
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.usuario.id]
    );
    return res.json({ ok: true, total: rows.length, notificaciones: rows });
  } catch (err) {
    console.error('listarNotificaciones error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};