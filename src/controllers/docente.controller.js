const pool    = require('../config/db');
const bcrypt  = require('bcrypt');
const { randomUUID } = require('crypto');
const email   = require('../services/email.service');
const { generarPassword } = require('../utils/contrasena.util');
const { crearNotificacion } = require('../services/notificacion.service');

// ── POST /api/docentes/agregar (admin) ─────────────────────────
// Crea la cuenta del docente de una vez (sin link de activación):
// el sistema genera la contraseña y se la envía por correo junto
// con el email para que el docente pueda iniciar sesión directo.
exports.agregarDocente = async (req, res) => {
  const { nombres, apellidos, tipo_documento, numero_documento, email: correo, telefono } = req.body;
  const institucionId = req.usuario.institucion_id;

  if (!nombres || !apellidos || !numero_documento || !correo) {
    return res.status(400).json({ ok: false, mensaje: 'Nombres, apellidos, documento y correo son obligatorios.' });
  }
  if (!/^\S+@\S+\.\S+$/.test(correo)) {
    return res.status(400).json({ ok: false, mensaje: 'Escribe un correo válido.' });
  }
  const correoNormalizado = correo.trim().toLowerCase();

  try {
    const [existe] = await pool.query(
      `SELECT id FROM usuarios WHERE (institucion_id = ? AND email = ?) OR (tipo_documento = ? AND numero_documento = ?) LIMIT 1`,
      [institucionId, correoNormalizado, tipo_documento || 'CC', numero_documento]
    );
    if (existe.length) {
      return res.status(409).json({ ok: false, mensaje: 'Ya existe una cuenta con ese correo o documento.' });
    }

    const passwordGenerada = generarPassword(10);
    const password_hash = await bcrypt.hash(passwordGenerada, 10);
    const docenteId = randomUUID();

    await pool.query(
      `INSERT INTO usuarios
         (id, institucion_id, rol, nombres, apellidos, tipo_documento,
          numero_documento, email, telefono, password_hash, activo)
       VALUES (?, ?, 'docente', ?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [docenteId, institucionId, nombres.trim(), apellidos.trim(), tipo_documento || 'CC',
       numero_documento, correoNormalizado, telefono || null, password_hash]
    );

    const [inst] = await pool.query(`SELECT nombre FROM instituciones WHERE id = ?`, [institucionId]);

    await email.enviarCorreo(
      email.correoCredencialesDocente({
        email:              correoNormalizado,
        password:           passwordGenerada,
        nombre_institucion: inst[0]?.nombre || 'tu institución',
      })
    );

    // Aviso interno al docente de su nueva cuenta (punto 6).
    await crearNotificacion({
      destinatario: docenteId,
      tipo:         'solicitud_docente',
      titulo:       'Tu cuenta de docente está lista',
      mensaje:      `Tu cuenta de docente en #nombreinstitucion fue creada por el administrador.`,
      ref_id:       docenteId,
      ref_tabla:    'usuarios',
      institucion_nombre: inst[0]?.nombre || null,
    });

    return res.status(201).json({
      ok: true,
      mensaje: 'Docente creado. Se le envió el correo con su contraseña.',
      id: docenteId,
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, mensaje: 'Ya existe una cuenta con ese correo o documento.' });
    }
    console.error('agregarDocente error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ── GET /api/docentes (admin) ──────────────────────────────────
// Lista los docentes activos de la institución. Se usa, entre
// otras cosas, para el selector de "director de curso".
exports.listarDocentes = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, nombres, apellidos, email, foto_url
       FROM usuarios
       WHERE institucion_id = ? AND rol = 'docente' AND activo = TRUE
       ORDER BY nombres ASC, apellidos ASC`,
      [req.usuario.institucion_id]
    );
    return res.json({ ok: true, total: rows.length, docentes: rows });
  } catch (err) {
    console.error('listarDocentes error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};
