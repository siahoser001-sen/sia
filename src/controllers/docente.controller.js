const pool    = require('../config/db');
const bcrypt  = require('bcrypt');
const { randomUUID } = require('crypto');
const email   = require('../services/email.service');
const { crearNotificacion } = require('../services/notificacion.service');

// ── POST /api/docentes/solicitar (público) ────────────────────
exports.solicitarRegistro = async (req, res) => {
  const { institucion_id, nombres, apellidos, tipo_documento,
          numero_documento, email_doc, telefono, password } = req.body;

  if (!institucion_id || !nombres || !apellidos || !email_doc || !password || !numero_documento) {
    return res.status(400).json({ ok: false, mensaje: 'Faltan campos obligatorios.' });
  }

  try {
    const [inst] = await pool.query(
      `SELECT id, nombre, email_institucional FROM instituciones
       WHERE id = ? AND activa = TRUE`,
      [institucion_id]
    );
    if (!inst.length) {
      return res.status(404).json({ ok: false, mensaje: 'Institución no encontrada.' });
    }

    const [existe] = await pool.query(
      `SELECT id FROM solicitudes_docentes
       WHERE institucion_id = ? AND email = ? LIMIT 1`,
      [institucion_id, email_doc]
    );
    if (existe.length) {
      return res.status(409).json({ ok: false, mensaje: 'Ya existe una solicitud tuya para esta institución.' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const id = randomUUID();

    await pool.query(
      `INSERT INTO solicitudes_docentes
         (id, institucion_id, nombres, apellidos, tipo_documento,
          numero_documento, email, telefono, password_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, institucion_id, nombres, apellidos, tipo_documento || 'CC',
       numero_documento, email_doc, telefono, password_hash]
    );

    const [admins] = await pool.query(
      `SELECT id, email FROM usuarios
       WHERE institucion_id = ? AND rol = 'admin' AND activo = TRUE LIMIT 1`,
      [institucion_id]
    );

    if (admins.length) {
      await email.enviarCorreo(
        email.correoNuevaSolicitudDocente({
          admin_email:    admins[0].email,
          docente_nombre: `${nombres} ${apellidos}`,
          docente_email:  email_doc,
        })
      );
      await crearNotificacion({
        destinatario: admins[0].id,
        tipo:         'solicitud_docente',
        titulo:       `Nuevo docente: ${nombres} ${apellidos}`,
        mensaje:      `${nombres} ${apellidos} solicita ser docente en tu institución.`,
        ref_id:       id,
        ref_tabla:    'solicitudes_docentes',
      });
    }

    return res.status(201).json({ ok: true, mensaje: 'Solicitud enviada. El administrador la revisará.' });

  } catch (err) {
    console.error('solicitarRegistro docente error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── POST /api/docentes/:solicitudId/aprobar (admin) ───────────
exports.aprobarDocente = async (req, res) => {
  const { solicitudId } = req.params;
  const adminId         = req.usuario.id;
  const adminInstId     = req.usuario.institucion_id;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT * FROM solicitudes_docentes
       WHERE id = ? AND institucion_id = ? AND estado = 'pendiente'`,
      [solicitudId, adminInstId]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'Solicitud no encontrada o ya revisada.' });
    }
    const s = rows[0];
    const docenteId = randomUUID();

    await conn.query(
      `INSERT INTO usuarios
         (id, institucion_id, rol, nombres, apellidos, tipo_documento,
          numero_documento, email, password_hash, activo)
       VALUES (?, ?, 'docente', ?, ?, ?, ?, ?, ?, TRUE)`,
      [docenteId, s.institucion_id, s.nombres, s.apellidos,
       s.tipo_documento, s.numero_documento, s.email, s.password_hash]
    );

    await conn.query(
      `UPDATE solicitudes_docentes
       SET estado = 'aprobada', revisado_por = ?, revisado_at = NOW()
       WHERE id = ?`,
      [adminId, solicitudId]
    );

    await conn.commit();

    const [inst] = await pool.query(
      `SELECT nombre FROM instituciones WHERE id = ?`, [adminInstId]
    );

    await email.enviarCorreo(
      email.correoDocenteAprobado({
        docente_email:      s.email,
        docente_nombre:     `${s.nombres} ${s.apellidos}`,
        nombre_institucion: inst[0]?.nombre || 'la institución',
      })
    );
    await crearNotificacion({
      destinatario: docenteId,
      tipo:         'aprobacion',
      titulo:       '¡Tu registro como docente fue aprobado!',
      mensaje:      `Ya puedes iniciar sesión en ${inst[0]?.nombre || 'el SIA'}.`,
      ref_id:       solicitudId,
      ref_tabla:    'solicitudes_docentes',
    });

    return res.json({ ok: true, mensaje: 'Docente aprobado y cuenta creada.' });

  } catch (err) {
    await conn.rollback();
    console.error('aprobarDocente error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno. Cambios revertidos.' });
  } finally {
    conn.release();
  }
};

// ── POST /api/docentes/:solicitudId/rechazar (admin) ──────────
exports.rechazarDocente = async (req, res) => {
  const { solicitudId } = req.params;
  const { motivo }      = req.body;

  try {
    const [result] = await pool.query(
      `UPDATE solicitudes_docentes
       SET estado = 'rechazada', motivo_rechazo = ?,
           revisado_por = ?, revisado_at = NOW()
       WHERE id = ? AND institucion_id = ? AND estado = 'pendiente'`,
      [motivo || null, req.usuario.id, solicitudId, req.usuario.institucion_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Solicitud no encontrada.' });
    }

    return res.json({ ok: true, mensaje: 'Solicitud rechazada.' });

  } catch (err) {
    console.error('rechazarDocente error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── GET /api/docentes/solicitudes (admin) ─────────────────────
exports.listarSolicitudes = async (req, res) => {
  const estado = req.query.estado || 'pendiente';
  try {
    const [rows] = await pool.query(
      `SELECT id, nombres, apellidos, email, numero_documento, estado, created_at
       FROM solicitudes_docentes
       WHERE institucion_id = ? AND estado = ?
       ORDER BY created_at DESC`,
      [req.usuario.institucion_id, estado]
    );
    return res.json({ ok: true, total: rows.length, solicitudes: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};
