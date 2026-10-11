// ============================================================
//  sistema.controller.js — Configuración general de la
//  plataforma (nombre visible, logo). Tabla singleton.
// ============================================================

const pool = require('../config/db');
const { randomUUID } = require('crypto');

// ── GET /api/sistema/configuracion (usuario autenticado) ──────
exports.obtenerConfig = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT nombre_plataforma, logo_url, updated_at FROM configuracion_sistema LIMIT 1`
    );
    if (!rows.length) {
      return res.json({ ok: true, configuracion: { nombre_plataforma: 'SIA', logo_url: null } });
    }
    return res.json({ ok: true, configuracion: rows[0] });
  } catch (err) {
    console.error('obtenerConfig error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ── PUT /api/sistema/configuracion (superadmin) ────────────────
exports.actualizarConfig = async (req, res) => {
  const { nombre_plataforma, logo_url } = req.body;

  if (!nombre_plataforma || !nombre_plataforma.trim()) {
    return res.status(400).json({ ok: false, mensaje: 'El nombre de la plataforma es obligatorio.' });
  }

  try {
    const [existente] = await pool.query(`SELECT id FROM configuracion_sistema LIMIT 1`);

    if (existente.length) {
      await pool.query(
        `UPDATE configuracion_sistema SET nombre_plataforma=?, logo_url=?, actualizado_por=? WHERE id=?`,
        [nombre_plataforma.trim(), logo_url || null, req.usuario.id, existente[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO configuracion_sistema (nombre_plataforma, logo_url, actualizado_por)
         VALUES (?, ?, ?)`,
        [nombre_plataforma.trim(), logo_url || null, req.usuario.id]
      );
    }

    return res.json({ ok: true, mensaje: 'Configuración del sistema actualizada.' });
  } catch (err) {
    console.error('actualizarConfig error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ── POST /api/sistema/fondos (usuario autenticado) ─────────────
// Sube un fondo de pantalla personalizado. El archivo ya fue
// guardado en disco por multer (ver upload.middleware.js);
// aquí solo registramos sus metadatos en la tabla `archivos`.
exports.subirFondo = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, mensaje: 'No se recibió ninguna imagen.' });
  }

  const rutaRelativa = `/storage/fondos/${req.file.filename}`;
  const id = randomUUID();

  try {
    await pool.query(
      `INSERT INTO archivos
        (id, subido_por, tipo, nombre_original, nombre_storage, ruta_storage, mime_type, tamanio_bytes, es_publico)
       VALUES (?, ?, 'fondo_personalizado', ?, ?, ?, ?, ?, FALSE)`,
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

    return res.status(201).json({ ok: true, fondo: { id, src: rutaRelativa } });
  } catch (err) {
    console.error('subirFondo error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ── GET /api/sistema/fondos (usuario autenticado) ──────────────
// Lista los fondos personalizados que el usuario ha subido,
// para que aparezcan en su galería sin importar desde qué
// dispositivo entre.
exports.misFondos = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, ruta_storage AS src, nombre_original AS nombre, created_at
       FROM archivos
       WHERE subido_por = ? AND tipo = 'fondo_personalizado'
       ORDER BY created_at DESC`,
      [req.usuario.id]
    );
    return res.json({ ok: true, fondos: rows });
  } catch (err) {
    console.error('misFondos error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};
