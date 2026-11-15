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
      `SELECT n.id, n.tipo, n.titulo, n.mensaje, n.leida, n.ref_id, n.ref_tabla, n.created_at,
              COALESCE(n.materia_id, t.materia_id) AS materia_id,
              COALESCE(n.grupo_id, t.grupo_id) AS grupo_id,
              COALESCE(n.actividad_id, t.id,
                CASE WHEN n.ref_tabla IN ('tareas', 'entregas_tareas') THEN n.ref_id END) AS actividad_id,
              CASE WHEN t.docente_id IS NOT NULL AND t.docente_id = g.director_id THEN 1 ELSE 0 END
                AS es_actividad_director
       FROM notificaciones n
       LEFT JOIN tareas t
         ON t.id = COALESCE(n.actividad_id,
           CASE WHEN n.ref_tabla IN ('tareas', 'entregas_tareas') THEN n.ref_id END)
       LEFT JOIN grupos g ON g.id = COALESCE(n.grupo_id, t.grupo_id)
       WHERE n.destinatario = ?
       ORDER BY n.created_at DESC
       LIMIT 20`,
      [req.usuario.id]
    );
    return res.json({ ok: true, total: rows.length, notificaciones: rows });
  } catch (err) {
    console.error('listarNotificaciones error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ── PATCH /api/notificaciones/:id/leida ─────────────────────
exports.marcarLeida = async (req, res) => {
  try {
    const [result] = await pool.query(
      `UPDATE notificaciones SET leida = TRUE
       WHERE id = ? AND destinatario = ?`,
      [req.params.id, req.usuario.id]
    );
    if (!result.affectedRows) {
      const [rows] = await pool.query(
        `SELECT id FROM notificaciones WHERE id = ? AND destinatario = ? LIMIT 1`,
        [req.params.id, req.usuario.id]
      );
      if (!rows.length) {
        return res.status(404).json({ ok: false, mensaje: 'Notificación no encontrada.' });
      }
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('marcarLeida error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};