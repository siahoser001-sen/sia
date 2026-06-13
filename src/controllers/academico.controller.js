// ============================================================
//  academico.controller.js — MySQL
//  CRUD de grados, grupos y materias.
//  Todo está limitado a la institución del admin autenticado
//  (req.usuario.institucion_id viene del JWT).
// ============================================================

const pool = require('../config/db');
const { randomUUID } = require('crypto');

// ────────────────────────────────────────────────────────────
//  ÁREAS (globales, solo lectura)
// ────────────────────────────────────────────────────────────

// GET /api/academico/areas
exports.listarAreas = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, nombre, color_hex, icono FROM areas ORDER BY nombre`
    );
    return res.json({ ok: true, areas: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  GRADOS
// ────────────────────────────────────────────────────────────

// GET /api/academico/grados
exports.listarGrados = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, nombre, nivel, orden, activo
       FROM grados
       WHERE institucion_id = ?
       ORDER BY orden ASC`,
      [req.usuario.institucion_id]
    );
    return res.json({ ok: true, total: rows.length, grados: rows });
  } catch (err) {
    console.error('listarGrados:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// POST /api/academico/grados
exports.crearGrado = async (req, res) => {
  const { nombre, nivel, orden } = req.body;

  if (!nombre || !nivel || orden === undefined) {
    return res.status(400).json({ ok: false, mensaje: 'Nombre, nivel y orden son obligatorios.' });
  }
  if (!['preescolar', 'primaria', 'secundaria'].includes(nivel)) {
    return res.status(400).json({ ok: false, mensaje: 'Nivel inválido. Usa: preescolar, primaria o secundaria.' });
  }

  try {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO grados (id, institucion_id, nombre, nivel, orden)
       VALUES (?, ?, ?, ?, ?)`,
      [id, req.usuario.institucion_id, nombre.trim(), nivel, orden]
    );
    return res.status(201).json({ ok: true, mensaje: 'Grado creado.', id });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, mensaje: 'Ya existe un grado con ese nombre en tu institución.' });
    }
    console.error('crearGrado:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// PUT /api/academico/grados/:id
exports.actualizarGrado = async (req, res) => {
  const { nombre, nivel, orden, activo } = req.body;

  try {
    const [result] = await pool.query(
      `UPDATE grados
       SET nombre = COALESCE(?, nombre),
           nivel  = COALESCE(?, nivel),
           orden  = COALESCE(?, orden),
           activo = COALESCE(?, activo)
       WHERE id = ? AND institucion_id = ?`,
      [nombre, nivel, orden, activo, req.params.id, req.usuario.institucion_id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Grado no encontrado.' });
    }
    return res.json({ ok: true, mensaje: 'Grado actualizado.' });
  } catch (err) {
    console.error('actualizarGrado:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// DELETE /api/academico/grados/:id  → soft delete (activo = false)
exports.eliminarGrado = async (req, res) => {
  try {
    const [result] = await pool.query(
      `UPDATE grados SET activo = FALSE WHERE id = ? AND institucion_id = ?`,
      [req.params.id, req.usuario.institucion_id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Grado no encontrado.' });
    }
    return res.json({ ok: true, mensaje: 'Grado desactivado.' });
  } catch (err) {
    console.error('eliminarGrado:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  GRUPOS
// ────────────────────────────────────────────────────────────

// GET /api/academico/grupos?grado_id=...
exports.listarGrupos = async (req, res) => {
  const { grado_id } = req.query;

  try {
    // Solo grupos de grados que pertenecen a la institución del admin
    let sql = `
      SELECT g.id, g.nombre, g.capacidad_max, g.activo, g.grado_id,
             gr.nombre AS grado_nombre
      FROM grupos g
      JOIN grados gr ON gr.id = g.grado_id
      WHERE gr.institucion_id = ?
    `;
    const params = [req.usuario.institucion_id];

    if (grado_id) {
      sql += ` AND g.grado_id = ?`;
      params.push(grado_id);
    }
    sql += ` ORDER BY gr.orden ASC, g.nombre ASC`;

    const [rows] = await pool.query(sql, params);
    return res.json({ ok: true, total: rows.length, grupos: rows });
  } catch (err) {
    console.error('listarGrupos:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// POST /api/academico/grupos
exports.crearGrupo = async (req, res) => {
  const { grado_id, nombre, capacidad_max } = req.body;

  if (!grado_id || !nombre) {
    return res.status(400).json({ ok: false, mensaje: 'grado_id y nombre son obligatorios.' });
  }

  try {
    // Verificar que el grado pertenece a la institución del admin
    const [grado] = await pool.query(
      `SELECT id FROM grados WHERE id = ? AND institucion_id = ?`,
      [grado_id, req.usuario.institucion_id]
    );
    if (!grado.length) {
      return res.status(404).json({ ok: false, mensaje: 'Grado no encontrado en tu institución.' });
    }

    const id = randomUUID();
    await pool.query(
      `INSERT INTO grupos (id, grado_id, nombre, capacidad_max)
       VALUES (?, ?, ?, ?)`,
      [id, grado_id, nombre.trim().toUpperCase(), capacidad_max || 35]
    );
    return res.status(201).json({ ok: true, mensaje: 'Grupo creado.', id });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, mensaje: 'Ya existe ese grupo en el grado seleccionado.' });
    }
    console.error('crearGrupo:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// PUT /api/academico/grupos/:id
exports.actualizarGrupo = async (req, res) => {
  const { nombre, capacidad_max, activo } = req.body;

  try {
    const [result] = await pool.query(
      `UPDATE grupos g
       JOIN grados gr ON gr.id = g.grado_id
       SET g.nombre = COALESCE(?, g.nombre),
           g.capacidad_max = COALESCE(?, g.capacidad_max),
           g.activo = COALESCE(?, g.activo)
       WHERE g.id = ? AND gr.institucion_id = ?`,
      [nombre, capacidad_max, activo, req.params.id, req.usuario.institucion_id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Grupo no encontrado.' });
    }
    return res.json({ ok: true, mensaje: 'Grupo actualizado.' });
  } catch (err) {
    console.error('actualizarGrupo:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// DELETE /api/academico/grupos/:id  → soft delete
exports.eliminarGrupo = async (req, res) => {
  try {
    const [result] = await pool.query(
      `UPDATE grupos g
       JOIN grados gr ON gr.id = g.grado_id
       SET g.activo = FALSE
       WHERE g.id = ? AND gr.institucion_id = ?`,
      [req.params.id, req.usuario.institucion_id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Grupo no encontrado.' });
    }
    return res.json({ ok: true, mensaje: 'Grupo desactivado.' });
  } catch (err) {
    console.error('eliminarGrupo:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  MATERIAS
// ────────────────────────────────────────────────────────────

// GET /api/academico/materias?grado_id=...
exports.listarMaterias = async (req, res) => {
  const { grado_id } = req.query;

  try {
    let sql = `
      SELECT m.id, m.nombre, m.descripcion, m.intensidad_hs, m.activa,
             m.grado_id, gr.nombre AS grado_nombre,
             m.area_id, a.nombre AS area_nombre, a.color_hex, a.icono
      FROM materias m
      JOIN grados gr ON gr.id = m.grado_id
      JOIN areas a   ON a.id  = m.area_id
      WHERE gr.institucion_id = ?
    `;
    const params = [req.usuario.institucion_id];

    if (grado_id) {
      sql += ` AND m.grado_id = ?`;
      params.push(grado_id);
    }
    sql += ` ORDER BY gr.orden ASC, a.nombre ASC, m.nombre ASC`;

    const [rows] = await pool.query(sql, params);
    return res.json({ ok: true, total: rows.length, materias: rows });
  } catch (err) {
    console.error('listarMaterias:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// POST /api/academico/materias
exports.crearMateria = async (req, res) => {
  const { area_id, grado_id, nombre, descripcion, intensidad_hs } = req.body;

  if (!area_id || !grado_id || !nombre) {
    return res.status(400).json({ ok: false, mensaje: 'area_id, grado_id y nombre son obligatorios.' });
  }

  try {
    const [grado] = await pool.query(
      `SELECT id FROM grados WHERE id = ? AND institucion_id = ?`,
      [grado_id, req.usuario.institucion_id]
    );
    if (!grado.length) {
      return res.status(404).json({ ok: false, mensaje: 'Grado no encontrado en tu institución.' });
    }

    const id = randomUUID();
    await pool.query(
      `INSERT INTO materias (id, area_id, grado_id, nombre, descripcion, intensidad_hs)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, area_id, grado_id, nombre.trim(), descripcion || null, intensidad_hs || null]
    );
    return res.status(201).json({ ok: true, mensaje: 'Materia creada.', id });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, mensaje: 'Ya existe esa materia en esa área y grado.' });
    }
    console.error('crearMateria:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// PUT /api/academico/materias/:id
exports.actualizarMateria = async (req, res) => {
  const { nombre, descripcion, intensidad_hs, activa } = req.body;

  try {
    const [result] = await pool.query(
      `UPDATE materias m
       JOIN grados gr ON gr.id = m.grado_id
       SET m.nombre = COALESCE(?, m.nombre),
           m.descripcion = COALESCE(?, m.descripcion),
           m.intensidad_hs = COALESCE(?, m.intensidad_hs),
           m.activa = COALESCE(?, m.activa)
       WHERE m.id = ? AND gr.institucion_id = ?`,
      [nombre, descripcion, intensidad_hs, activa, req.params.id, req.usuario.institucion_id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Materia no encontrada.' });
    }
    return res.json({ ok: true, mensaje: 'Materia actualizada.' });
  } catch (err) {
    console.error('actualizarMateria:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// DELETE /api/academico/materias/:id  → soft delete
exports.eliminarMateria = async (req, res) => {
  try {
    const [result] = await pool.query(
      `UPDATE materias m
       JOIN grados gr ON gr.id = m.grado_id
       SET m.activa = FALSE
       WHERE m.id = ? AND gr.institucion_id = ?`,
      [req.params.id, req.usuario.institucion_id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Materia no encontrada.' });
    }
    return res.json({ ok: true, mensaje: 'Materia desactivada.' });
  } catch (err) {
    console.error('eliminarMateria:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};