// ============================================================
//  calendario.controller.js — MySQL
//  Eventos de calendario (sección 7 del ROADMAP): un evento
//  puede ser de todo el colegio (grupo_id NULL) o de un curso
//  puntual (grupo_id). El cierre de periodo es un evento manual
//  más (tipo='cierre_periodo'), el admin lo crea aparte — no se
//  deriva automáticamente de periodos_academicos.fecha_fin.
//
//  Permisos (confirmados por el usuario 2026-08-19):
//    - Crear/editar/eliminar: admin/superadmin (cualquier evento
//      de su institución, general o de cualquier curso) o el
//      docente director del curso puntual (solo eventos con
//      grupo_id = el grupo que dirige — mismo patrón de
//      "director de curso" que resumen.controller.js, verificado
//      contra grupos.director_id).
//    - Ver: cualquier usuario autenticado ve los eventos generales
//      de su institución + los de su(s) propio(s) curso(s):
//      docente → cursos donde dirige o dicta materia;
//      estudiante → su curso con matrícula activa;
//      acudiente → el/los curso(s) de sus estudiantes a cargo
//      (tabla acudientes_estudiantes, mismo patrón que en
//      notas.controller.js/asistencia.controller.js).
// ============================================================

const pool = require('../config/db');
const { randomUUID } = require('crypto');

const TIPOS_VALIDOS = ['general', 'cierre_periodo', 'otro'];

const SELECT_BASE = `
  SELECT e.id, e.institucion_id, e.grupo_id, e.periodo_id, e.titulo,
         e.descripcion, e.fecha, e.tipo, e.color_hex, e.creado_por,
         e.created_at,
         u.nombres AS creado_por_nombres, u.apellidos AS creado_por_apellidos,
         gr.nombre AS grupo_nombre, gd.nombre AS grado_nombre,
         pa.nombre AS periodo_nombre
  FROM calendario_eventos e
  JOIN usuarios u ON u.id = e.creado_por
  LEFT JOIN grupos gr ON gr.id = e.grupo_id
  LEFT JOIN grados gd ON gd.id = gr.grado_id
  LEFT JOIN periodos_academicos pa ON pa.id = e.periodo_id
`;

// Devuelve el grupo (con institucion_id) o null si no existe.
async function datosGrupo(grupoId) {
  if (!grupoId) return null;
  const [rows] = await pool.query(
    `SELECT g.id, g.director_id, gr.institucion_id
     FROM grupos g JOIN grados gr ON gr.id = g.grado_id
     WHERE g.id = ?`,
    [grupoId]
  );
  return rows.length ? rows[0] : null;
}

// admin/superadmin de la institución, o el docente director de ESE grupo.
// grupo === null solo lo puede admin/superadmin (evento de todo el colegio).
async function puedeGestionar(req, grupo) {
  const { rol, institucion_id: institucionId, id: usuarioId } = req.usuario;
  if (rol === 'superadmin') return true;
  if (rol === 'admin') {
    if (!grupo) return true; // evento de todo el colegio: solo hace falta ser admin
    return grupo.institucion_id === institucionId;
  }
  if (rol === 'docente' && grupo) {
    return grupo.director_id === usuarioId;
  }
  return false;
}

// Grupos donde el usuario es director o dicta alguna materia (docente).
async function gruposDelDocente(docenteId) {
  const [rows] = await pool.query(
    `SELECT DISTINCT g.id
     FROM grupos g
     LEFT JOIN materias m ON m.grupo_id = g.id
     LEFT JOIN docentes_materias dm ON dm.materia_id = m.id AND dm.docente_id = ?
     WHERE g.director_id = ? OR dm.docente_id = ?`,
    [docenteId, docenteId, docenteId]
  );
  return rows.map(r => r.id);
}

// Curso(s) activo(s) del estudiante.
async function gruposDelEstudiante(estudianteId) {
  const [rows] = await pool.query(
    `SELECT grupo_id FROM matriculas WHERE estudiante_id = ? AND estado = 'activa'`,
    [estudianteId]
  );
  return rows.map(r => r.grupo_id);
}

// Curso(s) de los estudiantes a cargo del acudiente.
async function gruposDelAcudiente(acudienteId) {
  const [rows] = await pool.query(
    `SELECT DISTINCT mt.grupo_id
     FROM acudientes_estudiantes ae
     JOIN matriculas mt ON mt.estudiante_id = ae.estudiante_id AND mt.estado = 'activa'
     WHERE ae.acudiente_id = ?`,
    [acudienteId]
  );
  return rows.map(r => r.grupo_id);
}

// ────────────────────────────────────────────────────────────
//  GET /api/calendario/eventos?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&grupo_id=
//  Eventos generales de la institución + los del/los curso(s) que le
//  corresponden al usuario según su rol.
// ────────────────────────────────────────────────────────────
exports.listarEventos = async (req, res) => {
  const { rol, institucion_id: institucionId, id: usuarioId } = req.usuario;
  const { desde, hasta, grupo_id: grupoIdFiltro } = req.query;

  if (!institucionId) {
    return res.status(400).json({ ok: false, mensaje: 'Tu cuenta no tiene una institución asociada.' });
  }

  try {
    let gruposVisibles = null; // null = todos los de la institución (admin/superadmin)
    if (rol === 'docente')    gruposVisibles = await gruposDelDocente(usuarioId);
    if (rol === 'estudiante') gruposVisibles = await gruposDelEstudiante(usuarioId);
    if (rol === 'acudiente')  gruposVisibles = await gruposDelAcudiente(usuarioId);

    const condiciones = [`e.institucion_id = ?`];
    const params = [institucionId];

    if (gruposVisibles === null) {
      // admin/superadmin: todo el colegio (generales + de cualquier curso)
    } else if (gruposVisibles.length === 0) {
      condiciones.push(`e.grupo_id IS NULL`);
    } else {
      condiciones.push(`(e.grupo_id IS NULL OR e.grupo_id IN (${gruposVisibles.map(() => '?').join(',')}))`);
      params.push(...gruposVisibles);
    }

    if (grupoIdFiltro) {
      condiciones.push(`e.grupo_id = ?`);
      params.push(grupoIdFiltro);
    }
    if (desde) { condiciones.push(`e.fecha >= ?`); params.push(desde); }
    if (hasta) { condiciones.push(`e.fecha <= ?`); params.push(hasta); }

    const [rows] = await pool.query(
      `${SELECT_BASE} WHERE ${condiciones.join(' AND ')} ORDER BY e.fecha, e.created_at`,
      params
    );

    return res.json({ ok: true, total: rows.length, eventos: rows });
  } catch (err) {
    console.error('listarEventos error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ────────────────────────────────────────────────────────────
//  POST /api/calendario/eventos
//  { grupo_id?, periodo_id?, titulo, descripcion?, fecha, tipo?, color_hex? }
//  grupo_id ausente/null → evento de todo el colegio (solo admin/superadmin).
// ────────────────────────────────────────────────────────────
exports.crearEvento = async (req, res) => {
  const { grupo_id, periodo_id, titulo, descripcion, fecha, tipo, color_hex } = req.body;
  const institucionId = req.usuario.institucion_id;

  if (!institucionId) {
    return res.status(400).json({ ok: false, mensaje: 'Tu cuenta no tiene una institución asociada.' });
  }
  if (!titulo || !titulo.trim()) {
    return res.status(400).json({ ok: false, mensaje: 'El título del evento es obligatorio.' });
  }
  if (!fecha) {
    return res.status(400).json({ ok: false, mensaje: 'La fecha del evento es obligatoria.' });
  }
  const tipoFinal = TIPOS_VALIDOS.includes(tipo) ? tipo : 'general';

  try {
    const grupo = grupo_id ? await datosGrupo(grupo_id) : null;
    if (grupo_id && !grupo) {
      return res.status(404).json({ ok: false, mensaje: 'El curso indicado no existe.' });
    }
    if (grupo && grupo.institucion_id !== institucionId) {
      return res.status(403).json({ ok: false, mensaje: 'Ese curso no pertenece a tu institución.' });
    }
    if (!(await puedeGestionar(req, grupo))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para crear eventos ahí. Solo el admin del colegio o el director de ese curso puntual pueden.' });
    }

    // periodo_id es solo informativo (referencia opcional al cierre de un
    // periodo puntual); si viene, se valida que exista y sea de la misma
    // institución, pero nunca genera el evento automáticamente.
    if (periodo_id) {
      const [periodo] = await pool.query(
        `SELECT 1 FROM periodos_academicos WHERE id = ? AND institucion_id = ?`,
        [periodo_id, institucionId]
      );
      if (!periodo.length) {
        return res.status(404).json({ ok: false, mensaje: 'El periodo indicado no existe en tu institución.' });
      }
    }

    const id = randomUUID();
    await pool.query(
      `INSERT INTO calendario_eventos
         (id, institucion_id, grupo_id, periodo_id, creado_por, titulo, descripcion, fecha, tipo, color_hex)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, institucionId, grupo_id || null, periodo_id || null, req.usuario.id,
       titulo.trim(), descripcion?.trim() || null, fecha, tipoFinal, color_hex || null]
    );

    return res.status(201).json({ ok: true, mensaje: 'Evento creado.', id });
  } catch (err) {
    console.error('crearEvento error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ────────────────────────────────────────────────────────────
//  PUT /api/calendario/eventos/:id
// ────────────────────────────────────────────────────────────
exports.actualizarEvento = async (req, res) => {
  const { id } = req.params;
  const { titulo, descripcion, fecha, tipo, color_hex, periodo_id } = req.body;
  const institucionId = req.usuario.institucion_id;

  try {
    const [rows] = await pool.query(
      `SELECT * FROM calendario_eventos WHERE id = ? AND institucion_id = ?`,
      [id, institucionId]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, mensaje: 'El evento no existe.' });
    }
    const evento = rows[0];
    const grupo = await datosGrupo(evento.grupo_id);
    if (!(await puedeGestionar(req, grupo))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para editar este evento.' });
    }

    const tipoFinal = TIPOS_VALIDOS.includes(tipo) ? tipo : evento.tipo;

    await pool.query(
      `UPDATE calendario_eventos
       SET titulo = ?, descripcion = ?, fecha = ?, tipo = ?, color_hex = ?, periodo_id = ?
       WHERE id = ?`,
      [
        titulo?.trim() || evento.titulo,
        descripcion !== undefined ? (descripcion?.trim() || null) : evento.descripcion,
        fecha || evento.fecha,
        tipoFinal,
        color_hex !== undefined ? (color_hex || null) : evento.color_hex,
        periodo_id !== undefined ? (periodo_id || null) : evento.periodo_id,
        id,
      ]
    );

    return res.json({ ok: true, mensaje: 'Evento actualizado.' });
  } catch (err) {
    console.error('actualizarEvento error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ────────────────────────────────────────────────────────────
//  DELETE /api/calendario/eventos/:id
// ────────────────────────────────────────────────────────────
exports.eliminarEvento = async (req, res) => {
  const { id } = req.params;
  const institucionId = req.usuario.institucion_id;

  try {
    const [rows] = await pool.query(
      `SELECT * FROM calendario_eventos WHERE id = ? AND institucion_id = ?`,
      [id, institucionId]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, mensaje: 'El evento no existe.' });
    }
    const evento = rows[0];
    const grupo = await datosGrupo(evento.grupo_id);
    if (!(await puedeGestionar(req, grupo))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para eliminar este evento.' });
    }

    await pool.query(`DELETE FROM calendario_eventos WHERE id = ?`, [id]);
    return res.json({ ok: true, mensaje: 'Evento eliminado.' });
  } catch (err) {
    console.error('eliminarEvento error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};

// ────────────────────────────────────────────────────────────
//  GET /api/calendario/mis-cursos
//  Cursos donde el usuario puede crear eventos (para el <select> del
//  formulario): admin/superadmin → todos los de su institución; docente
//  → solo los que dirige (no basta con dictar materia para crear).
// ────────────────────────────────────────────────────────────
exports.misCursosParaEventos = async (req, res) => {
  const { rol, institucion_id: institucionId, id: usuarioId } = req.usuario;

  try {
    if (rol === 'admin' || rol === 'superadmin') {
      const [rows] = await pool.query(
        `SELECT g.id, g.nombre AS grupo_nombre, gd.nombre AS grado_nombre
         FROM grupos g JOIN grados gd ON gd.id = g.grado_id
         WHERE gd.institucion_id = ? AND g.activo = TRUE
         ORDER BY gd.orden, g.nombre`,
        [institucionId]
      );
      return res.json({ ok: true, cursos: rows });
    }
    if (rol === 'docente') {
      const [rows] = await pool.query(
        `SELECT g.id, g.nombre AS grupo_nombre, gd.nombre AS grado_nombre
         FROM grupos g JOIN grados gd ON gd.id = g.grado_id
         WHERE g.director_id = ?
         ORDER BY gd.orden, g.nombre`,
        [usuarioId]
      );
      return res.json({ ok: true, cursos: rows });
    }
    return res.json({ ok: true, cursos: [] });
  } catch (err) {
    console.error('misCursosParaEventos error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};
