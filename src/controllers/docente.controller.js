const pool    = require('../config/db');
const bcrypt  = require('bcrypt');
const email   = require('../services/email.service');
const { crearNotificacion } = require('../services/notificacion.service');

// ============================================================
//  POST /api/docentes/solicitar
//  Público — el docente se registra indicando a qué colegio quiere entrar.
//  NO crea su cuenta todavía. El admin institucional decide.
// ============================================================
exports.solicitarRegistro = async (req, res) => {
  const { institucion_id, nombres, apellidos, tipo_documento,
          numero_documento, email_doc, telefono, password } = req.body;

  if (!institucion_id || !nombres || !apellidos || !email_doc || !password || !numero_documento) {
    return res.status(400).json({ ok: false, mensaje: 'Faltan campos obligatorios.' });
  }

  try {
    // Verificar que la institución existe y está activa
    const { rows: inst } = await pool.query(
      `SELECT id, nombre, email_institucional FROM sia.instituciones WHERE id = $1 AND activa = true`,
      [institucion_id]
    );
    if (!inst.length) {
      return res.status(404).json({ ok: false, mensaje: 'Institución no encontrada.' });
    }

    // Verificar que no exista ya una solicitud pendiente del mismo email en esa institución
    const { rows: existe } = await pool.query(
      `SELECT id FROM sia.solicitudes_docentes
       WHERE institucion_id = $1 AND email = $2 LIMIT 1`,
      [institucion_id, email_doc]
    );
    if (existe.length) {
      return res.status(409).json({ ok: false, mensaje: 'Ya existe una solicitud tuya para esta institución.' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(
      `INSERT INTO sia.solicitudes_docentes
         (institucion_id, nombres, apellidos, tipo_documento, numero_documento, email, telefono, password_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [institucion_id, nombres, apellidos, tipo_documento || 'CC',
       numero_documento, email_doc, telefono, password_hash]
    );

    // Buscar al admin de esa institución para notificarle
    const { rows: admins } = await pool.query(
      `SELECT id, email FROM sia.usuarios
       WHERE institucion_id = $1 AND rol = 'admin' AND activo = true LIMIT 1`,
      [institucion_id]
    );

    if (admins.length) {
      // Correo al admin institucional
      await email.enviarCorreo(
        email.correoNuevaSolicitudDocente({
          admin_email:   admins[0].email,
          docente_nombre: `${nombres} ${apellidos}`,
          docente_email:  email_doc,
        })
      );
      // Notificación interna al admin
      await crearNotificacion({
        destinatario: admins[0].id,
        tipo:         'solicitud_docente',
        titulo:       `Nuevo docente: ${nombres} ${apellidos}`,
        mensaje:      `${nombres} ${apellidos} solicita ser docente en tu institución.`,
        ref_id:       rows[0].id,
        ref_tabla:    'solicitudes_docentes',
      });
    }

    return res.status(201).json({ ok: true, mensaje: 'Solicitud enviada. El administrador del colegio la revisará.' });

  } catch (err) {
    console.error('solicitarRegistro docente error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ============================================================
//  POST /api/docentes/:solicitudId/aprobar
//  Solo admin institucional — crea el usuario docente activo
// ============================================================
exports.aprobarDocente = async (req, res) => {
  const { solicitudId } = req.params;
  const adminId         = req.usuario.id;
  const adminInstId     = req.usuario.institucion_id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM sia.solicitudes_docentes
       WHERE id = $1 AND institucion_id = $2 AND estado = 'pendiente'`,
      [solicitudId, adminInstId]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, mensaje: 'Solicitud no encontrada o ya revisada.' });
    }
    const s = rows[0];

    // Crear el usuario docente activo
    const { rows: userRows } = await client.query(
      `INSERT INTO sia.usuarios
         (institucion_id, rol, nombres, apellidos, tipo_documento, numero_documento, email, password_hash, activo)
       VALUES ($1,'docente',$2,$3,$4,$5,$6,$7,true) RETURNING id`,
      [s.institucion_id, s.nombres, s.apellidos, s.tipo_documento,
       s.numero_documento, s.email, s.password_hash]
    );
    const docente_id = userRows[0].id;

    // Marcar solicitud como aprobada
    await client.query(
      `UPDATE sia.solicitudes_docentes
       SET estado = 'aprobada', revisado_por = $1, revisado_at = NOW()
       WHERE id = $2`,
      [adminId, solicitudId]
    );

    await client.query('COMMIT');

    // Obtener nombre de la institución para el correo
    const { rows: inst } = await pool.query(
      `SELECT nombre FROM sia.instituciones WHERE id = $1`, [adminInstId]
    );

    await email.enviarCorreo(
      email.correoDocenteAprobado({
        docente_email:      s.email,
        docente_nombre:     `${s.nombres} ${s.apellidos}`,
        nombre_institucion: inst[0]?.nombre || 'la institución',
      })
    );
    await crearNotificacion({
      destinatario: docente_id,
      tipo:         'aprobacion',
      titulo:       '¡Tu registro como docente fue aprobado!',
      mensaje:      `Ya puedes iniciar sesión en ${inst[0]?.nombre || 'el SIA'}.`,
      ref_id:       solicitudId,
      ref_tabla:    'solicitudes_docentes',
    });

    return res.json({ ok: true, mensaje: 'Docente aprobado y cuenta creada.' });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('aprobarDocente error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno. Cambios revertidos.' });
  } finally {
    client.release();
  }
};

// ============================================================
//  POST /api/docentes/:solicitudId/rechazar
//  Solo admin institucional
// ============================================================
exports.rechazarDocente = async (req, res) => {
  const { solicitudId } = req.params;
  const { motivo }      = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE sia.solicitudes_docentes
       SET estado = 'rechazada', motivo_rechazo = $1,
           revisado_por = $2, revisado_at = NOW()
       WHERE id = $3 AND institucion_id = $4 AND estado = 'pendiente'
       RETURNING email, nombres, apellidos`,
      [motivo || null, req.usuario.id, solicitudId, req.usuario.institucion_id]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, mensaje: 'Solicitud no encontrada.' });
    }

    await email.enviarCorreo(
      email.correoDocenteRechazado({
        docente_email:  rows[0].email,
        docente_nombre: `${rows[0].nombres} ${rows[0].apellidos}`,
        motivo,
      })
    );

    return res.json({ ok: true, mensaje: 'Solicitud rechazada.' });

  } catch (err) {
    console.error('rechazarDocente error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ============================================================
//  GET /api/docentes/solicitudes
//  Admin institucional — lista sus solicitudes pendientes
// ============================================================
exports.listarSolicitudes = async (req, res) => {
  const { estado = 'pendiente' } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT id, nombres, apellidos, email, numero_documento, estado, created_at
       FROM sia.solicitudes_docentes
       WHERE institucion_id = $1 AND estado = $2
       ORDER BY created_at DESC`,
      [req.usuario.institucion_id, estado]
    );
    return res.json({ ok: true, total: rows.length, solicitudes: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};
