// ============================================================
//  publicaciones.controller.js — Comunicados (globales y de
//  institución), reutilizando la tabla `comunicados` ya
//  existente. El alcance se define así:
//    - institucion_id NULL      -> global (todo el sistema)
//    - institucion_id + para_rol NULL -> todo el colegio
//    - institucion_id + para_rol X    -> solo ese rol del colegio
//  Puede publicar globales el superadmin Y el admin de cualquier
//  institución (decisión 2026-09-06, punto 3).
//  La imagen (si el comunicado la tiene) se sube antes por
//  separado con POST /api/publicaciones/imagen y se referencia
//  acá por su archivo_id (tabla `archivos`, ya usada también
//  para fondos personalizados y logos).
// ============================================================

const pool = require('../config/db');
const { randomUUID } = require('crypto');
const { crearNotificacionLote } = require('../services/notificacion.service');

const TIPOS_VALIDOS       = ['general', 'informativo', 'urgente', 'evento', 'mantenimiento', 'novedad'];
const ROLES_DESTINO_VALIDOS = ['docente', 'estudiante', 'acudiente'];

const SELECT_BASE = `
  SELECT c.id, c.titulo, c.cuerpo, c.tipo, c.para_rol, c.institucion_id,
         c.created_at, c.autor_id, u.nombres AS autor_nombre,
         a.ruta_storage AS imagen_url,
         i.nombre AS institucion_nombre
  FROM comunicados c
  JOIN usuarios u ON u.id = c.autor_id
  LEFT JOIN archivos a ON a.id = c.archivo_id
  LEFT JOIN instituciones i ON i.id = c.institucion_id
`;

// ── POST /api/publicaciones/imagen (superadmin o admin) ────────
// El archivo ya fue guardado en disco por multer (ver
// upload.middleware.js); acá solo lo registramos en `archivos`
// para poder referenciarlo desde un comunicado por su id.
exports.subirImagen = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, mensaje: 'No se recibió ninguna imagen.' });
  }

  const id = randomUUID();
  const rutaRelativa = `/storage/comunicados/${req.file.filename}`;

  try {
    await pool.query(
      `INSERT INTO archivos
        (id, subido_por, tipo, nombre_original, nombre_storage, ruta_storage, mime_type, tamanio_bytes, es_publico)
       VALUES (?, ?, 'comunicado', ?, ?, ?, ?, ?, TRUE)`,
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

    return res.status(201).json({ ok: true, archivo_id: id, url: rutaRelativa });
  } catch (err) {
    console.error('subirImagen (publicaciones) error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ── POST /api/publicaciones/global (superadmin o admin) ───────
// Publica un comunicado visible para TODAS las instituciones.
exports.publicarGlobal = async (req, res) => {
  const { contenido, tipo, archivo_id } = req.body;
  const autorId = req.usuario.id;

  if (!contenido || !contenido.trim()) {
    return res.status(400).json({ ok: false, mensaje: 'El contenido del comunicado es obligatorio.' });
  }

  const tipoFinal = TIPOS_VALIDOS.includes(tipo) ? tipo : 'general';

  try {
    const id = randomUUID();
    const titulo = contenido.trim().slice(0, 80);

    await pool.query(
      `INSERT INTO comunicados
         (id, autor_id, institucion_id, titulo, cuerpo, tipo, archivo_id, publicado)
       VALUES (?, ?, NULL, ?, ?, ?, ?, TRUE)`,
      [id, autorId, titulo, contenido.trim(), tipoFinal, archivo_id || null]
    );

    // Aviso interno a todos los usuarios activos del sistema (punto 6).
    const [destinatarios] = await pool.query(
      `SELECT id FROM usuarios WHERE activo = TRUE AND id <> ?`,
      [autorId]
    );
    const [aut] = await pool.query(
      `SELECT i.nombre
       FROM usuarios u
       LEFT JOIN instituciones i ON i.id = u.institucion_id
       WHERE u.id = ? LIMIT 1`,
      [autorId]
    );
    await crearNotificacionLote({
      destinatarios: destinatarios.map(r => r.id),
      tipo:          'comunicado',
      titulo:        'Comunicado global SIA',
      mensaje:       `Nuevo comunicado global del SIA publicado por ${aut[0]?.nombre || 'el equipo SIA'}: "${titulo}".`,
      ref_id:        id,
      ref_tabla:     'comunicados',
    });

    // El feed de actividad del superadmin se refresca en vivo (punto 4).
    const io = req.app.get('io');
    if (io) io.emit('actividad:update');

    return res.status(201).json({
      ok: true,
      mensaje: 'Comunicado publicado para todos los usuarios del SIA.',
      publicacion: { id, titulo, cuerpo: contenido.trim(), tipo: tipoFinal },
    });
  } catch (err) {
    console.error('publicarGlobal error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ── POST /api/publicaciones/institucion (admin) ────────────────
// Publica un comunicado para su propio colegio. Si viene "para_rol"
// (docente/estudiante/acudiente), solo ese rol lo ve; si no viene,
// lo ve todo el colegio.
exports.publicarInstitucion = async (req, res) => {
  const { contenido, tipo, para_rol, archivo_id } = req.body;
  const autorId       = req.usuario.id;
  const institucionId = req.usuario.institucion_id;

  if (!institucionId) {
    return res.status(400).json({ ok: false, mensaje: 'Tu cuenta no tiene una institución asociada.' });
  }
  if (!contenido || !contenido.trim()) {
    return res.status(400).json({ ok: false, mensaje: 'El contenido del comunicado es obligatorio.' });
  }

  const tipoFinal    = TIPOS_VALIDOS.includes(tipo) ? tipo : 'general';
  const paraRolFinal = ROLES_DESTINO_VALIDOS.includes(para_rol) ? para_rol : null;

  try {
    const id = randomUUID();
    const titulo = contenido.trim().slice(0, 80);

    await pool.query(
      `INSERT INTO comunicados
         (id, autor_id, institucion_id, titulo, cuerpo, tipo, para_rol, archivo_id, publicado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [id, autorId, institucionId, titulo, contenido.trim(), tipoFinal, paraRolFinal, archivo_id || null]
    );

    // Aviso interno a la institución (o al rol elegido) (punto 6).
    const [instRows] = await pool.query(
      `SELECT nombre FROM instituciones WHERE id = ? LIMIT 1`,
      [institucionId]
    );
    const [destinatarios] = await pool.query(
      `SELECT u.id
       FROM usuarios u
       WHERE u.institucion_id = ?
         AND u.activo = TRUE
         AND u.id <> ?
         AND (? IS NULL OR u.rol = ?)`,
      [institucionId, autorId, paraRolFinal, paraRolFinal]
    );
    await crearNotificacionLote({
      destinatarios: destinatarios.map(r => r.id),
      tipo:          'comunicado',
      titulo:        'Nuevo comunicado',
      mensaje:       `Nuevo comunicado de #nombreinstitucion: "${titulo}".`,
      ref_id:        id,
      ref_tabla:     'comunicados',
      institucion_nombre: instRows[0]?.nombre || null,
    });

    return res.status(201).json({
      ok: true,
      mensaje: 'Comunicado publicado para tu institución.',
      publicacion: { id, titulo, cuerpo: contenido.trim(), tipo: tipoFinal, para_rol: paraRolFinal },
    });
  } catch (err) {
    console.error('publicarInstitucion error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ── GET /api/publicaciones/global (cualquier usuario autenticado) ─
exports.listarGlobales = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `${SELECT_BASE}
       WHERE c.institucion_id IS NULL AND c.publicado = TRUE
       ORDER BY c.created_at DESC
       LIMIT 50`
    );
    return res.json({ ok: true, total: rows.length, publicaciones: rows });
  } catch (err) {
    console.error('listarGlobales error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ── GET /api/publicaciones (cualquier usuario autenticado) ─────
// Devuelve lo que le corresponde ver a CADA rol:
//   - comunicados globales (institucion_id IS NULL)
//   - + los de su propia institución, vigentes (fecha_fin) y si
//     para_rol es NULL o coincide con el rol de quien consulta
exports.listarPublicaciones = async (req, res) => {
  const { rol, institucion_id } = req.usuario;

  try {
    const [rows] = rol === 'superadmin'
      ? await pool.query(
          `${SELECT_BASE}
           WHERE c.publicado = TRUE AND (c.fecha_fin IS NULL OR c.fecha_fin >= CURDATE())
           ORDER BY c.created_at DESC LIMIT 100`
        )
      : await pool.query(
          `${SELECT_BASE}
           WHERE c.publicado = TRUE
             AND (c.fecha_fin IS NULL OR c.fecha_fin >= CURDATE())
             AND (
               c.institucion_id IS NULL
               OR (c.institucion_id = ? AND (c.para_rol IS NULL OR c.para_rol = ?))
             )
           ORDER BY c.created_at DESC
           LIMIT 50`,
          [institucion_id || null, rol]
        );
    return res.json({ ok: true, total: rows.length, publicaciones: rows });
  } catch (err) {
    console.error('listarPublicaciones error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ── DELETE /api/publicaciones/:id (superadmin: cualquiera / admin: solo las de su colegio) ─
exports.eliminar = async (req, res) => {
  const { id } = req.params;
  const { rol, institucion_id } = req.usuario;

  try {
    const [rows] = await pool.query(
      `SELECT id, institucion_id FROM comunicados WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, mensaje: 'La publicación no existe o ya fue eliminada.' });
    }

    const publicacion = rows[0];

    if (rol !== 'superadmin') {
      // Un admin solo puede borrar comunicados de su propia institución
      // o los globales que él mismo publicó (decisión 2026-09-06, punto 3).
      const deSuInstitucion = publicacion.institucion_id !== null && publicacion.institucion_id === institucion_id;
      const esSuAutor       = publicacion.autor_id === req.usuario.id;
      if (!deSuInstitucion && !esSuAutor) {
        return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para eliminar esta publicación.' });
      }
    }

    await pool.query(`DELETE FROM comunicados WHERE id = ?`, [id]);
    return res.json({ ok: true, mensaje: 'Publicación eliminada.' });
  } catch (err) {
    console.error('eliminarPublicacion error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};
