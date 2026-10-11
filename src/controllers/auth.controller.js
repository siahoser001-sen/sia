// ============================================================
//  auth.controller.js — MySQL
//  Diferencia vs PostgreSQL:
//    - pool.query devuelve [rows] → desestructuramos como const [rows]
//    - Parámetros con ? en lugar de $1
// ============================================================

const pool   = require('../config/db');
const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const email  = require('../services/email.service');
const { generarPassword, validarFortalezaPassword } = require('../utils/contrasena.util');
const { revocarJti } = require('../utils/revocacion');

// Bloqueo por intentos fallidos — aplica a todos los roles,
// porque todos viven en la misma tabla `usuarios`.
const MAX_INTENTOS       = 5;   // intentos permitidos antes de bloquear
const BLOQUEO_MINUTOS    = 15;  // minutos que dura el bloqueo

// Los estudiantes se registran solo con documento (sin correo), así
// que el login acepta cualquiera de los dos como identificador:
// correo (si lo tiene) o número de documento. Se mantiene el nombre
// de campo `email` por compatibilidad con el frontend existente,
// pero también se acepta `identificador` de forma explícita.
exports.login = async (req, res) => {
  const identificador = (req.body.identificador ?? req.body.email ?? '').toString().trim();
  const { password } = req.body;

  if (!identificador || !password) {
    return res.status(400).json({ ok: false, mensaje: 'Correo/documento y contraseña obligatorios.' });
  }

  try {
    // MySQL devuelve [rows, fields] — tomamos solo rows.
    // Un UNION ALL con búsquedas indexadas independientes por correo y
    // por documento: con el `OR` original el optimizador no podía usar
    // ambos índices (numero_documento no tenía índice propio) y caía en
    // full scan por cada login. Ahora son dos lookups por índice + PK.
    const [rows] = await pool.query(
      `SELECT u.id, u.nombres, u.apellidos, u.email, u.rol,
              u.password_hash, u.institucion_id, u.activo,
              u.intentos_fallidos, u.bloqueado_hasta, u.token_version,
              u.foto_url,
              i.nombre AS institucion_nombre,
              i.activa AS institucion_activa,
              i.logo_url AS institucion_logo
       FROM (
         (SELECT id FROM usuarios WHERE email = ? LIMIT 1)
         UNION ALL
         (SELECT id FROM usuarios WHERE numero_documento = ? LIMIT 1)
       ) ids
       JOIN usuarios u ON u.id = ids.id
       LEFT JOIN instituciones i ON i.id = u.institucion_id
       LIMIT 1`,
      [identificador.toLowerCase(), identificador]
    );

    const usuario = rows[0];

    // ── Cuenta bloqueada temporalmente ──────────────────────
    if (usuario && usuario.bloqueado_hasta && new Date(usuario.bloqueado_hasta) > new Date()) {
      const minutosRestantes = Math.ceil((new Date(usuario.bloqueado_hasta) - new Date()) / 60000);
      return res.status(423).json({
        ok: false,
        mensaje: `Cuenta bloqueada por demasiados intentos fallidos. Intenta de nuevo en ${minutosRestantes} minuto(s).`,
      });
    }

    // Un estudiante que se unió con código pero aún no definió su
    // contraseña no tiene password_hash todavía: no se puede loguear
    // por esta vía normal (bcrypt.compare fallaría con null).
    if (usuario && !usuario.password_hash) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Todavía no has creado tu contraseña. Vuelve a usar tu código de clase para completar el registro.',
      });
    }

    const credencialesValidas = usuario && await bcrypt.compare(password, usuario.password_hash);

    if (!credencialesValidas) {
      // Solo contamos el intento fallido si el correo existe, para no
      // revelar si un correo está o no registrado.
      if (usuario) {
        const nuevosIntentos = usuario.intentos_fallidos + 1;

        if (nuevosIntentos >= MAX_INTENTOS) {
          await pool.query(
            `UPDATE usuarios
             SET intentos_fallidos = 0,
                 bloqueado_hasta = DATE_ADD(NOW(), INTERVAL ? MINUTE)
             WHERE id = ?`,
            [BLOQUEO_MINUTOS, usuario.id]
          );
          return res.status(423).json({
            ok: false,
            mensaje: `Cuenta bloqueada por demasiados intentos fallidos. Intenta de nuevo en ${BLOQUEO_MINUTOS} minuto(s).`,
          });
        }

        await pool.query(
          `UPDATE usuarios SET intentos_fallidos = ? WHERE id = ?`,
          [nuevosIntentos, usuario.id]
        );
      }
      return res.status(401).json({ ok: false, mensaje: 'Correo o contraseña incorrectos.' });
    }

    if (!usuario.activo) {
      return res.status(403).json({ ok: false, mensaje: 'Cuenta inactiva. Contacta al administrador.' });
    }

    // Institución desactivada por el superadmin: bloquea el ingreso de
    // su personal y sus estudiantes (también aplica al admin).
    if (usuario.institucion_id && usuario.institucion_activa === 0) {
      return res.status(403).json({ ok: false, mensaje: 'Tu institución está desactivada. Contacta al equipo SIA.' });
    }

    // Login correcto: se limpia el contador y cualquier bloqueo previo.
    await pool.query(
      `UPDATE usuarios SET ultimo_acceso = NOW(), intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?`,
      [usuario.id]
    );

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, rol: usuario.rol, institucion_id: usuario.institucion_id,
        jti: randomUUID(), ver: usuario.token_version || 0 },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    return res.json({
      ok: true,
      token,
      usuario: {
        id:                 usuario.id,
        nombres:            usuario.nombres,
        apellidos:          usuario.apellidos,
        email:              usuario.email,
        rol:                usuario.rol,
        institucion_id:     usuario.institucion_id,
        institucion_nombre: usuario.institucion_nombre || null,
        institucion_logo:   usuario.institucion_logo || null,
        foto_url:           usuario.foto_url || null,
      },
    });

  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ── POST /api/auth/logout (usuario autenticado) ───────────────
// Revoca la sesión actual en el servidor: se agrega el `jti` del
// token a la lista negra en memoria. A partir de acá ese token deja
// de servir, aunque no haya expirado (antes solo se borraba del
// frontend y seguía válido hasta JWT_EXPIRES_IN).
exports.logout = async (req, res) => {
  try {
    const header = req.headers['authorization'];
    if (header?.startsWith('Bearer ')) {
      const token = header.split(' ')[1];
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        if (payload.jti) revocarJti(payload.jti, payload.exp);
      } catch {
        // Token ya inválido/expirado: no hay nada que revocar.
      }
    }
    return res.json({ ok: true, mensaje: 'Sesión cerrada.' });
  } catch (err) {
    console.error('logout error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ── POST /api/auth/olvide-password (público) ─────────────────
// Autoservicio: genera un enlace de un solo uso (30 min) si el
// correo existe. La respuesta es igual haya o no cuenta, para no
// revelar qué correos están registrados.
exports.olvidePassword = async (req, res) => {
  const emailRaw = (req.body.email || '').trim().toLowerCase();

  if (!emailRaw || !/^\S+@\S+\.\S+$/.test(emailRaw)) {
    return res.status(400).json({ ok: false, mensaje: 'Escribe un correo válido.' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT id, nombres, apellidos, email FROM usuarios WHERE email = ? LIMIT 1`,
      [emailRaw]
    );

    const respuesta = { ok: true, mensaje: 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.' };

    if (!rows.length) {
      return res.json(respuesta);
    }

    const usr = rows[0];
    const token = jwt.sign(
      { id: usr.id, rol: usr.rol, tipo: 'reset-password' },
      process.env.JWT_RESET_SECRET || process.env.JWT_SECRET,
      { expiresIn: '30m' }
    );

    const base = `${req.protocol}://${req.get('host')}`;
    const link = `${base}/frontend/reestablecer-password.html?token=${token}`;

    email.enviarCorreo(
      email.correoRecuperacionContrasena({
        email: usr.email,
        link,
        nombre: `${usr.nombres} ${usr.apellidos}`,
      })
    );

    return res.json(respuesta);
  } catch (err) {
    console.error('olvidePassword error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ── POST /api/auth/reestablecer-password (público) ───────────
// Aplica una contraseña nueva usando el token del correo (tipo
// 'reset-password' en el JWT). Limpia bloqueos previos.
exports.reestablecerPassword = async (req, res) => {
  const { token, password } = req.body;

  if (!token) {
    return res.status(400).json({ ok: false, mensaje: 'Token no proporcionado.' });
  }
  if (!password) {
    return res.status(400).json({ ok: false, mensaje: 'La contraseña es obligatoria.' });
  }
  const fortaleza = validarFortalezaPassword(password);
  if (!fortaleza.valida) {
    return res.status(400).json({ ok: false, mensaje: fortaleza.mensaje });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_RESET_SECRET || process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ ok: false, mensaje: 'El enlace no es válido o ya expiró. Solicita uno nuevo.' });
  }

  if (payload.tipo !== 'reset-password' || !payload.id) {
    return res.status(401).json({ ok: false, mensaje: 'El enlace no es válido. Solicita uno nuevo.' });
  }

  try {
    const [rows] = await pool.query(`SELECT id FROM usuarios WHERE id = ? LIMIT 1`, [payload.id]);
    if (!rows.length) {
      return res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado.' });
    }

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `UPDATE usuarios SET password_hash = ?, intentos_fallidos = 0, bloqueado_hasta = NULL,
              token_version = token_version + 1
       WHERE id = ?`,
      [hash, payload.id]
    );

    return res.json({ ok: true, mensaje: 'Contraseña restablecida. Ya puedes iniciar sesión.' });
  } catch (err) {
    console.error('reestablecerPassword error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ── POST /api/auth/restablecer (admin, superadmin) ───────────
// El admin/superadmin genera una contraseña nueva para un usuario
// (se envía por correo y además se devuelve por si hay que darla
// en persona). También desbloquea la cuenta.
exports.restablecerPorAdmin = async (req, res) => {
  const { usuario_id } = req.body;

  if (!usuario_id) {
    return res.status(400).json({ ok: false, mensaje: 'usuario_id es obligatorio.' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT id, nombres, apellidos, email, rol, institucion_id, activo
       FROM usuarios WHERE id = ? LIMIT 1`,
      [usuario_id]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado.' });
    }

    const objetivo = rows[0];

    // El admin solo puede resetear cuentas de su institución.
    if (req.usuario.rol === 'admin' && objetivo.institucion_id !== req.usuario.institucion_id) {
      return res.status(403).json({ ok: false, mensaje: 'No puedes restablecer la contraseña de un usuario de otra institución.' });
    }

    const passwordGenerada = generarPassword(10);
    const hash = await bcrypt.hash(passwordGenerada, 10);

    await pool.query(
      `UPDATE usuarios SET password_hash = ?, intentos_fallidos = 0, bloqueado_hasta = NULL,
              token_version = token_version + 1
       WHERE id = ?`,
      [hash, objetivo.id]
    );

    if (objetivo.email) {
      const [inst] = await pool.query(
        `SELECT nombre FROM instituciones WHERE id = ? LIMIT 1`,
        [objetivo.institucion_id]
      );
      email.enviarCorreo(
        email.correoCredencialesGenerico({
          email:  objetivo.email,
          password: passwordGenerada,
          rol:    objetivo.rol,
          nombre_institucion: inst[0]?.nombre || 'tu institución',
        })
      );
    }

    return res.json({
      ok: true,
      mensaje: objetivo.email
        ? 'Contraseña generada y enviada al correo del usuario.'
        : 'Contraseña generada: entrégala al usuario en persona.',
      email: objetivo.email || null,
      // Solo se devuelve en la respuesta HTTP si no hay correo (no queda
      // otra forma de entregarla); con correo se envió y no debe exponerse.
      password_generada: objetivo.email ? undefined : passwordGenerada,
    });
  } catch (err) {
    console.error('restablecerPorAdmin error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ── POST /api/auth/definir-password (usuario autenticado) ──────
// Se usa una sola vez: cuando un estudiante se acaba de unir con
// código de clase todavía no tiene password_hash (queda NULL a
// propósito). Este endpoint solo funciona mientras esa columna
// siga vacía — así no sirve para cambiar una contraseña existente
// (para eso está PUT /api/auth/perfil, que sí pide la actual).
exports.definirPassword = async (req, res) => {
  const { password } = req.body;

  const fortaleza = validarFortalezaPassword(password);
  if (!fortaleza.valida) {
    return res.status(400).json({ ok: false, mensaje: fortaleza.mensaje });
  }

  try {
    const [rows] = await pool.query(
      `SELECT id, password_hash FROM usuarios WHERE id = ? LIMIT 1`,
      [req.usuario.id]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado.' });
    }
    if (rows[0].password_hash) {
      return res.status(409).json({ ok: false, mensaje: 'Ya tienes una contraseña definida. Usa "Cambiar contraseña" en tu perfil.' });
    }

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `UPDATE usuarios SET password_hash = ?, token_version = token_version + 1 WHERE id = ?`,
      [hash, req.usuario.id]
    );

    return res.json({ ok: true, mensaje: 'Contraseña creada. Ya puedes iniciar sesión con ella.' });
  } catch (err) {
    console.error('definirPassword error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ── GET /api/auth/perfil (usuario autenticado) ─────────────────
exports.obtenerPerfil = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.nombres, u.apellidos, u.email, u.rol, u.telefono,
              u.foto_url, u.ultimo_acceso, i.nombre AS institucion_nombre,
              i.logo_url AS institucion_logo
       FROM usuarios u
       LEFT JOIN instituciones i ON i.id = u.institucion_id
       WHERE u.id = ? LIMIT 1`,
      [req.usuario.id]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado.' });
    }
    return res.json({ ok: true, usuario: rows[0] });
  } catch (err) {
    console.error('obtenerPerfil error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ── PUT /api/auth/perfil (usuario autenticado) ──────────────────
exports.actualizarPerfil = async (req, res) => {
  const { nombres, apellidos, email, telefono, password_actual, password_nueva } = req.body;

  if (!nombres || !apellidos || !email) {
    return res.status(400).json({ ok: false, mensaje: 'Nombres, apellidos y correo son obligatorios.' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT id, password_hash FROM usuarios WHERE id = ? LIMIT 1`,
      [req.usuario.id]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado.' });
    }

    // Si el usuario quiere cambiar la contraseña, valida la actual primero
    let nuevoHash = null;
    if (password_nueva) {
      if (!password_actual) {
        return res.status(400).json({ ok: false, mensaje: 'Ingresa tu contraseña actual para cambiarla.' });
      }
      const coincide = await bcrypt.compare(password_actual, rows[0].password_hash);
      if (!coincide) {
        return res.status(401).json({ ok: false, mensaje: 'La contraseña actual no es correcta.' });
      }
      const fortaleza = validarFortalezaPassword(password_nueva);
      if (!fortaleza.valida) {
        return res.status(400).json({ ok: false, mensaje: fortaleza.mensaje });
      }
      nuevoHash = await bcrypt.hash(password_nueva, 10);
    }

    // Verificar que el correo no esté en uso por otro usuario
    const [existe] = await pool.query(
      `SELECT id FROM usuarios WHERE email = ? AND id != ? LIMIT 1`,
      [email.toLowerCase().trim(), req.usuario.id]
    );
    if (existe.length) {
      return res.status(409).json({ ok: false, mensaje: 'Ese correo ya está en uso por otro usuario.' });
    }

    if (nuevoHash) {
      await pool.query(
        `UPDATE usuarios SET nombres=?, apellidos=?, email=?, telefono=?, password_hash=?,
                token_version = token_version + 1
         WHERE id=?`,
        [nombres, apellidos, email.toLowerCase().trim(), telefono || null, nuevoHash, req.usuario.id]
      );
    } else {
      await pool.query(
        `UPDATE usuarios SET nombres=?, apellidos=?, email=?, telefono=? WHERE id=?`,
        [nombres, apellidos, email.toLowerCase().trim(), telefono || null, req.usuario.id]
      );
    }

    return res.json({ ok: true, mensaje: 'Perfil actualizado correctamente.' });
  } catch (err) {
    console.error('actualizarPerfil error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ── POST /api/auth/foto (usuario autenticado) ──────────────────
// Sube la foto de perfil del usuario. multer guardó el archivo en
// storage/perfiles/ (ver upload.middleware.js); aquí se actualiza
// `usuarios.foto_url` y se registran los metadatos en `archivos`.
// La foto queda ligada al usuario y se muestra a quien vea su
// perfil/avatar, sin importar el dispositivo.
exports.subirFoto = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, mensaje: 'No se recibió ninguna imagen.' });
  }

  const rutaRelativa = `/storage/perfiles/${req.file.filename}`;
  const id = randomUUID();

  try {
    await pool.query(
      `UPDATE usuarios SET foto_url = ? WHERE id = ?`,
      [rutaRelativa, req.usuario.id]
    );

    await pool.query(
      `INSERT INTO archivos
        (id, subido_por, tipo, nombre_original, nombre_storage, ruta_storage, mime_type, tamanio_bytes, es_publico)
       VALUES (?, ?, 'foto_perfil', ?, ?, ?, ?, ?, FALSE)`,
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

    return res.json({ ok: true, mensaje: 'Foto de perfil actualizada.', foto_url: rutaRelativa });
  } catch (err) {
    console.error('subirFoto error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};
