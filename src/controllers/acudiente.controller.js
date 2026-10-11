// ============================================================
//  acudiente.controller.js — MySQL
//  Gestión de acudientes por el administrador: crear la cuenta,
//  vincularla a estudiantes, desvincular y dar de baja.
//  Todo limitado a la institución del admin autenticado.
// ============================================================

const pool   = require('../config/db');
const bcrypt = require('bcrypt');
const { randomUUID } = require('crypto');
const email  = require('../services/email.service');
const { generarPassword } = require('../utils/contrasena.util');

// ── GET /api/acudientes (admin) ──────────────────────────────
// Lista los acudientes de la institución con sus estudiantes
// vinculados (con grupo actual cuando tienen matrícula activa).
exports.listar = async (req, res) => {
  const institucionId = req.usuario.institucion_id;

  try {
    const [acudientes] = await pool.query(
      `SELECT u.id, u.nombres, u.apellidos, u.tipo_documento, u.numero_documento,
              u.email, u.telefono, u.activo, u.ultimo_acceso
       FROM usuarios u
       WHERE u.institucion_id = ? AND u.rol = 'acudiente'
       ORDER BY u.apellidos, u.nombres`,
      [institucionId]
    );

    if (!acudientes.length) {
      return res.json({ ok: true, total: 0, acudientes: [] });
    }

    const ids = acudientes.map(a => a.id);
    const [hijos] = await pool.query(
      `SELECT ae.acudiente_id, ae.parentesco, ae.es_principal,
              u.id AS estudiante_id, u.nombres, u.apellidos, u.numero_documento,
              g.nombre AS grupo, gr.nombre AS grado
       FROM acudientes_estudiantes ae
       JOIN usuarios u ON u.id = ae.estudiante_id
       LEFT JOIN matriculas mt ON mt.estudiante_id = u.id AND mt.estado = 'activa'
       LEFT JOIN grupos g ON g.id = mt.grupo_id
       LEFT JOIN grados gr ON gr.id = g.grado_id
       WHERE ae.acudiente_id IN (${ids.map(() => '?').join(',')})
       ORDER BY u.apellidos, u.nombres`,
      ids
    );

    const porAcudiente = {};
    hijos.forEach(h => {
      (porAcudiente[h.acudiente_id] = porAcudiente[h.acudiente_id] || []).push(h);
    });

    const lista = acudientes.map(a => ({ ...a, hijos: porAcudiente[a.id] || [] }));

    return res.json({ ok: true, total: lista.length, acudientes: lista });
  } catch (err) {
    console.error('listarAcudientes:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── POST /api/acudientes (admin) ─────────────────────────────
// Crea la cuenta del acudiente (contraseña generada, enviada por
// correo si tiene email) y opcionalmente lo vincula a un estudiante.
// body: { nombres, apellidos, tipo_documento, numero_documento,
//         email?, telefono?, estudiante_id?, parentesco? }
exports.agregar = async (req, res) => {
  const { nombres, apellidos, tipo_documento, numero_documento, parentesco } = req.body;
  const { email: correo, telefono, estudiante_id } = req.body;
  const institucionId = req.usuario.institucion_id;

  if (!nombres || !apellidos || !numero_documento) {
    return res.status(400).json({ ok: false, mensaje: 'Nombres, apellidos y documento son obligatorios.' });
  }

  let correoNormalizado = null;
  if (correo) {
    if (!/^\S+@\S+\.\S+$/.test(correo)) {
      return res.status(400).json({ ok: false, mensaje: 'Escribe un correo válido.' });
    }
    correoNormalizado = correo.trim().toLowerCase();
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (estudiante_id) {
      const [est] = await conn.query(
        `SELECT id FROM usuarios WHERE id = ? AND rol = 'estudiante' AND institucion_id = ?`,
        [estudiante_id, institucionId]
      );
      if (!est.length) {
        await conn.rollback();
        return res.status(404).json({ ok: false, mensaje: 'Estudiante no encontrado en tu institución.' });
      }
    }

    const [existe] = await conn.query(
      `SELECT id FROM usuarios
       WHERE (institucion_id = ? AND numero_documento = ?)
          OR (email = ?)
       LIMIT 1`,
      [institucionId, numero_documento, correoNormalizado]
    );
    if (existe.length) {
      await conn.rollback();
      return res.status(409).json({ ok: false, mensaje: 'Ya existe una cuenta con ese documento o correo.' });
    }

    const passwordGenerada = generarPassword(10);
    const password_hash    = await bcrypt.hash(passwordGenerada, 10);
    const id = randomUUID();

    await conn.query(
      `INSERT INTO usuarios
         (id, institucion_id, rol, nombres, apellidos, tipo_documento,
          numero_documento, email, telefono, password_hash, activo)
       VALUES (?, ?, 'acudiente', ?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [id, institucionId, nombres.trim(), apellidos.trim(), tipo_documento || 'CC',
       numero_documento, correoNormalizado, telefono || null, password_hash]
    );

    if (estudiante_id) {
      await conn.query(
        `INSERT INTO acudientes_estudiantes (acudiente_id, estudiante_id, parentesco, es_principal)
         VALUES (?, ?, ?, TRUE)`,
        [id, estudiante_id, parentesco || 'Acudiente']
      );
    }

    await conn.commit();

    if (correoNormalizado) {
      const [inst] = await pool.query(`SELECT nombre FROM instituciones WHERE id = ?`, [institucionId]);
      email.enviarCorreo(
        email.correoCredencialesAcudiente({
          email:              correoNormalizado,
          password:           passwordGenerada,
          nombre_institucion: inst[0]?.nombre || 'tu institución',
        })
      );
    }

    return res.status(201).json({
      ok: true,
      mensaje: estudiante_id ? 'Acudiente creado y vinculado al estudiante.' : 'Acudiente creado.',
      id,
      // Solo se expone la contraseña en la respuesta HTTP cuando el acudiente
      // NO tiene correo (no hay otra forma de entregársela). Con correo, se
      // le envió ahí y no debe quedar en la respuesta.
      password_generada: correoNormalizado ? undefined : passwordGenerada,
    });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, mensaje: 'Ya existe una cuenta con ese documento o correo.' });
    }
    console.error('agregarAcudiente:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    conn.release();
  }
};

// ── POST /api/acudientes/estudiantes (admin) ────────────────
// Vincula un acudiente existente a un estudiante de la institución.
// body: { acudiente_id, estudiante_id, parentesco? }
exports.vincular = async (req, res) => {
  const { acudiente_id, estudiante_id } = req.body;
  const { parentesco } = req.body;
  const institucionId = req.usuario.institucion_id;

  if (!acudiente_id || !estudiante_id) {
    return res.status(400).json({ ok: false, mensaje: 'acudiente_id y estudiante_id son obligatorios.' });
  }

  try {
    const [acu] = await pool.query(
      `SELECT id FROM usuarios WHERE id = ? AND rol = 'acudiente' AND institucion_id = ? LIMIT 1`,
      [acudiente_id, institucionId]
    );
    if (!acu.length) {
      return res.status(404).json({ ok: false, mensaje: 'Acudiente no encontrado en tu institución.' });
    }

    const [est] = await pool.query(
      `SELECT id FROM usuarios WHERE id = ? AND rol = 'estudiante' AND institucion_id = ? LIMIT 1`,
      [estudiante_id, institucionId]
    );
    if (!est.length) {
      return res.status(404).json({ ok: false, mensaje: 'Estudiante no encontrado en tu institución.' });
    }

    await pool.query(
      `INSERT INTO acudientes_estudiantes (acudiente_id, estudiante_id, parentesco, es_principal)
       VALUES (?, ?, ?, TRUE)`,
      [acudiente_id, estudiante_id, parentesco || 'Acudiente']
    );

    return res.json({ ok: true, mensaje: 'Estudiante vinculado al acudiente.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, mensaje: 'Ese estudiante ya está vinculado a este acudiente.' });
    }
    console.error('vincularAcudiente:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── DELETE /api/acudientes/:id/estudiantes/:estudianteId (admin) ──
exports.desvincular = async (req, res) => {
  const { id, estudianteId } = req.params;
  const institucionId = req.usuario.institucion_id;

  try {
    const [acu] = await pool.query(
      `SELECT id FROM usuarios WHERE id = ? AND rol = 'acudiente' AND institucion_id = ? LIMIT 1`,
      [id, institucionId]
    );
    if (!acu.length) {
      return res.status(404).json({ ok: false, mensaje: 'Acudiente no encontrado en tu institución.' });
    }

    await pool.query(
      `DELETE FROM acudientes_estudiantes WHERE acudiente_id = ? AND estudiante_id = ?`,
      [id, estudianteId]
    );

    return res.json({ ok: true, mensaje: 'Estudiante desvinculado del acudiente.' });
  } catch (err) {
    console.error('desvincularAcudiente:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── DELETE /api/acudientes/:id (admin) ──────────────────────
// Da de baja al acudiente: se desvinculan sus estudiantes y se
// desactiva la cuenta (no se borra, para conservar el historial).
exports.eliminar = async (req, res) => {
  const { id } = req.params;
  const institucionId = req.usuario.institucion_id;

  try {
    const [acu] = await pool.query(
      `SELECT id FROM usuarios WHERE id = ? AND rol = 'acudiente' AND institucion_id = ? LIMIT 1`,
      [id, institucionId]
    );
    if (!acu.length) {
      return res.status(404).json({ ok: false, mensaje: 'Acudiente no encontrado en tu institución.' });
    }

    await pool.query(`DELETE FROM acudientes_estudiantes WHERE acudiente_id = ?`, [id]);
    await pool.query(`UPDATE usuarios SET activo = FALSE WHERE id = ?`, [id]);

    return res.json({ ok: true, mensaje: 'Acudiente eliminado (cuenta desactivada).' });
  } catch (err) {
    console.error('eliminarAcudiente:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};