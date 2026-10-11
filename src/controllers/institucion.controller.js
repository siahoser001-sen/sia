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
const { validarFortalezaPassword } = require('../utils/contrasena.util');

// ── POST /api/instituciones/solicitar (público) ───────────────
exports.solicitarRegistro = async (req, res) => {
  const { nombre, codigo_dane, email_inst, telefono, municipio, departamento,
          admin_nombre, admin_email, admin_password } = req.body;

  if (!nombre || !codigo_dane || !email_inst || !admin_nombre || !admin_email || !admin_password) {
    return res.status(400).json({ ok: false, mensaje: 'Faltan campos obligatorios.' });
  }

  if (nombre.length > 200 || admin_nombre.length > 150 || admin_email.length > 200 || (telefono || '').length > 30 ||
      (municipio || '').length > 100 || (departamento || '').length > 100) {
    return res.status(400).json({ ok: false, mensaje: 'Algunos campos exceden la longitud máxima permitida.' });
  }

  if (!/^\S+@\S+\.\S+$/.test(admin_email) || !/^\S+@\S+\.\S+$/.test(email_inst)) {
    return res.status(400).json({ ok: false, mensaje: 'Escribe correos válidos.' });
  }

  const fortaleza = validarFortalezaPassword(admin_password);
  if (!fortaleza.valida) {
    return res.status(400).json({ ok: false, mensaje: fortaleza.mensaje });
  }

  try {
    // 1) ¿Ya hay un colegio APROBADO con este DANE? → no se admite, debe iniciar sesión.
    const [yaAprobada] = await pool.query(
      `SELECT id FROM instituciones WHERE codigo_dane = ? LIMIT 1`,
      [codigo_dane]
    );
    if (yaAprobada.length) {
      return res.status(409).json({
        ok: false,
        mensaje: 'El colegio con este código DANE ya está registrado. Inicia sesión.',
      });
    }

    // 2) ¿Ya hay una SOLICITUD pendiente/rechazada con este DANE o correo?
    //    (aparte para dar un mensaje distinto al caso anterior — la causa
    //    no es la misma y confundirían al usuario si se mezclan).
    const [existeSolicitud] = await pool.query(
      `SELECT id, estado FROM solicitudes_instituciones
       WHERE codigo_dane = ? OR email = ? LIMIT 1`,
      [codigo_dane, email_inst]
    );
    if (existeSolicitud.length) {
      const mensaje = existeSolicitud[0].estado === 'pendiente'
        ? 'Ya existe una solicitud pendiente de revisión con este código DANE o correo.'
        : 'Ya existe una solicitud registrada con este código DANE o correo.';
      return res.status(409).json({ ok: false, mensaje });
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

    // Aviso interno al superadmin (ya existía)
    await email.enviarCorreo(
      email.correoNuevaSolicitudInstitucion({ nombre, codigo_dane, admin_nombre, admin_email })
    );

    // Confirmación real para quien llenó el formulario — antes la pantalla
    // decía "recibirás respuesta en tu correo" pero nunca se enviaba nada.
    await email.enviarCorreo(
      email.correoSolicitudRecibida({ admin_email, admin_nombre, nombre_institucion: nombre, codigo_dane })
    );

    const [superadmins] = await pool.query(
      `SELECT id FROM usuarios WHERE rol = 'superadmin' LIMIT 1`
    );
    if (superadmins.length) {
      await crearNotificacion({
        destinatario: superadmins[0].id,
        tipo:         'solicitud_institucion',
        titulo:       `Nueva institución: #nombreinstitucion`,
        mensaje:      `${admin_nombre} solicita registrar "#nombreinstitucion" (DANE: ${codigo_dane}).`,
        ref_id:       id,
        ref_tabla:    'solicitudes_instituciones',
        institucion_nombre: nombre,
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
    // NOTA: el formulario de solicitud no captura un número de documento
    // real para el admin institucional, así que se genera un identificador
    // único derivado del UUID del usuario (evita choques con la restricción
    // UNIQUE (tipo_documento, numero_documento) cuando se aprueba más de
    // una institución). Si el número real se llega a capturar en el
    // formulario, reemplazar por s.admin_numero_documento.
    const adminId = randomUUID();
    const numeroDocumentoTemporal = adminId.replace(/-/g, '').slice(0, 20);
    await conn.query(
      `INSERT INTO usuarios
         (id, institucion_id, rol, nombres, apellidos, tipo_documento,
          numero_documento, email, password_hash, activo)
       VALUES (?, ?, 'admin', ?, '', 'CC', ?, ?, ?, TRUE)`,
      [adminId, instId, s.admin_nombre, numeroDocumentoTemporal, s.admin_email, s.admin_password]
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
      mensaje:      '#nombreinstitucion ya está activa en el SIA.',
      ref_id:       solicitudId,
      ref_tabla:    'solicitudes_instituciones',
      institucion_nombre: s.nombre,
    });

    // El feed de actividad del superadmin se refresca en vivo (punto 4).
    const io = req.app.get('io');
    if (io) io.emit('actividad:update');

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
    const [rows] = await pool.query(
      `SELECT nombre, admin_nombre, admin_email
       FROM solicitudes_instituciones
       WHERE id = ? AND estado = 'pendiente'`,
      [solicitudId]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, mensaje: 'Solicitud no encontrada o ya revisada.' });
    }
    const s = rows[0];

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

    await email.enviarCorreo(
      email.correoInstitucionRechazada({
        admin_email:        s.admin_email,
        admin_nombre:       s.admin_nombre,
        nombre_institucion: s.nombre,
        motivo:             motivo || null,
      })
    );

    // El feed de actividad del superadmin se refresca en vivo (punto 4).
    const io = req.app.get('io');
    if (io) io.emit('actividad:update');

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
  const q = (req.query.q || '').trim();
  if (q.length > 100) {
    return res.status(400).json({ ok: false, mensaje: 'El término de búsqueda es demasiado largo.' });
  }
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

// ── GET /api/instituciones (superadmin) ────────────────────────
// Lista todas las instituciones del sistema (activas e inactivas)
// con un resumen de uso para el panel del superadministrador.
exports.listarInstituciones = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.id, i.nombre, i.nit, i.codigo_dane, i.direccion,
              i.municipio, i.departamento, i.telefono, i.email_institucional,
              i.activa, i.created_at,
              (SELECT CONCAT(u.nombres, ' ', u.apellidos)
               FROM usuarios u
               WHERE u.institucion_id = i.id AND u.rol = 'admin'
               ORDER BY u.created_at LIMIT 1) AS admin_nombre,
              (SELECT COUNT(*) FROM usuarios u
               WHERE u.institucion_id = i.id AND u.rol = 'docente') AS total_docentes,
              (SELECT COUNT(*) FROM grupos g
               JOIN grados gr ON gr.id = g.grado_id
               WHERE gr.institucion_id = i.id) AS total_grupos,
              (SELECT COUNT(*) FROM matriculas mt
               JOIN grupos g ON g.id = mt.grupo_id
               JOIN grados gr ON gr.id = g.grado_id
               WHERE gr.institucion_id = i.id AND mt.estado = 'activa') AS total_estudiantes
       FROM instituciones i
       ORDER BY i.created_at DESC`
    );
    return res.json({ ok: true, total: rows.length, instituciones: rows });
  } catch (err) {
    console.error('listarInstituciones:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── POST /api/instituciones/logo (admin) ───────────────────────
// Sube el logo de la institución. multer guardó el archivo en
// storage/logos/ (ver upload.middleware.js); aquí se actualiza
// `instituciones.logo_url` y se registran los metadatos en `archivos`.
// El logo se muestra en el sidebar de todos los roles de esa
// institución (admin, docentes, estudiantes, acudientes).
exports.subirLogo = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, mensaje: 'No se recibió ninguna imagen.' });
  }
  if (!req.usuario.institucion_id) {
    return res.status(400).json({ ok: false, mensaje: 'Tu cuenta no pertenece a una institución.' });
  }

  const rutaRelativa = `/storage/logos/${req.file.filename}`;
  const id = randomUUID();

  try {
    await pool.query(
      `UPDATE instituciones SET logo_url = ? WHERE id = ?`,
      [rutaRelativa, req.usuario.institucion_id]
    );

    await pool.query(
      `INSERT INTO archivos
        (id, subido_por, tipo, nombre_original, nombre_storage, ruta_storage, mime_type, tamanio_bytes, es_publico)
       VALUES (?, ?, 'logo_institucion', ?, ?, ?, ?, ?, FALSE)`,
      [
        id,
        req.usuario.id,
        req.file.originalname,
        req.file.filename,
        rutaRelativa,
        req.file.mimetype,
        req.file.size,
      ]
    );

    return res.json({ ok: true, mensaje: 'Logo institucional actualizado.', logo_url: rutaRelativa });
  } catch (err) {
    console.error('subirLogo error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ── PUT /api/instituciones/:id (superadmin) ────────────────────
// Actualiza solo los campos enviados en el body (datos de contacto y DANE).
exports.actualizarInstitucion = async (req, res) => {
  const { id } = req.params;
  const campos = ['nombre','nit','codigo_dane','direccion','municipio','departamento','telefono','email_institucional'];
  const sets    = [];
  const valores = [];

  for (const c of campos) {
    if (req.body[c] !== undefined) {
      sets.push(`${c} = ?`);
      valores.push(typeof req.body[c] === 'string' ? req.body[c].trim() : req.body[c]);
    }
  }
  if (!sets.length) {
    return res.status(400).json({ ok: false, mensaje: 'No hay campos para actualizar.' });
  }
  const longActualizados = valores.map(v => typeof v === 'string' ? v.length : 0);
  if (longActualizados.some(long => long > 200)) {
    return res.status(400).json({ ok: false, mensaje: 'Algunos campos exceden la longitud máxima permitida.' });
  }

  try {
    const [result] = await pool.query(
      `UPDATE instituciones SET ${sets.join(', ')} WHERE id = ?`,
      [...valores, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Institución no encontrada.' });
    }
    return res.json({ ok: true, mensaje: 'Institución actualizada.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, mensaje: 'Ya existe otra institución con ese NIT o código DANE.' });
    }
    console.error('actualizarInstitucion:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── PUT /api/instituciones/:id/activa (superadmin) ─────────────
// Activa o desactiva una institución. Al desactivarla, su personal
// y estudiantes no pueden iniciar sesión (ver auth.controller).
exports.cambiarEstadoInstitucion = async (req, res) => {
  const { id }  = req.params;
  const activa  = !!req.body.activa;

  try {
    const [result] = await pool.query(
      `UPDATE instituciones SET activa = ? WHERE id = ?`,
      [activa, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Institución no encontrada.' });
    }
    return res.json({
      ok: true,
      mensaje: activa
        ? 'Institución reactivada. Su personal y estudiantes vuelven a poder ingresar.'
        : 'Institución desactivada. Su personal y estudiantes ya no podrán iniciar sesión.',
    });
  } catch (err) {
    console.error('cambiarEstadoInstitucion:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};
