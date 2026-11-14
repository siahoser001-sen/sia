// ============================================================
//  acudiente.controller.js — MySQL
//  Gestión de acudientes por el administrador: crear la cuenta,
//  vincularla a estudiantes, desvincular y dar de baja.
//  Todo limitado a la institución del admin autenticado.
// ============================================================

const pool   = require('../config/db');
const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const email  = require('../services/email.service');
const { generarPassword } = require('../utils/contrasena.util');

// Emite el token de sesión igual que matriculas.controller (mismo payload),
// para que el acudiente recién registrado pueda crear su contraseña enseguida.
function _emitirToken(usuario) {
  return jwt.sign(
    { id: usuario.id, email: usuario.email, rol: usuario.rol, institucion_id: usuario.institucion_id,
      jti: randomUUID(), ver: usuario.token_version || 0 },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

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

// ── POST /api/acudientes/registro (público) ─────────────────
// Autoregistro del acudiente atado al código del curso del hijo.
// El código valida que el hijo existe y está matriculado en ese
// curso; luego el acudiente crea su propia contraseña con
// POST /api/auth/definir-password. El código no se revalida después.
// body: { nombres, apellidos, tipo_documento?, numero_documento, email?, parentesco?,
//         hijo: { tipo_documento?, numero_documento, nombres, apellidos }, codigo }
exports.registroPropio = async (req, res) => {
  const { nombres, apellidos, numero_documento, parentesco } = req.body;
  const correo = req.body.email;
  const hijo = req.body.hijo || {};
  const codigo = (req.body.codigo || '').toString().trim().toUpperCase();
  const tipo_documento      = (req.body.tipo_documento || 'CC').toString().trim().toUpperCase();
  const hijo_tipo_documento = (hijo.tipo_documento || 'TI').toString().trim().toUpperCase();

  if (!nombres || !apellidos || !numero_documento) {
    return res.status(400).json({ ok: false, mensaje: 'Completa tus nombres, apellidos y número de documento.' });
  }
  if (!hijo.numero_documento || !hijo.nombres || !hijo.apellidos) {
    return res.status(400).json({ ok: false, mensaje: 'Completa el documento, nombres y apellidos de tu hijo.' });
  }
  if (!codigo) {
    return res.status(400).json({ ok: false, mensaje: 'Ingresa el código del curso de tu hijo.' });
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

    // 1) El código identifica el curso (y de ahí la institución).
    const [grupoRows] = await conn.query(
      `SELECT g.id AS grupo_id, gr.institucion_id
       FROM grupos g
       JOIN grados gr ON gr.id = g.grado_id
       WHERE g.codigo_matricula = ? AND g.codigo_activo = TRUE AND g.activo = TRUE
       LIMIT 1 FOR UPDATE`,
      [codigo]
    );
    if (!grupoRows.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'Ese código no existe o ya no está activo. Pídele uno vigente al director del curso.' });
    }
    const grupo = grupoRows[0];

    // 2) El hijo debe tener cuenta y estar matriculado en ESE curso.
    const [estRows] = await conn.query(
      `SELECT id, nombres, apellidos FROM usuarios
       WHERE rol = 'estudiante' AND institucion_id = ?
         AND tipo_documento = ? AND numero_documento = ?
         AND LOWER(nombres) = LOWER(?) AND LOWER(apellidos) = LOWER(?)
       LIMIT 1`,
      [grupo.institucion_id, hijo_tipo_documento, hijo.numero_documento.toString().trim(),
       hijo.nombres.trim(), hijo.apellidos.trim()]
    );
    if (!estRows.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'No encontramos a ese estudiante. Verifica el documento y los nombres, o pídele que se registre con su propio código de clase.' });
    }
    const estudiante = estRows[0];

    const [matRows] = await conn.query(
      `SELECT id FROM matriculas
       WHERE estudiante_id = ? AND grupo_id = ? AND estado = 'activa' LIMIT 1`,
      [estudiante.id, grupo.grupo_id]
    );
    if (!matRows.length) {
      await conn.rollback();
      return res.status(400).json({ ok: false, mensaje: 'El estudiante no está matriculado en ese curso. Revisa el código.' });
    }

    // 3) ¿Ya existe una cuenta (de cualquier rol) con ese documento/correo?
    const [existe] = await conn.query(
      `SELECT id FROM usuarios
       WHERE (institucion_id = ? AND numero_documento = ?) OR (email = ?)
       LIMIT 1`,
      [grupo.institucion_id, numero_documento.toString().trim(), correoNormalizado]
    );
    if (existe.length) {
      await conn.rollback();
      return res.status(409).json({ ok: false, mensaje: 'Ya existe una cuenta con ese documento o correo. Inicia sesión.' });
    }

    // 4) ¿Ese documento ya está vinculado como acudiente del mismo estudiante?
    const [yaVinculo] = await conn.query(
      `SELECT ae.acudiente_id FROM acudientes_estudiantes ae
       JOIN usuarios u ON u.id = ae.acudiente_id
       WHERE ae.estudiante_id = ? AND u.numero_documento = ? LIMIT 1`,
      [estudiante.id, numero_documento.toString().trim()]
    );
    if (yaVinculo.length) {
      await conn.rollback();
      return res.status(409).json({ ok: false, mensaje: 'Ese documento ya está vinculado a este estudiante.' });
    }

    // 5) Crear la cuenta (sin contraseña: la define enseguida).
    const acudienteId = randomUUID();
    await conn.query(
      `INSERT INTO usuarios
         (id, institucion_id, rol, nombres, apellidos, tipo_documento,
          numero_documento, email, activo)
       VALUES (?, ?, 'acudiente', ?, ?, ?, ?, ?, TRUE)`,
      [acudienteId, grupo.institucion_id, nombres.trim(), apellidos.trim(),
       tipo_documento, numero_documento.toString().trim(), correoNormalizado]
    );

    await conn.query(
      `INSERT INTO acudientes_estudiantes (acudiente_id, estudiante_id, parentesco, es_principal, codigo_confirmado)
       VALUES (?, ?, ?, TRUE, ?)`,
      [acudienteId, estudiante.id, (parentesco || 'Acudiente').toString().trim(), codigo]
    );

    await conn.commit();

    const [rows] = await pool.query(
      `SELECT u.id, u.nombres, u.apellidos, u.email, u.rol, u.institucion_id, u.token_version,
              i.nombre AS institucion_nombre
       FROM usuarios u LEFT JOIN instituciones i ON i.id = u.institucion_id
       WHERE u.id = ?`,
      [acudienteId]
    );
    const usuario = rows[0];
    const token = _emitirToken(usuario);

    return res.status(201).json({
      ok: true,
      mensaje: 'Vinculación confirmada. Ahora crea tu contraseña.',
      token,
      usuario: {
        id: usuario.id, nombres: usuario.nombres, apellidos: usuario.apellidos,
        email: usuario.email, rol: usuario.rol,
        institucion_id: usuario.institucion_id,
        institucion_nombre: usuario.institucion_nombre || null,
        hijo: `${estudiante.nombres} ${estudiante.apellidos}`,
      },
    });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, mensaje: 'Ya existe una cuenta con ese documento o correo.' });
    }
    console.error('registroPropio:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    conn.release();
  }
};