// ============================================================
//  institucion.controller.js — MySQL
//  Diferencias vs PostgreSQL:
//    - Transacciones: connection.beginTransaction() / commit() / rollback()
//    - UUID: se genera con UUID() en SQL o con crypto.randomUUID() en Node
//    - Parámetros: ? en lugar de $1, $2
//    - pool.query devuelve [rows] → const [rows] = await pool.query(...)
// ============================================================

const pool    = require('../config/db');
const bcrypt  = require('bcrypt');
const { randomUUID } = require('crypto');
const email   = require('../services/email.service');
const { crearNotificacion } = require('../services/notificacion.service');

// ── POST /api/instituciones/solicitar (público) ───────────────
exports.solicitarRegistro = async (req, res) => {
  const { nombre, codigo_dane, email_inst, telefono, municipio, departamento,
          admin_nombre, admin_email, admin_password } = req.body;

  if (!nombre || !codigo_dane || !email_inst || !admin_nombre || !admin_email || !admin_password) {
    return res.status(400).json({ ok: false, mensaje: 'Faltan campos obligatorios.' });
  }

  try {
    const [existe] = await pool.query(
      `SELECT id FROM solicitudes_instituciones
       WHERE codigo_dane = ? OR email = ? LIMIT 1`,
      [codigo_dane, email_inst]
    );
    if (existe.length) {
      return res.status(409).json({ ok: false, mensaje: 'Ya existe una solicitud con ese DANE o correo.' });
    }

    const password_hash = await bcrypt.hash(admin_password, 10);
    const id = randomUUID();

    await pool.query(
      `INSERT INTO solicitudes_instituciones
         (id, nombre, codigo_dane, email, telefono, municipio, departamento,
          admin_nombre, admin_email, admin_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, nombre, codigo_dane, email_inst, telefono, municipio, departamento,
       admin_nombre, admin_email, password_hash]
    );

    await email.enviarCorreo(
      email.correoNuevaSolicitudInstitucion({ nombre, codigo_dane, admin_nombre, admin_email })
    );

    const [superadmins] = await pool.query(
      `SELECT id FROM usuarios WHERE rol = 'superadmin' LIMIT 1`
    );
    if (superadmins.length) {
      await crearNotificacion({
        destinatario: superadmins[0].id,
        tipo:         'solicitud_institucion',
        titulo:       `Nueva institución: ${nombre}`,
        mensaje:      `${admin_nombre} solicita registrar "${nombre}" (DANE: ${codigo_dane}).`,
        ref_id:       id,
        ref_tabla:    'solicitudes_instituciones',
      });
    }

    return res.status(201).json({ ok: true, mensaje: 'Solicitud enviada. El equipo SIA la revisará pronto.' });

  } catch (err) {
    console.error('solicitarRegistro error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ── POST /api/instituciones/:solicitudId/aprobar (superadmin) ─
exports.aprobarSolicitud = async (req, res) => {
  const { solicitudId } = req.params;
  const superadminId    = req.usuario.id;

  // En MySQL las transacciones requieren una conexión dedicada
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT * FROM solicitudes_instituciones
       WHERE id = ? AND estado = 'pendiente'`,
      [solicitudId]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'Solicitud no encontrada o ya revisada.' });
    }
    const s = rows[0];

    // 1. Crear institución
    const instId = randomUUID();
    await conn.query(
      `INSERT INTO instituciones
         (id, nombre, codigo_dane, email_institucional, telefono, municipio, departamento)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [instId, s.nombre, s.codigo_dane, s.email, s.telefono, s.municipio, s.departamento]
    );

    // 2. Crear configuración por defecto
    await conn.query(
      `INSERT INTO configuracion (id, institucion_id) VALUES (?, ?)`,
      [randomUUID(), instId]
    );

    // 3. Crear admin institucional
    const adminId = randomUUID();
    await conn.query(
      `INSERT INTO usuarios
         (id, institucion_id, rol, nombres, apellidos, tipo_documento,
          numero_documento, email, password_hash, activo)
       VALUES (?, ?, 'admin', ?, '', 'CC', '000000', ?, ?, TRUE)`,
      [adminId, instId, s.admin_nombre, s.admin_email, s.admin_password]
    );

    // 4. Marcar solicitud como aprobada
    await conn.query(
      `UPDATE solicitudes_instituciones
       SET estado = 'aprobada', revisado_por = ?, revisado_at = NOW()
       WHERE id = ?`,
      [superadminId, solicitudId]
    );

    await conn.commit();

    await email.enviarCorreo(
      email.correoInstitucionAprobada({
        admin_email:        s.admin_email,
        admin_nombre:       s.admin_nombre,
        nombre_institucion: s.nombre,
      })
    );
    await crearNotificacion({
      destinatario: adminId,
      tipo:         'aprobacion',
      titulo:       '¡Tu institución fue aprobada!',
      mensaje:      `"${s.nombre}" ya está activa en el SIA.`,
      ref_id:       solicitudId,
      ref_tabla:    'solicitudes_instituciones',
    });

    return res.json({ ok: true, mensaje: 'Institución aprobada correctamente.' });

  } catch (err) {
    await conn.rollback();
    console.error('aprobarSolicitud error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno. Cambios revertidos.' });
  } finally {
    conn.release();
  }
};

// ── POST /api/instituciones/:solicitudId/rechazar (superadmin) ─
exports.rechazarSolicitud = async (req, res) => {
  const { solicitudId } = req.params;
  const { motivo }      = req.body;

  try {
    const [result] = await pool.query(
      `UPDATE solicitudes_instituciones
       SET estado = 'rechazada', motivo_rechazo = ?,
           revisado_por = ?, revisado_at = NOW()
       WHERE id = ? AND estado = 'pendiente'`,
      [motivo || null, req.usuario.id, solicitudId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Solicitud no encontrada o ya revisada.' });
    }

    return res.json({ ok: true, mensaje: 'Solicitud rechazada.' });

  } catch (err) {
    console.error('rechazarSolicitud error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── GET /api/instituciones/solicitudes (superadmin) ───────────
exports.listarSolicitudes = async (req, res) => {
  const estado = req.query.estado || 'pendiente';
  try {
    const [rows] = await pool.query(
      `SELECT id, nombre, codigo_dane, email, admin_nombre,
              admin_email, estado, created_at
       FROM solicitudes_instituciones
       WHERE estado = ?
       ORDER BY created_at DESC`,
      [estado]
    );
    return res.json({ ok: true, total: rows.length, solicitudes: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── GET /api/instituciones/buscar (público) ───────────────────
exports.buscarInstituciones = async (req, res) => {
  const q = req.query.q || '';
  try {
    const [rows] = await pool.query(
      `SELECT id, nombre, codigo_dane, municipio
       FROM instituciones
       WHERE activa = TRUE AND nombre LIKE ?
       LIMIT 10`,
      [`%${q}%`]
    );
    return res.json({ ok: true, instituciones: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};
