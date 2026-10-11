const pool = require('../config/db');
const { randomUUID, randomBytes } = require('crypto');

// ── GET /api/clases/mis-materias (docente) ─────────────────────
// Devuelve las materias que dicta el docente logueado, con su
// docente_materia_id (necesario para iniciar/consultar llamadas).
exports.misMateriasDocente = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT dm.id AS docente_materia_id, dm.grupo_id, m.id AS materia_id, m.nombre AS materia, g.nombre AS grupo,
              gr.nombre AS grado, dm.periodo_id
       FROM docentes_materias dm
       JOIN materias m ON m.id = dm.materia_id
       JOIN grupos   g ON g.id = dm.grupo_id
       JOIN grados   gr ON gr.id = g.grado_id
       WHERE dm.docente_id = ?
       ORDER BY gr.orden, g.nombre, m.nombre`,
      [req.usuario.id]
    );
    return res.json({ ok: true, materias: rows });
  } catch (err) {
    console.error('misMateriasDocente error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── GET /api/clases/mis-materias-estudiante (estudiante) ──────
// Devuelve las materias del estudiante según su matrícula activa
// del grupo actual (cruzando matriculas -> grupos -> docentes_materias).
exports.misMateriasEstudiante = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT dm.id AS docente_materia_id, m.nombre AS materia,
              CONCAT(u.nombres, ' ', u.apellidos) AS docente
       FROM matriculas mt
       JOIN docentes_materias dm ON dm.grupo_id = mt.grupo_id
       JOIN materias m ON m.id = dm.materia_id
       JOIN usuarios u ON u.id = dm.docente_id
       WHERE mt.estudiante_id = ? AND mt.estado = 'activa'
       ORDER BY m.nombre`,
      [req.usuario.id]
    );
    return res.json({ ok: true, materias: rows });
  } catch (err) {
    console.error('misMateriasEstudiante error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── GET /api/clases/:docenteMateriaId/estado-llamada ──────────
// Cualquier rol matriculado/asignado a la materia puede consultarlo.
exports.estadoLlamada = async (req, res) => {
  const { docenteMateriaId } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT id, sala_jitsi, iniciada_at
       FROM sesiones_clase
       WHERE docente_materia_id = ? AND estado = 'activa'
       ORDER BY iniciada_at DESC LIMIT 1`,
      [docenteMateriaId]
    );
    if (!rows.length) {
      return res.json({ ok: true, activa: false });
    }
    return res.json({
      ok: true,
      activa: true,
      sesion_id: rows[0].id,
      sala: rows[0].sala_jitsi,
      url: `https://meet.jit.si/${rows[0].sala_jitsi}`,
      iniciada_at: rows[0].iniciada_at,
    });
  } catch (err) {
    console.error('estadoLlamada error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── POST /api/clases/:docenteMateriaId/iniciar-llamada (docente) ─
exports.iniciarLlamada = async (req, res) => {
  const { docenteMateriaId } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Verificar que la materia sea del docente que hace la petición
    const [dm] = await conn.query(
      `SELECT id FROM docentes_materias WHERE id = ? AND docente_id = ?`,
      [docenteMateriaId, req.usuario.id]
    );
    if (!dm.length) {
      await conn.rollback();
      return res.status(403).json({ ok: false, mensaje: 'Esta materia no te pertenece.' });
    }

    // Evitar doble sesión activa para la misma materia
    const [activas] = await conn.query(
      `SELECT id FROM sesiones_clase WHERE docente_materia_id = ? AND estado = 'activa'`,
      [docenteMateriaId]
    );
    if (activas.length) {
      await conn.rollback();
      return res.status(409).json({ ok: false, mensaje: 'Ya hay una llamada activa para esta materia.' });
    }

    const id = randomUUID();
    const sala = `SIA-${docenteMateriaId}-${randomBytes(3).toString('hex')}`.replace(/[^a-zA-Z0-9-]/g, '-');

    await conn.query(
      `INSERT INTO sesiones_clase (id, docente_materia_id, estado, sala_jitsi, iniciada_por)
       VALUES (?, ?, 'activa', ?, ?)`,
      [id, docenteMateriaId, sala, req.usuario.id]
    );

    await conn.commit();

    // Notificar en vivo a todos los conectados a esta materia
    const io = req.app.get('io');
    if (io) {
      io.to(`materia:${docenteMateriaId}`).emit('llamada-iniciada', {
        docente_materia_id: docenteMateriaId,
        sesion_id: id,
        sala,
        url: `https://meet.jit.si/${sala}`,
      });
    }

    return res.status(201).json({ ok: true, sesion_id: id, sala, url: `https://meet.jit.si/${sala}` });

  } catch (err) {
    await conn.rollback();
    console.error('iniciarLlamada error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    conn.release();
  }
};

// ── POST /api/clases/:docenteMateriaId/finalizar-llamada (docente) ─
exports.finalizarLlamada = async (req, res) => {
  const { docenteMateriaId } = req.params;
  try {
    const [result] = await pool.query(
      `UPDATE sesiones_clase
       SET estado = 'finalizada', finalizada_at = NOW()
       WHERE docente_materia_id = ? AND estado = 'activa' AND iniciada_por = ?`,
      [docenteMateriaId, req.usuario.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, mensaje: 'No hay llamada activa tuya para esta materia.' });
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`materia:${docenteMateriaId}`).emit('llamada-finalizada', {
        docente_materia_id: docenteMateriaId,
      });
    }

    return res.json({ ok: true, mensaje: 'Llamada finalizada.' });

  } catch (err) {
    console.error('finalizarLlamada error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};
