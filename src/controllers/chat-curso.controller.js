// ============================================================
//  chat-curso.controller.js — Chat del curso (ROADMAP Ronda F, F5).
//  Un chat POR CURSO donde solo escriben los docentes asignados
//  (y co-docentes) además del SISTEMA. Estudiantes y acudientes
//  solo leen. Rutas montadas en /api/chat/curso (chat.routes.js).
// ============================================================

const { randomUUID } = require('crypto');
const pool = require('../config/db');
const { chatDeGrupo } = require('../services/chat-curso.service');
const { docentePerteneceAlGrupo } = require('../utils/materias-curso.util');

// Resuelve el acceso de un usuario al chat de un grupo.
// Devuelve { ok, puede_escribir, grupo } o { ok:false, code, mensaje }.
async function _accesoCurso(grupoId, usuario) {
  const [grupos] = await pool.query(
    `SELECT g.id, g.nombre AS grupo_nombre, gr.nombre AS grado_nombre,
            gr.institucion_id, g.director_id
       FROM grupos g
       JOIN grados gr ON gr.id = g.grado_id
      WHERE g.id = ? LIMIT 1`,
    [grupoId]
  );
  if (!grupos.length) return { ok: false, code: 404, mensaje: 'Curso no encontrado.' };
  const grupo = grupos[0];
  const { id: usuarioId, rol } = usuario;

  // Admin/superadmin de la institución: leen y pueden escribir (gestión).
  if (['admin', 'superadmin'].includes(rol)) {
    if (rol === 'admin' && grupo.institucion_id !== usuario.institucion_id) {
      return { ok: false, code: 403, mensaje: 'No tienes acceso a este curso.' };
    }
    return { ok: true, puede_escribir: true, grupo };
  }

  // Docente: escribe si dicta alguna materia en el curso o lo dirige.
  if (rol === 'docente') {
    if (await docentePerteneceAlGrupo(pool, usuarioId, grupoId)) {
      return { ok: true, puede_escribir: true, grupo };
    }
    return { ok: false, code: 403, mensaje: 'Solo los profesores del curso pueden usar este chat.' };
  }

  // Estudiante: lee si tiene matrícula activa en el curso.
  if (rol === 'estudiante') {
    const [mt] = await pool.query(
      `SELECT 1 FROM matriculas
        WHERE estudiante_id = ? AND grupo_id = ? AND estado = 'activa' LIMIT 1`,
      [usuarioId, grupoId]
    );
    if (mt.length) return { ok: true, puede_escribir: false, grupo };
    return { ok: false, code: 403, mensaje: 'No perteneces a este curso.' };
  }

  // Acudiente: lee si su acudido está matriculado en el curso.
  if (rol === 'acudiente') {
    const [ae] = await pool.query(
      `SELECT 1
         FROM acudientes_estudiantes ae
         JOIN matriculas mt ON mt.estudiante_id = ae.estudiante_id
        WHERE ae.acudiente_id = ? AND mt.grupo_id = ? AND mt.estado = 'activa'
        LIMIT 1`,
      [usuarioId, grupoId]
    );
    if (ae.length) return { ok: true, puede_escribir: false, grupo };
    return { ok: false, code: 403, mensaje: 'No tienes acudidos en este curso.' };
  }

  return { ok: false, code: 403, mensaje: 'Rol sin acceso al chat del curso.' };
}

// GET /api/chat/curso/:grupoId — abre el chat del curso con sus mensajes.
exports.abrir = async (req, res) => {
  try {
    const acceso = await _accesoCurso(req.params.grupoId, req.usuario);
    if (!acceso.ok) return res.status(acceso.code).json({ ok: false, mensaje: acceso.mensaje });

    const conn = await pool.getConnection();
    let chat;
    try {
      chat = await chatDeGrupo(conn, req.params.grupoId);
    } finally {
      conn.release();
    }

    const [mensajes] = await pool.query(
      `SELECT m.id, m.origen, m.evento, m.texto, m.datos, m.created_at,
              m.remitente_id,
              CASE WHEN m.remitente_id IS NULL THEN 'Sistema'
                   ELSE CONCAT(COALESCE(u.nombres, ''), ' ', COALESCE(u.apellidos, '')) END AS remitente_nombre
         FROM chat_mensajes m
         LEFT JOIN usuarios u ON u.id = m.remitente_id
        WHERE m.chat_id = ?
        ORDER BY m.created_at ASC
        LIMIT 200`,
      [chat.id]
    );
    // `datos` viene como texto JSON desde MySQL
    for (const m of mensajes) {
      if (typeof m.datos === 'string') {
        try { m.datos = JSON.parse(m.datos); } catch { m.datos = null; }
      }
    }

    return res.json({
      ok: true,
      chat: {
        id: chat.id,
        grupo_id: req.params.grupoId,
        grupo_nombre: `${acceso.grupo.grado_nombre}${acceso.grupo.grupo_nombre}`,
        puede_escribir: acceso.puede_escribir,
      },
      mensajes,
    });
  } catch (err) {
    console.error('chat-curso abrir:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// POST /api/chat/curso/:grupoId/mensajes { texto }
// Solo docentes del curso (y admin de la institución). Estudiantes y
// acudientes reciben 403: en este chat solo leen.
exports.enviar = async (req, res) => {
  const texto = (req.body.texto || '').trim();
  if (!texto) return res.status(400).json({ ok: false, mensaje: 'Escribe un mensaje.' });
  if (texto.length > 2000) return res.status(400).json({ ok: false, mensaje: 'El mensaje es demasiado largo (máx. 2000 caracteres).' });

  try {
    const acceso = await _accesoCurso(req.params.grupoId, req.usuario);
    if (!acceso.ok) return res.status(acceso.code).json({ ok: false, mensaje: acceso.mensaje });
    if (!acceso.puede_escribir) {
      return res.status(403).json({ ok: false, mensaje: 'En este chat solo el profesor puede escribir. Los estudiantes y acudientes solo leen.' });
    }

    const conn = await pool.getConnection();
    let chat;
    try {
      chat = await chatDeGrupo(conn, req.params.grupoId);
    } finally {
      conn.release();
    }

    const id = randomUUID();
    await pool.query(
      `INSERT INTO chat_mensajes (id, chat_id, remitente_id, origen, texto)
       VALUES (?, ?, ?, 'usuario', ?)`,
      [id, chat.id, req.usuario.id, texto]
    );

    const io = req.app.get('io');
    const mensaje = {
      id,
      origen: 'usuario',
      evento: null,
      texto,
      datos: null,
      remitente_id: req.usuario.id,
      remitente_nombre: `${req.usuario.nombres || ''} ${req.usuario.apellidos || ''}`.trim(),
      created_at: new Date().toISOString(),
    };
    if (io) io.to(`curso:${req.params.grupoId}`).emit('chat-curso:mensaje', { grupo_id: req.params.grupoId, mensaje });

    return res.status(201).json({ ok: true, mensaje });
  } catch (err) {
    console.error('chat-curso enviar:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};
