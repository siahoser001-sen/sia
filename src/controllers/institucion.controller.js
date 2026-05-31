const pool    = require('../config/db');
const bcrypt  = require('bcrypt');
const email   = require('../services/email.service');
const { crearNotificacion } = require('../services/notificacion.service');

// ============================================================
//  POST /api/instituciones/solicitar
//  Público — cualquiera puede enviar la solicitud
//  NO crea la institución todavía, solo la solicitud.
// ============================================================
exports.solicitarRegistro = async (req, res) => {
  const { nombre, codigo_dane, email_inst, telefono, municipio, departamento,
          admin_nombre, admin_email, admin_password } = req.body;

  if (!nombre || !codigo_dane || !email_inst || !admin_nombre || !admin_email || !admin_password) {
    return res.status(400).json({ ok: false, mensaje: 'Faltan campos obligatorios.' });
  }

  try {
    // Verificar que no exista ya una solicitud con ese DANE o email
    const { rows: existe } = await pool.query(
      `SELECT id FROM sia.solicitudes_instituciones
       WHERE codigo_dane = $1 OR email = $2 LIMIT 1`,
      [codigo_dane, email_inst]
    );
    if (existe.length) {
      return res.status(409).json({ ok: false, mensaje: 'Ya existe una solicitud con ese código DANE o correo.' });
    }

    const password_hash = await bcrypt.hash(admin_password, 10);

    const { rows } = await pool.query(
      `INSERT INTO sia.solicitudes_instituciones
         (nombre, codigo_dane, email, telefono, municipio, departamento,
          admin_nombre, admin_email, admin_password)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [nombre, codigo_dane, email_inst, telefono, municipio, departamento,
       admin_nombre, admin_email, password_hash]
    );

    // Notificar al superadmin por correo
    await email.enviarCorreo(
      email.correoNuevaSolicitudInstitucion({ nombre, codigo_dane, admin_nombre, admin_email })
    );

    // Notificación interna al superadmin (buscar su ID)
    const { rows: superadmins } = await pool.query(
      `SELECT id FROM sia.usuarios WHERE rol = 'superadmin' LIMIT 1`
    );
    if (superadmins.length) {
      await crearNotificacion({
        destinatario: superadmins[0].id,
        tipo:         'solicitud_institucion',
        titulo:       `Nueva institución: ${nombre}`,
        mensaje:      `${admin_nombre} solicita registrar "${nombre}" (DANE: ${codigo_dane}).`,
        ref_id:       rows[0].id,
        ref_tabla:    'solicitudes_instituciones',
      });
    }

    return res.status(201).json({ ok: true, mensaje: 'Solicitud enviada. El equipo SIA la revisará pronto.' });

  } catch (err) {
    console.error('solicitarRegistro error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ============================================================
//  POST /api/instituciones/:solicitudId/aprobar
//  Solo superadmin — aprueba la solicitud y crea todo de una vez
// ============================================================
exports.aprobarSolicitud = async (req, res) => {
  const { solicitudId } = req.params;
  const superadminId    = req.usuario.id;
  const client          = await pool.connect();   // Transacción para que todo o nada

  try {
    await client.query('BEGIN');

    // Obtener la solicitud
    const { rows } = await client.query(
      `SELECT * FROM sia.solicitudes_instituciones WHERE id = $1 AND estado = 'pendiente'`,
      [solicitudId]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, mensaje: 'Solicitud no encontrada o ya revisada.' });
    }
    const s = rows[0];

    // 1. Crear la institución oficial
    const { rows: instRows } = await client.query(
      `INSERT INTO sia.instituciones (nombre, codigo_dane, email_institucional, telefono, municipio, departamento)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [s.nombre, s.codigo_dane, s.email, s.telefono, s.municipio, s.departamento]
    );
    const institucion_id = instRows[0].id;

    // 2. Crear configuración por defecto
    await client.query(
      `INSERT INTO sia.configuracion (institucion_id) VALUES ($1)`,
      [institucion_id]
    );

    // 3. Crear el admin institucional (el rector que registró)
    const { rows: userRows } = await client.query(
      `INSERT INTO sia.usuarios
         (institucion_id, rol, nombres, apellidos, tipo_documento, numero_documento, email, password_hash, activo)
       VALUES ($1,'admin',$2,'',' CC','000000',$3,$4,true) RETURNING id`,
      [institucion_id, s.admin_nombre, s.admin_email, s.admin_password]
    );
    const admin_id = userRows[0].id;

    // 4. Marcar solicitud como aprobada
    await client.query(
      `UPDATE sia.solicitudes_instituciones
       SET estado = 'aprobada', revisado_por = $1, revisado_at = NOW()
       WHERE id = $2`,
      [superadminId, solicitudId]
    );

    await client.query('COMMIT');

    // Correo al nuevo admin + notificación interna
    await email.enviarCorreo(
      email.correoInstitucionAprobada({
        admin_email:        s.admin_email,
        admin_nombre:       s.admin_nombre,
        nombre_institucion: s.nombre,
      })
    );
    await crearNotificacion({
      destinatario: admin_id,
      tipo:         'aprobacion',
      titulo:       '¡Tu institución fue aprobada!',
      mensaje:      `"${s.nombre}" ya está activa en el SIA. Puedes iniciar sesión.`,
      ref_id:       solicitudId,
      ref_tabla:    'solicitudes_instituciones',
    });

    return res.json({ ok: true, mensaje: 'Institución aprobada y admin creado correctamente.' });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('aprobarSolicitud error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno. Cambios revertidos.' });
  } finally {
    client.release();
  }
};

// ============================================================
//  POST /api/instituciones/:solicitudId/rechazar
//  Solo superadmin
// ============================================================
exports.rechazarSolicitud = async (req, res) => {
  const { solicitudId } = req.params;
  const { motivo }      = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE sia.solicitudes_instituciones
       SET estado = 'rechazada', motivo_rechazo = $1,
           revisado_por = $2, revisado_at = NOW()
       WHERE id = $3 AND estado = 'pendiente' RETURNING admin_email, admin_nombre`,
      [motivo || null, req.usuario.id, solicitudId]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, mensaje: 'Solicitud no encontrada o ya revisada.' });
    }

    return res.json({ ok: true, mensaje: 'Solicitud rechazada.' });

  } catch (err) {
    console.error('rechazarSolicitud error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ============================================================
//  GET /api/instituciones/solicitudes
//  Solo superadmin — lista solicitudes pendientes
// ============================================================
exports.listarSolicitudes = async (req, res) => {
  const { estado = 'pendiente' } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, codigo_dane, email, admin_nombre, admin_email, estado, created_at
       FROM sia.solicitudes_instituciones
       WHERE estado = $1 ORDER BY created_at DESC`,
      [estado]
    );
    return res.json({ ok: true, total: rows.length, solicitudes: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};
