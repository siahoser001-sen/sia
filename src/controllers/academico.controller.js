// ============================================================
//  academico.controller.js — MySQL
//  CRUD de grados, grupos y materias.
//  Todo está limitado a la institución del admin autenticado
//  (req.usuario.institucion_id viene del JWT).
// ============================================================

const pool = require('../config/db');
const { randomUUID, randomBytes } = require('crypto');

// Charset sin caracteres confundibles (sin 0/O, 1/I/L)
const CHARSET_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generarCodigo(longitud = 8) {
  const bytes = randomBytes(longitud);
  let codigo = '';
  for (let i = 0; i < longitud; i++) {
    codigo += CHARSET_CODIGO[bytes[i] % CHARSET_CODIGO.length];
  }
  return codigo;
}

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

// POST /api/academico/areas  { nombre, color_hex?, icono? }
// Las áreas son globales (no por institución) — cualquier admin puede
// crear una nueva desde el mismo formulario de materia, sin salir de ahí.
exports.crearArea = async (req, res) => {
  const { nombre, color_hex, icono } = req.body;
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ ok: false, mensaje: 'El nombre del área es obligatorio.' });
  }
  try {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO areas (id, nombre, color_hex, icono) VALUES (?, ?, ?, ?)`,
      [id, nombre.trim(), color_hex || '#4A90D9', icono || null]
    );
    return res.status(201).json({ ok: true, mensaje: 'Área creada.', id, nombre: nombre.trim(), color_hex: color_hex || '#4A90D9', icono: icono || null });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, mensaje: 'Ya existe un área con ese nombre.' });
    }
    console.error('crearArea:', err.message);
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
//  CURSOS (atajo: crea/lista grado+grupo como un solo código,
//  ej. "601" = grado 6, grupo 01. "1102" = grado 11, grupo 02.
//  Por debajo sigue usando las tablas grados/grupos de siempre;
//  esto es solo una forma más simple de crearlos desde el panel.)
// ────────────────────────────────────────────────────────────

function nivelPorGrado(numGrado) {
  if (numGrado === 0) return 'preescolar';
  if (numGrado >= 1 && numGrado <= 5) return 'primaria';
  return 'secundaria'; // 6 a 11
}

// Interpreta "601" -> {grado:'6', grupo:'01'} ; "1102" -> {grado:'11', grupo:'02'}
function parsearCodigoCurso(codigo) {
  const c = String(codigo || '').trim();
  if (!/^\d{3,4}$/.test(c)) return null;

  const digitosGrado = c.length === 4 ? 2 : 1;
  const gradoNum  = c.slice(0, digitosGrado);
  const grupoNum  = c.slice(digitosGrado);
  if (grupoNum.length !== 2) return null;

  return { gradoNombre: String(Number(gradoNum)), grupoNombre: grupoNum };
}

// GET /api/academico/cursos
exports.listarCursos = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT g.id AS grupo_id, g.activo, g.capacidad_max,
              gr.id AS grado_id, gr.nombre AS grado_nombre, g.nombre AS grupo_nombre,
              g.director_id,
              CASE WHEN g.director_id IS NOT NULL
                   THEN CONCAT(d.nombres, ' ', d.apellidos) END AS director_nombre
       FROM grupos g
       JOIN grados gr ON gr.id = g.grado_id
       LEFT JOIN usuarios d ON d.id = g.director_id
       WHERE gr.institucion_id = ?
       ORDER BY gr.orden ASC, g.nombre ASC`,
      [req.usuario.institucion_id]
    );
    const cursos = rows.map(r => ({
      ...r,
      codigo: `${r.grado_nombre}${r.grupo_nombre}`,
    }));
    return res.json({ ok: true, total: cursos.length, cursos });
  } catch (err) {
    console.error('listarCursos:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// POST /api/academico/cursos  { codigo: "601" }
exports.crearCursoRapido = async (req, res) => {
  const { codigo } = req.body;
  const parsed = parsearCodigoCurso(codigo);
  if (!parsed) {
    return res.status(400).json({ ok: false, mensaje: 'Escribe el curso como número: 601, 402, 303 (o 1001, 1102 para 10° y 11°).' });
  }
  const { gradoNombre, grupoNombre } = parsed;
  const institucionId = req.usuario.institucion_id;
  if (!institucionId) {
    return res.status(400).json({
      ok: false,
      mensaje: 'Tu cuenta no tiene una institución asociada, así que no se puede crear el curso. Si eres superadmin, esta acción se hace desde la sesión del administrador del colegio.'
    });
  }
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Busca el grado o lo crea si no existe todavía
    let [grado] = await conn.query(
      `SELECT id FROM grados WHERE institucion_id = ? AND nombre = ?`,
      [institucionId, gradoNombre]
    );
    let gradoId;
    if (grado.length) {
      gradoId = grado[0].id;
    } else {
      gradoId = randomUUID();
      await conn.query(
        `INSERT INTO grados (id, institucion_id, nombre, nivel, orden) VALUES (?, ?, ?, ?, ?)`,
        [gradoId, institucionId, gradoNombre, nivelPorGrado(Number(gradoNombre)), Number(gradoNombre)]
      );
    }

    // Verifica que el curso (grado+grupo) no exista ya para el año vigente
    const [existente] = await conn.query(
      `SELECT id FROM grupos WHERE grado_id = ? AND nombre = ? AND anio_lectivo = ?`,
      [gradoId, grupoNombre, new Date().getFullYear()]
    );
    if (existente.length) {
      await conn.rollback();
      return res.status(409).json({ ok: false, mensaje: `El curso ${gradoNombre}${grupoNombre} ya existe.` });
    }

    const grupoId = randomUUID();
    await conn.query(
      `INSERT INTO grupos (id, grado_id, nombre, capacidad_max, anio_lectivo) VALUES (?, ?, ?, 35, ?)`,
      [grupoId, gradoId, grupoNombre, new Date().getFullYear()]
    );

    await conn.commit();
    return res.status(201).json({ ok: true, mensaje: 'Curso creado.', grupo_id: grupoId, codigo: `${gradoNombre}${grupoNombre}` });
  } catch (err) {
    await conn.rollback();
    console.error('crearCursoRapido:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    conn.release();
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
      SELECT g.id, g.nombre, g.capacidad_max, g.activo, g.grado_id, g.anio_lectivo,
             gr.nombre AS grado_nombre,
             g.director_id,
             CASE WHEN g.director_id IS NOT NULL
                  THEN CONCAT(d.nombres, ' ', d.apellidos) END AS director_nombre
      FROM grupos g
      JOIN grados gr ON gr.id = g.grado_id
      LEFT JOIN usuarios d ON d.id = g.director_id
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
      `INSERT INTO grupos (id, grado_id, nombre, capacidad_max, anio_lectivo)
       VALUES (?, ?, ?, ?, ?)`,
      [id, grado_id, nombre.trim().toUpperCase(), capacidad_max || 35, new Date().getFullYear()]
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

// PUT /api/academico/grupos/:id/director  { docente_id: string | null }
exports.asignarDirector = async (req, res) => {
  const { docente_id } = req.body;
  const institucionId = req.usuario.institucion_id;

  try {
    // Verificar que el grupo pertenece a la institución del admin
    const [grupo] = await pool.query(
      `SELECT g.id FROM grupos g
       JOIN grados gr ON gr.id = g.grado_id
       WHERE g.id = ? AND gr.institucion_id = ?`,
      [req.params.id, institucionId]
    );
    if (!grupo.length) {
      return res.status(404).json({ ok: false, mensaje: 'Grupo no encontrado.' });
    }

    // Quitar director: docente_id llega explícitamente en null
    if (docente_id === null) {
      await pool.query(`UPDATE grupos SET director_id = NULL WHERE id = ?`, [req.params.id]);
      return res.json({ ok: true, mensaje: 'Director removido del curso.' });
    }

    if (!docente_id) {
      return res.status(400).json({ ok: false, mensaje: 'docente_id es obligatorio (o null para quitar el director).' });
    }

    const [docente] = await pool.query(
      `SELECT id FROM usuarios
       WHERE id = ? AND institucion_id = ? AND rol = 'docente' AND activo = TRUE`,
      [docente_id, institucionId]
    );
    if (!docente.length) {
      return res.status(404).json({ ok: false, mensaje: 'Ese docente no pertenece a tu institución.' });
    }

    // Un docente solo puede dirigir un grupo activo a la vez
    const [yaDirige] = await pool.query(
      `SELECT g.id, g.nombre FROM grupos g
       JOIN grados gr ON gr.id = g.grado_id
       WHERE g.director_id = ? AND g.id != ? AND gr.institucion_id = ? AND g.activo = TRUE`,
      [docente_id, req.params.id, institucionId]
    );
    if (yaDirige.length) {
      return res.status(409).json({ ok: false, mensaje: `Este docente ya dirige el grupo "${yaDirige[0].nombre}". Quítalo de ahí primero.` });
    }

    await pool.query(`UPDATE grupos SET director_id = ? WHERE id = ?`, [docente_id, req.params.id]);
    return res.json({ ok: true, mensaje: 'Director de curso asignado.' });
  } catch (err) {
    console.error('asignarDirector error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  DIRECTOR DE CURSO — endpoints propios del docente director
//  (no es un rol aparte: es rol 'docente' + grupos.director_id)
// ────────────────────────────────────────────────────────────

// GET /api/academico/mi-grupo  (docente que dirige un grupo)
exports.miGrupoDirector = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT g.id, g.nombre, g.capacidad_max, g.codigo_matricula, g.codigo_activo,
              gr.nombre AS grado_nombre,
              (SELECT COUNT(*) FROM matriculas mt WHERE mt.grupo_id = g.id AND mt.estado = 'activa') AS total_estudiantes
       FROM grupos g
       JOIN grados gr ON gr.id = g.grado_id
       WHERE g.director_id = ? AND g.activo = TRUE
       LIMIT 1`,
      [req.usuario.id]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, mensaje: 'No diriges ningún grupo actualmente.' });
    }
    return res.json({ ok: true, grupo: rows[0] });
  } catch (err) {
    console.error('miGrupoDirector error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// Verifica que el grupo pertenezca a la institución del usuario y,
// si es docente, que además sea el director de ese grupo específico.
async function _grupoAccesible(req, grupoId) {
  const { rol, id: usuarioId, institucion_id: institucionId } = req.usuario;
  const [rows] = await pool.query(
    `SELECT g.id, g.director_id FROM grupos g
     JOIN grados gr ON gr.id = g.grado_id
     WHERE g.id = ? AND gr.institucion_id = ?`,
    [grupoId, institucionId]
  );
  if (!rows.length) return { ok: false, status: 404, mensaje: 'Grupo no encontrado en tu institución.' };
  if (rol === 'docente' && rows[0].director_id !== usuarioId) {
    return { ok: false, status: 403, mensaje: 'No eres el director de este grupo.' };
  }
  return { ok: true };
}

// POST /api/academico/grupos/:id/generar-codigo  (admin, superadmin, docente-director)
exports.generarCodigoGrupo = async (req, res) => {
  try {
    const acceso = await _grupoAccesible(req, req.params.id);
    if (!acceso.ok) return res.status(acceso.status).json({ ok: false, mensaje: acceso.mensaje });

    // Reintenta si por azar choca con el índice único (muy improbable con 8 chars)
    for (let intento = 0; intento < 5; intento++) {
      const codigo = generarCodigo(8);
      try {
        await pool.query(
          `UPDATE grupos SET codigo_matricula = ?, codigo_activo = TRUE WHERE id = ?`,
          [codigo, req.params.id]
        );
        return res.json({ ok: true, mensaje: 'Código generado.', codigo });
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
      }
    }
    return res.status(500).json({ ok: false, mensaje: 'No se pudo generar un código único, intenta de nuevo.' });
  } catch (err) {
    console.error('generarCodigoGrupo error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// PUT /api/academico/grupos/:id/codigo-estado  { activo: boolean }  (admin, superadmin, docente-director)
exports.cambiarEstadoCodigo = async (req, res) => {
  const { activo } = req.body;
  if (typeof activo !== 'boolean') {
    return res.status(400).json({ ok: false, mensaje: 'activo debe ser true o false.' });
  }
  try {
    const acceso = await _grupoAccesible(req, req.params.id);
    if (!acceso.ok) return res.status(acceso.status).json({ ok: false, mensaje: acceso.mensaje });

    await pool.query(`UPDATE grupos SET codigo_activo = ? WHERE id = ?`, [activo, req.params.id]);
    return res.json({ ok: true, mensaje: activo ? 'Código activado.' : 'Código desactivado.' });
  } catch (err) {
    console.error('cambiarEstadoCodigo error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// GET /api/academico/mis-cursos  (docente)
// Los cursos del docente: el que dirige (si dirige) y los grupos donde
// dicta materias. Cada curso trae estudiantes, total de materias del
// curso y las materias que el docente dicta ahí.
exports.misCursosDocente = async (req, res) => {
  const { id: usuarioId, institucion_id: institucionId } = req.usuario;
  try {
    const [rows] = await pool.query(
      `SELECT g.id AS grupo_id, g.nombre AS grupo_nombre, g.capacidad_max,
              gr.id AS grado_id, gr.nombre AS grado_nombre,
              g.director_id,
              (SELECT COUNT(*) FROM matriculas mt WHERE mt.grupo_id = g.id AND mt.estado = 'activa') AS total_estudiantes,
              (SELECT COUNT(*) FROM docentes_materias dmc WHERE dmc.grupo_id = g.id) AS total_materias
       FROM grupos g
       JOIN grados gr ON gr.id = g.grado_id
       WHERE gr.institucion_id = ?
         AND (g.director_id = ? OR EXISTS (
               SELECT 1 FROM docentes_materias dm2
               WHERE dm2.docente_id = ? AND dm2.grupo_id = g.id
             ))
         AND g.activo = TRUE
       ORDER BY (g.director_id = ?) DESC, gr.orden ASC, g.nombre ASC`,
      [institucionId, usuarioId, usuarioId, usuarioId]
    );

    const [mats] = await pool.query(
      `SELECT dm.grupo_id AS grupo_id, m.id AS materia_id, m.nombre AS materia_nombre
       FROM docentes_materias dm
       JOIN materias m ON m.id = dm.materia_id
       JOIN grupos g   ON g.id = dm.grupo_id
       JOIN grados gr  ON gr.id = g.grado_id
       WHERE dm.docente_id = ? AND gr.institucion_id = ?
       GROUP BY dm.grupo_id, m.id, m.nombre
       ORDER BY m.nombre`,
      [usuarioId, institucionId]
    );
    const porCurso = new Map();
    for (const m of mats) {
      if (!porCurso.has(m.grupo_id)) porCurso.set(m.grupo_id, []);
      porCurso.get(m.grupo_id).push({ materia_id: m.materia_id, materia_nombre: m.materia_nombre });
    }

    const cursos = rows.map(r => ({
      ...r,
      codigo: `${r.grado_nombre}${r.grupo_nombre}`,
      es_director: r.director_id === usuarioId,
      materias_mias: porCurso.get(r.grupo_id) || [],
      total_mis_materias: (porCurso.get(r.grupo_id) || []).length,
    }));
    return res.json({ ok: true, total: cursos.length, cursos });
  } catch (err) {
    console.error('misCursosDocente:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// GET /api/academico/docentes  (admin, superadmin, docente-director)
// Lista básica de docentes de la institución para que el director de
// curso pueda asignar colegas a las materias de su salón.
exports.listarDocentesInstitucion = async (req, res) => {
  try {
    if (req.usuario.rol === 'docente') {
      const [gr] = await pool.query(
        `SELECT id FROM grupos WHERE director_id = ? AND activo = TRUE LIMIT 1`,
        [req.usuario.id]
      );
      if (!gr.length) {
        return res.status(403).json({ ok: false, mensaje: 'Solo los directores de curso pueden consultar los docentes de la institución.' });
      }
    }
    const [rows] = await pool.query(
      `SELECT id, CONCAT(nombres, ' ', apellidos) AS nombre
       FROM usuarios
       WHERE institucion_id = ? AND rol = 'docente' AND activo = TRUE
       ORDER BY nombres ASC, apellidos ASC`,
      [req.usuario.institucion_id]
    );
    return res.json({ ok: true, total: rows.length, docentes: rows });
  } catch (err) {
    console.error('listarDocentesInstitucion:', err.message);
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
//  MATERIAS (ligadas a un curso/grupo específico, no solo al grado —
//  "Matemáticas" en 501 y en 502 son materias distintas. Cada una
//  puede tener varios docentes — co-docencia — vía `docentes_materias`,
//  que ya guarda una fila por periodo académico para que el profesor
//  no pierda acceso a la materia al cambiar de trimestre.)
// ────────────────────────────────────────────────────────────

// Devuelve los periodos académicos del "año lectivo vigente" de la
// institución: el año del periodo marcado `activo`, o si ninguno está
// activo, el año lectivo más reciente que ya tenga periodos creados.
// Devuelve [] si la institución todavía no tiene ningún periodo.
async function _periodosVigentes(conn, institucionId) {
  const [activoRows] = await conn.query(
    `SELECT anio_lectivo FROM periodos_academicos WHERE institucion_id = ? AND activo = TRUE LIMIT 1`,
    [institucionId]
  );
  let anioLectivo = activoRows.length ? activoRows[0].anio_lectivo : null;

  if (!anioLectivo) {
    const [maxRows] = await conn.query(
      `SELECT MAX(anio_lectivo) AS anio FROM periodos_academicos WHERE institucion_id = ?`,
      [institucionId]
    );
    anioLectivo = maxRows.length ? maxRows[0].anio : null;
  }
  if (!anioLectivo) return [];

  const [periodos] = await conn.query(
    `SELECT id FROM periodos_academicos WHERE institucion_id = ? AND anio_lectivo = ?`,
    [institucionId, anioLectivo]
  );
  return periodos;
}

// Liga un docente a una materia/grupo insertando una fila en
// `docentes_materias` por cada periodo del año lectivo vigente.
// INSERT IGNORE porque el UNIQUE KEY ya cubre exactamente esas 4
// columnas — si alguna fila ya existía (ej. reintentando), no falla.
async function _sincronizarDocenteMateria(conn, { docenteId, materiaId, grupoId, institucionId }) {
  const periodos = await _periodosVigentes(conn, institucionId);
  if (!periodos.length) {
    const error = new Error('SIN_PERIODOS');
    error.siaCode = 'SIN_PERIODOS';
    throw error;
  }
  for (const p of periodos) {
    await conn.query(
      `INSERT IGNORE INTO docentes_materias (id, docente_id, materia_id, institucion_id, grupo_id, periodo_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), docenteId, materiaId, institucionId, grupoId, p.id]
    );
  }
}

// GET /api/academico/materias?grupo_id=...
exports.listarMaterias = async (req, res) => {
  const { grupo_id } = req.query;

  try {
    // Un docente (director de curso) solo ve las materias de su salón:
    // fija el grupo y valida que sea el director de ese grupo.
    const esAdmin = ['admin', 'superadmin'].includes(req.usuario.rol);
    let grupoFiltro = grupo_id || null;
    if (!esAdmin) {
      const grupo = await _esMiGrupo(pool, grupo_id, req.usuario);
      if (!grupo) {
        return res.status(404).json({ ok: false, mensaje: 'Curso no encontrado o no eres el director de ese curso.' });
      }
      grupoFiltro = grupo_id;
    }

    let sql = `
      SELECT m.id, m.nombre, m.descripcion, m.intensidad_hs, m.activa,
             m.grado_id, gr.nombre AS grado_nombre,
             m.grupo_id, gp.nombre AS grupo_nombre,
             m.area_id, a.nombre AS area_nombre, a.color_hex, a.icono,
             (
               SELECT GROUP_CONCAT(DISTINCT CONCAT(u.nombres, ' ', u.apellidos) SEPARATOR ', ')
               FROM docentes_materias dm
               JOIN usuarios u ON u.id = dm.docente_id
               WHERE dm.materia_id = m.id
             ) AS docentes_nombres
      FROM materias m
      LEFT JOIN grados gr ON gr.id = m.grado_id
      LEFT JOIN grupos gp ON gp.id = m.grupo_id
      JOIN areas a   ON a.id  = m.area_id
      WHERE m.institucion_id = ? AND m.activa = TRUE
    `;
    const params = [req.usuario.institucion_id];

    if (grupoFiltro) {
      sql += ` AND m.grupo_id = ?`;
      params.push(grupoFiltro);
    }
    sql += ` ORDER BY COALESCE(gr.orden, 999) ASC, a.nombre ASC, m.nombre ASC`;

    const [rows] = await pool.query(sql, params);

    // Intensidad semanal derivada del horario (decisión 2026-09-02):
    // en lugar de pedir `intensidad_hs` a mano, se calcula la suma de
    // horas de las franjas de cada materia (solo si hay horario para el
    // curso; si no, queda en 0 y se muestra como "sin horario").
    let horasPorMateria = {};
    if (grupo_id) {
      const [franjas] = await pool.query(
        `SELECT materia_id, SEC_TO_TIME(SUM(TIME_TO_SEC(TIMEDIFF(hora_fin, hora_inicio)))) AS horas
         FROM horarios
         WHERE grupo_id = ?
         GROUP BY materia_id`,
        [grupo_id]
      );
      for (const f of franjas) {
        horasPorMateria[f.materia_id] = f.horas; // 'HH:MM:SS'
      }
    }

    const conHoras = rows.map(m => ({
      ...m,
      horas_semanales: horasPorMateria[m.id] || null,
      intensidad_hs: horasPorMateria[m.id] || m.intensidad_hs,
    }));

    return res.json({ ok: true, total: conHoras.length, materias: conHoras });
  } catch (err) {
    console.error('listarMaterias:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// POST /api/academico/materias
// Una materia se crea SIN profesor obligatorio y el curso es opcional:
// puede quedar "general" y luego vincularse a uno o varios cursos con
// distintos profesores desde el modal de co-docencia ("Profesores").
exports.crearMateria = async (req, res) => {
  const { area_id, grado_id, grupo_id, nombre, descripcion, intensidad_hs } = req.body;
  const esAdmin = ['admin', 'superadmin'].includes(req.usuario.rol);

  if (!area_id || !nombre) {
    return res.status(400).json({ ok: false, mensaje: 'Área y nombre son obligatorios.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let gradoId = grado_id || null;
    let grupoId = grupo_id || null;

    // Un docente (director de curso) solo puede crear materias para su
    // propio salón: el grado y el curso se resuelven de su grupo dirigido.
    if (!esAdmin) {
      const [dirRows] = await conn.query(
        `SELECT g.id AS grupo_id, g.grado_id
         FROM grupos g JOIN grados gr ON gr.id = g.grado_id
         WHERE g.director_id = ? AND gr.institucion_id = ? AND g.activo = TRUE
         LIMIT 1`,
        [req.usuario.id, req.usuario.institucion_id]
      );
      if (!dirRows.length) {
        await conn.rollback();
        return res.status(403).json({ ok: false, mensaje: 'No diriges ningún curso, así que no puedes crear materias.' });
      }
      gradoId = dirRows[0].grado_id;
      grupoId = dirRows[0].grupo_id;
    } else if (grupoId && !gradoId) {
      // El admin puede mandar solo el curso: se infiere el grado del grupo.
      const [g] = await conn.query(
        `SELECT g.grado_id FROM grupos g
         JOIN grados gr ON gr.id = g.grado_id
         WHERE g.id = ? AND gr.institucion_id = ?`,
        [grupoId, req.usuario.institucion_id]
      );
      if (!g.length) {
        await conn.rollback();
        return res.status(404).json({ ok: false, mensaje: 'Curso no encontrado en tu institución.' });
      }
      gradoId = g[0].grado_id;
    }

    if (gradoId) {
      const [gradoRows] = await conn.query(
        `SELECT id FROM grados WHERE id = ? AND institucion_id = ?`,
        [gradoId, req.usuario.institucion_id]
      );
      if (!gradoRows.length) {
        await conn.rollback();
        return res.status(404).json({ ok: false, mensaje: 'Grado no encontrado en tu institución.' });
      }
    }

    if (grupoId) {
      const [grupoRows] = await conn.query(
        `SELECT id FROM grupos WHERE id = ? AND grado_id = ?`,
        [grupoId, gradoId]
      );
      if (!grupoRows.length) {
        await conn.rollback();
        return res.status(404).json({ ok: false, mensaje: 'El curso no pertenece a ese grado.' });
      }
    }

    const id = randomUUID();
    await conn.query(
      `INSERT INTO materias (id, institucion_id, area_id, grado_id, grupo_id, nombre, descripcion, intensidad_hs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.usuario.institucion_id, area_id, gradoId, grupoId, nombre.trim(), descripcion || null, intensidad_hs || null]
    );

    await conn.commit();
    return res.status(201).json({ ok: true, mensaje: 'Materia creada. Asigna el profesor y el curso desde "Profesores".', id });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, mensaje: 'Ya existe esa materia en ese grado y curso.' });
    }
    console.error('crearMateria:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    conn.release();
  }
};

// PUT /api/academico/materias/:id
exports.actualizarMateria = async (req, res) => {
  const { nombre, descripcion, intensidad_hs, activa } = req.body;

  try {
    const materia = await _materiaAccesible(pool, req.params.id, req.usuario.institucion_id);
    if (!materia) {
      return res.status(404).json({ ok: false, mensaje: 'Materia no encontrada.' });
    }
    if (!(await _esDirectorDeMateria(pool, materia, req.usuario))) {
      return res.status(403).json({ ok: false, mensaje: 'Solo puedes editar las materias de tu propio curso o siendo administrador.' });
    }

    const [result] = await pool.query(
      `UPDATE materias m
       SET m.nombre = COALESCE(?, m.nombre),
           m.descripcion = COALESCE(?, m.descripcion),
           m.intensidad_hs = COALESCE(?, m.intensidad_hs),
           m.activa = COALESCE(?, m.activa)
       WHERE m.id = ? AND m.institucion_id = ?`,
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
    const materia = await _materiaAccesible(pool, req.params.id, req.usuario.institucion_id);
    if (!materia) {
      return res.status(404).json({ ok: false, mensaje: 'Materia no encontrada.' });
    }
    if (!(await _esDirectorDeMateria(pool, materia, req.usuario))) {
      return res.status(403).json({ ok: false, mensaje: 'Solo puedes desactivar las materias de tu propio curso o siendo administrador.' });
    }

    const [result] = await pool.query(
      `UPDATE materias m
       SET m.activa = FALSE
       WHERE m.id = ? AND m.institucion_id = ?`,
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

// ────────────────────────────────────────────────────────────
//  CO-DOCENCIA — varios profesores por materia
// ────────────────────────────────────────────────────────────

// Trae la materia + su grupo_id, validando que pertenezca a la
// institución del usuario. null si no existe o no es de su institución.
async function _materiaAccesible(conn, materiaId, institucionId) {
  const [rows] = await conn.query(
    `SELECT m.id, m.grado_id, m.grupo_id FROM materias m
     WHERE m.id = ? AND m.institucion_id = ?`,
    [materiaId, institucionId]
  );
  return rows.length ? rows[0] : null;
}

// ¿El usuario puede gestionar esa materia? Admin/superadmin siempre;
// un docente solo si es el director del curso al que pertenece la materia.
async function _esDirectorDeMateria(conn, materia, usuario) {
  if (['admin', 'superadmin'].includes(usuario.rol)) return true;
  if (usuario.rol !== 'docente' || !materia.grupo_id) return false;
  const [rows] = await conn.query(
    `SELECT id FROM grupos WHERE id = ? AND director_id = ? AND activo = TRUE`,
    [materia.grupo_id, usuario.id]
  );
  return rows.length > 0;
}

// GET /api/academico/materias/:id/docentes
exports.listarDocentesMateria = async (req, res) => {
  try {
    const materia = await _materiaAccesible(pool, req.params.id, req.usuario.institucion_id);
    if (!materia) {
      return res.status(404).json({ ok: false, mensaje: 'Materia no encontrada.' });
    }
    if (!(await _esDirectorDeMateria(pool, materia, req.usuario))) {
      return res.status(403).json({ ok: false, mensaje: 'Solo puedes consultar los docentes de una materia si eres el director de su curso o un administrador.' });
    }
    const [rows] = await pool.query(
      `SELECT DISTINCT u.id, u.nombres, u.apellidos, dm.grupo_id,
              g.nombre AS grupo_nombre, gr.nombre AS grado_nombre
       FROM docentes_materias dm
       JOIN usuarios u ON u.id = dm.docente_id
       LEFT JOIN grupos g   ON g.id = dm.grupo_id
       LEFT JOIN grados gr  ON gr.id = g.grado_id
       WHERE dm.materia_id = ?
       ORDER BY gr.orden ASC, g.nombre ASC, u.nombres ASC, u.apellidos ASC`,
      [req.params.id]
    );
    const docentes = rows.map(d => ({
      ...d,
      curso: d.grado_nombre && d.grupo_nombre ? `${d.grado_nombre}${d.grupo_nombre}` : null,
    }));
    return res.json({ ok: true, total: docentes.length, docentes });
  } catch (err) {
    console.error('listarDocentesMateria:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// POST /api/academico/materias/:id/docentes  { docente_id, grupo_id? }
// Si la materia no tiene un curso asignado (es "general"), el curso se
// pide aquí para saber en cuál curso dicta el profesor esa materia.
exports.agregarDocenteMateria = async (req, res) => {
  let { docente_id, grupo_id: grupoParam } = req.body;
  if (!docente_id) {
    return res.status(400).json({ ok: false, mensaje: 'docente_id es obligatorio.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const materia = await _materiaAccesible(conn, req.params.id, req.usuario.institucion_id);
    if (!materia) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'Materia no encontrada.' });
    }
    if (!(await _esDirectorDeMateria(conn, materia, req.usuario))) {
      // Para materias generales (sin curso) `_esDirectorDeMateria` con un
      // docente devuelve false siempre; aquí se valida contra el curso al
      // que se quiere asignar, que debe ser uno que el docente dirija.
      if (req.usuario.rol === 'docente') {
        const [dirRows] = await conn.query(
          `SELECT id FROM grupos WHERE director_id = ? AND activo = TRUE LIMIT 1`,
          [req.usuario.id]
        );
        if (dirRows.length) {
          grupoParam = dirRows[0].id;
        }
      }
      const targetGrupo = materia.grupo_id || grupoParam || null;
      const [dirOk] = targetGrupo
        ? await conn.query(
            `SELECT id FROM grupos WHERE id = ? AND director_id = ? AND activo = TRUE`,
            [targetGrupo, req.usuario.id]
          )
        : [[]];
      if (req.usuario.rol === 'docente' && !dirOk.length) {
        await conn.rollback();
        return res.status(403).json({ ok: false, mensaje: 'Solo puedes asignar profesores a las materias de tu propio curso o siendo administrador.' });
      }
      if (!['admin', 'superadmin'].includes(req.usuario.rol) && req.usuario.rol !== 'docente') {
        await conn.rollback();
        return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para asignar profesores.' });
      }
    }
    // Un docente-director siempre asigna a su curso; no puede elegir otro.
    if (req.usuario.rol === 'docente') {
      const [dirRows] = await conn.query(
        `SELECT id FROM grupos WHERE director_id = ? AND activo = TRUE LIMIT 1`,
        [req.usuario.id]
      );
      grupoParam = dirRows.length ? dirRows[0].id : null;
      if (materia.grupo_id && materia.grupo_id !== grupoParam) {
        await conn.rollback();
        return res.status(403).json({ ok: false, mensaje: 'Solo puedes asignar profesores a las materias de tu propio curso.' });
      }
    }

    let grupoId = materia.grupo_id || grupoParam || null;
    if (grupoParam && !materia.grupo_id) {
      const [grupoRows] = await conn.query(
        `SELECT g.id FROM grupos g
         JOIN grados gr ON gr.id = g.grado_id
         WHERE g.id = ? AND gr.institucion_id = ?`,
        [grupoParam, req.usuario.institucion_id]
      );
      if (!grupoRows.length) {
        await conn.rollback();
        return res.status(400).json({ ok: false, mensaje: 'Ese curso no existe en tu institución.' });
      }
    }

    const [docenteRows] = await conn.query(
      `SELECT id FROM usuarios WHERE id = ? AND institucion_id = ? AND rol = 'docente' AND activo = TRUE`,
      [docente_id, req.usuario.institucion_id]
    );
    if (!docenteRows.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'Ese docente no pertenece a tu institución.' });
    }

    await _sincronizarDocenteMateria(conn, {
      docenteId: docente_id, materiaId: req.params.id, grupoId, institucionId: req.usuario.institucion_id,
    });

    await conn.commit();
    return res.status(201).json({ ok: true, mensaje: 'Profesor agregado a la materia.' });
  } catch (err) {
    await conn.rollback();
    if (err.siaCode === 'SIN_PERIODOS') {
      return res.status(409).json({ ok: false, mensaje: 'Tu institución todavía no tiene ningún periodo académico creado.' });
    }
    console.error('agregarDocenteMateria:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    conn.release();
  }
};

// DELETE /api/academico/materias/:id/docentes/:docenteId
// No se puede quitar al único profesor de una materia — hay que
// asignar otro primero, o eliminar la materia completa.
exports.quitarDocenteMateria = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const materia = await _materiaAccesible(conn, req.params.id, req.usuario.institucion_id);
    if (!materia) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'Materia no encontrada.' });
    }
    if (!(await _esDirectorDeMateria(conn, materia, req.usuario))) {
      await conn.rollback();
      return res.status(403).json({ ok: false, mensaje: 'Solo puedes quitar profesores de las materias de tu propio curso o siendo administrador.' });
    }

    // Como la asignación puede ser (materia, curso) o general (sin curso),
    // grupo_id en null significa "la asignación general de la materia".
    const grupoId = req.query.grupo_id || materia.grupo_id || null;

    const [countRows] = await conn.query(
      `SELECT COUNT(DISTINCT docente_id) AS total FROM docentes_materias
       WHERE materia_id = ? AND (grupo_id = ? OR (grupo_id IS NULL AND ? IS NULL))`,
      [req.params.id, grupoId, grupoId]
    );
    if (countRows[0].total <= 1) {
      await conn.rollback();
      return res.status(409).json({ ok: false, mensaje: 'No puedes quitar al único profesor de esta materia. Asigna otro primero, o elimina la materia.' });
    }

    await conn.query(
      `DELETE FROM docentes_materias
       WHERE materia_id = ? AND docente_id = ? AND (grupo_id = ? OR (grupo_id IS NULL AND ? IS NULL))`,
      [req.params.id, req.params.docenteId, grupoId, grupoId]
    );

    await conn.commit();
    return res.json({ ok: true, mensaje: 'Profesor quitado de la materia.' });
  } catch (err) {
    await conn.rollback();
    console.error('quitarDocenteMateria:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    conn.release();
  }
};

// ────────────────────────────────────────────────────────────
//  PERIODOS ACADÉMICOS
//  Cada institución define su propia cantidad de periodos, con
//  nombre libre (no se asume que siempre son 3/trimestral).
//  Las fechas se dejan traslapar (solo se avisa) y el "cierre"
//  al llegar fecha_fin es solo informativo/visual: no bloquea
//  el registro de notas nuevas en ese periodo.
// ────────────────────────────────────────────────────────────

function validarPeriodo({ nombre, anio_lectivo, numero_periodo, fecha_inicio, fecha_fin }) {
  if (!nombre || !String(nombre).trim()) return 'El nombre del periodo es obligatorio.';
  if (!anio_lectivo || !Number.isInteger(Number(anio_lectivo))) return 'El año lectivo es obligatorio.';
  if (!numero_periodo || !Number.isInteger(Number(numero_periodo)) || Number(numero_periodo) < 1) {
    return 'El número de periodo debe ser un entero mayor o igual a 1.';
  }
  if (!fecha_inicio || !fecha_fin) return 'Fecha de inicio y fecha de fin son obligatorias.';
  if (new Date(fecha_fin) <= new Date(fecha_inicio)) return 'La fecha de fin debe ser posterior a la fecha de inicio.';
  return null;
}

// Traslapes: se permiten, solo se devuelven como advertencia (no bloquean).
async function periodosTraslapados(conn, institucionId, fechaInicio, fechaFin, excluirId = null) {
  let sql = `
    SELECT id, nombre, anio_lectivo, numero_periodo, fecha_inicio, fecha_fin
    FROM periodos_academicos
    WHERE institucion_id = ? AND fecha_inicio <= ? AND fecha_fin >= ?`;
  const params = [institucionId, fechaFin, fechaInicio];
  if (excluirId) { sql += ` AND id != ?`; params.push(excluirId); }
  const [rows] = await conn.query(sql, params);
  return rows;
}

// GET /api/academico/periodos?anio_lectivo=2026
exports.listarPeriodos = async (req, res) => {
  const { anio_lectivo } = req.query;
  try {
    let sql = `
      SELECT id, nombre, anio_lectivo, numero_periodo, fecha_inicio, fecha_fin, activo, created_at
      FROM periodos_academicos
      WHERE institucion_id = ?`;
    const params = [req.usuario.institucion_id];
    if (anio_lectivo) { sql += ` AND anio_lectivo = ?`; params.push(anio_lectivo); }
    sql += ` ORDER BY anio_lectivo DESC, numero_periodo ASC`;

    const [rows] = await pool.query(sql, params);
    return res.json({ ok: true, total: rows.length, periodos: rows });
  } catch (err) {
    console.error('listarPeriodos:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// POST /api/academico/periodos
// Acepta un solo periodo en el body, o { periodos: [ {...}, {...} ] }
// para crear varios de una vez (ej. los 3 trimestres del año).
exports.crearPeriodos = async (req, res) => {
  const lista = Array.isArray(req.body.periodos) ? req.body.periodos : [req.body];

  if (!lista.length) {
    return res.status(400).json({ ok: false, mensaje: 'No se recibió ningún periodo para crear.' });
  }
  for (const p of lista) {
    const error = validarPeriodo(p);
    if (error) return res.status(400).json({ ok: false, mensaje: error });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const creados = [];

    for (const p of lista) {
      const traslapes = await periodosTraslapados(conn, req.usuario.institucion_id, p.fecha_inicio, p.fecha_fin);
      if (traslapes.length) {
        await conn.rollback();
        return res.status(400).json({
          ok: false,
          mensaje: `"${p.nombre}" se traslapa con: ` +
            traslapes.map(t => `"${t.nombre}" (${t.fecha_inicio instanceof Date ? t.fecha_inicio.toISOString().slice(0,10) : String(t.fecha_inicio)} a ${t.fecha_fin instanceof Date ? t.fecha_fin.toISOString().slice(0,10) : String(t.fecha_fin)})`).join(', ') +
            `. Los periodos no pueden traslaparse.`,
        });
      }

      const id = randomUUID();
      await conn.query(
        `INSERT INTO periodos_academicos (id, institucion_id, nombre, anio_lectivo, numero_periodo, fecha_inicio, fecha_fin)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, req.usuario.institucion_id, String(p.nombre).trim(), p.anio_lectivo, p.numero_periodo, p.fecha_inicio, p.fecha_fin]
      );
      creados.push({ id, nombre: p.nombre });
    }

    await conn.commit();
    return res.status(201).json({
      ok: true,
      mensaje: creados.length > 1 ? `${creados.length} periodos creados.` : 'Periodo creado.',
      periodos: creados,
    });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        ok: false,
        mensaje: 'Ya existe un periodo con ese año lectivo y número de periodo en tu institución.',
      });
    }
    console.error('crearPeriodos:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    conn.release();
  }
};

// PUT /api/academico/periodos/:id
exports.actualizarPeriodo = async (req, res) => {
  const { nombre, anio_lectivo, numero_periodo, fecha_inicio, fecha_fin } = req.body;
  const conn = await pool.getConnection();

  try {
    const [actualRows] = await conn.query(
      `SELECT * FROM periodos_academicos WHERE id = ? AND institucion_id = ?`,
      [req.params.id, req.usuario.institucion_id]
    );
    if (!actualRows.length) {
      conn.release();
      return res.status(404).json({ ok: false, mensaje: 'Periodo no encontrado.' });
    }
    const actual = actualRows[0];

    const nuevaFechaInicio = fecha_inicio || actual.fecha_inicio;
    const nuevaFechaFin    = fecha_fin    || actual.fecha_fin;
    if (new Date(nuevaFechaFin) <= new Date(nuevaFechaInicio)) {
      conn.release();
      return res.status(400).json({ ok: false, mensaje: 'La fecha de fin debe ser posterior a la fecha de inicio.' });
    }

    if (fecha_inicio || fecha_fin) {
      const traslapes = await periodosTraslapados(conn, req.usuario.institucion_id, nuevaFechaInicio, nuevaFechaFin, req.params.id);
      if (traslapes.length) {
        conn.release();
        return res.status(400).json({
          ok: false,
          mensaje: `El periodo se traslapa con: ${traslapes.map(t => `"${t.nombre}"`).join(', ')}. Los periodos no pueden traslaparse.`,
        });
      }
    }

    const [result] = await conn.query(
      `UPDATE periodos_academicos
       SET nombre = COALESCE(?, nombre),
           anio_lectivo = COALESCE(?, anio_lectivo),
           numero_periodo = COALESCE(?, numero_periodo),
           fecha_inicio = COALESCE(?, fecha_inicio),
           fecha_fin = COALESCE(?, fecha_fin)
       WHERE id = ? AND institucion_id = ?`,
      [nombre, anio_lectivo, numero_periodo, fecha_inicio, fecha_fin, req.params.id, req.usuario.institucion_id]
    );
    conn.release();

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Periodo no encontrado.' });
    }
    return res.json({ ok: true, mensaje: 'Periodo actualizado.' });
  } catch (err) {
    conn.release();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        ok: false,
        mensaje: 'Ya existe un periodo con ese año lectivo y número de periodo en tu institución.',
      });
    }
    console.error('actualizarPeriodo:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// PUT /api/academico/periodos/:id/activar
// Marca este periodo como "el periodo actual" y desactiva los demás
// de la institución (activo es informativo: no bloquea notas en los
// periodos que queden inactivos).
exports.activarPeriodo = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [existe] = await conn.query(
      `SELECT id FROM periodos_academicos WHERE id = ? AND institucion_id = ?`,
      [req.params.id, req.usuario.institucion_id]
    );
    if (!existe.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'Periodo no encontrado.' });
    }

    await conn.query(
      `UPDATE periodos_academicos SET activo = FALSE WHERE institucion_id = ?`,
      [req.usuario.institucion_id]
    );
    await conn.query(
      `UPDATE periodos_academicos SET activo = TRUE WHERE id = ?`,
      [req.params.id]
    );

    await conn.commit();
    return res.json({ ok: true, mensaje: 'Periodo marcado como activo.' });
  } catch (err) {
    await conn.rollback();
    console.error('activarPeriodo:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    conn.release();
  }
};

// DELETE /api/academico/periodos/:id
// Borrado real (no soft-delete, tiene poco sentido ocultar un periodo
// del calendario). Si ya tiene notas/tareas/horarios asociados, la
// base de datos rechaza el borrado (FK sin CASCADE) y se avisa.
exports.eliminarPeriodo = async (req, res) => {
  try {
    const [result] = await pool.query(
      `DELETE FROM periodos_academicos WHERE id = ? AND institucion_id = ?`,
      [req.params.id, req.usuario.institucion_id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Periodo no encontrado.' });
    }
    return res.json({ ok: true, mensaje: 'Periodo eliminado.' });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
      return res.status(409).json({
        ok: false,
        mensaje: 'No se puede eliminar: este periodo ya tiene notas, tareas u horarios registrados. Puedes editar sus fechas en vez de borrarlo.',
      });
    }
    console.error('eliminarPeriodo:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  HORARIOS (parrilla semanal por curso)
//  Tabla `horarios`: una fila por franja (materia desde
//  hora_inicio a hora_fin, en un dia_semana, del grupo).
//  La franja queda ligada al periodo activo de la institución.
// ────────────────────────────────────────────────────────────

// Valida que el grupo pertenece a la institución del usuario y
// devuelve su fila, o null. También sirve para autorizar al
// director de curso (que no tiene rol admin pero sí dirige el grupo).
async function _esMiGrupo(poolRef, grupoId, usuario) {
  const [rows] = await poolRef.query(
    `SELECT g.*, gr.nombre AS grado_nombre
     FROM grupos g
     JOIN grados gr ON gr.id = g.grado_id
     WHERE g.id = ? AND gr.institucion_id = ?`,
    [grupoId, usuario.institucion_id]
  );
  if (!rows.length) return null;
  const g = rows[0];
  const esAdmin = ['admin', 'superadmin'].includes(usuario.rol);
  const esDirector = usuario.rol === 'docente' && g.director_id === usuario.id;
  if (!esAdmin && !esDirector) return null;
  return g;
}

// Autorización para ver/editar un horario: admin/superadmin o el
// director del curso. Devuelve el grupo o null con el motivo.
function _autorizarHorario(grupo, usuario) {
  const esAdmin = ['admin', 'superadmin'].includes(usuario.rol);
  const esDirector = usuario.rol === 'docente' && grupo.director_id === usuario.id;
  if (!esAdmin && !esDirector) {
    return { ok: false, code: 403, mensaje: 'Solo el director del curso o un administrador puede gestionar el horario.' };
  }
  return { ok: true };
}

// GET /api/academico/horario?grupo_id=
// Devuelve todas las franjas del grupo con nombres amigables.
exports.listarHorario = async (req, res) => {
  const { grupo_id } = req.query;
  if (!grupo_id) return res.status(400).json({ ok: false, mensaje: 'grupo_id es obligatorio.' });

  try {
    const grupo = await _esMiGrupo(pool, grupo_id, req.usuario);
    if (!grupo) return res.status(404).json({ ok: false, mensaje: 'Curso no encontrado en tu institución.' });

    const [rows] = await pool.query(
      `SELECT h.id, h.grupo_id, h.dia_semana, h.hora_inicio, h.hora_fin, h.aula,
              h.materia_id, m.nombre AS materia_nombre, a.color_hex,
              h.docente_id, CONCAT(u.nombres, ' ', u.apellidos) AS docente_nombre,
              h.periodo_id, p.nombre AS periodo_nombre, p.anio_lectivo
       FROM horarios h
       JOIN materias m ON m.id = h.materia_id
       JOIN areas a ON a.id = m.area_id
       JOIN usuarios u ON u.id = h.docente_id
       LEFT JOIN periodos_academicos p ON p.id = h.periodo_id
       WHERE h.grupo_id = ?
       ORDER BY h.dia_semana ASC, h.hora_inicio ASC`,
      [grupo_id]
    );
    return res.json({ ok: true, grupo: { id: grupo.id, nombre: grupo.nombre, grado_nombre: grupo.grado_nombre }, franjas: rows });
  } catch (err) {
    console.error('listarHorario:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// GET /api/academico/horario/materias?grupo_id=
// Materias del curso (con sus docentes) para poblar el editor del
// horario. Incluye las materias del curso más las "generales" de la
// institución (sin curso), que el admin crea desde Materias.
exports.listarMateriasHorario = async (req, res) => {
  const { grupo_id } = req.query;
  if (!grupo_id) return res.status(400).json({ ok: false, mensaje: 'grupo_id es obligatorio.' });

  try {
    const grupo = await _esMiGrupo(pool, grupo_id, req.usuario);
    if (!grupo) return res.status(404).json({ ok: false, mensaje: 'Curso no encontrado en tu institución.' });

    const [materias] = await pool.query(
      `SELECT m.id, m.nombre, a.color_hex, m.grupo_id
       FROM materias m
       JOIN areas a ON a.id = m.area_id
       WHERE m.institucion_id = ?
         AND m.activa = TRUE
         AND (m.grupo_id = ? OR m.grupo_id IS NULL)
       ORDER BY (m.grupo_id = ?) DESC, m.nombre ASC`,
      [req.usuario.institucion_id, grupo_id, grupo_id]
    );

    // Un solo query para todos los docentes de todas las materias del
    // curso (IN), en vez de una consulta por materia (N+1).
    let conDocentes = materias;
    if (materias.length) {
      const [docs] = await pool.query(
        `SELECT dm.materia_id, dm.docente_id, CONCAT(u.nombres, ' ', u.apellidos) AS docente_nombre
         FROM docentes_materias dm
         JOIN usuarios u ON u.id = dm.docente_id
         WHERE dm.materia_id IN (${materias.map(() => '?').join(',')})
         GROUP BY dm.materia_id, dm.docente_id, u.nombres, u.apellidos`,
        materias.map(m => m.id)
      );
      const porMateria = new Map();
      for (const d of docs) {
        if (!porMateria.has(d.materia_id)) porMateria.set(d.materia_id, []);
        porMateria.get(d.materia_id).push({ docente_id: d.docente_id, docente_nombre: d.docente_nombre });
      }
      conDocentes = materias.map(m => ({
        ...m,
        docente_id: porMateria.get(m.id)?.[0]?.docente_id ?? null,
        docentes: porMateria.get(m.id) || [],
      }));
    }
    return res.json({ ok: true, materias: conDocentes });
  } catch (err) {
    console.error('listarMateriasHorario:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// POST /api/academico/horario
// Crea una franja: { grupo_id, materia_id, docente_id?, dia_semana,
//                    hora_inicio, hora_fin, aula? }
exports.crearHorario = async (req, res) => {
  const { grupo_id, materia_id, docente_id, dia_semana, hora_inicio, hora_fin, aula } = req.body;

  if (!grupo_id || !materia_id) {
    return res.status(400).json({ ok: false, mensaje: 'curso y materia son obligatorios.' });
  }
  const dia = Number(dia_semana);
  if (!Number.isInteger(dia) || dia < 1 || dia > 7) {
    return res.status(400).json({ ok: false, mensaje: 'Escoge un día válido (1=lunes ... 7=domingo).' });
  }
  if (!hora_inicio || !hora_fin) {
    return res.status(400).json({ ok: false, mensaje: 'hora de inicio y hora de fin son obligatorias.' });
  }
  const hi = hora_inicio.slice ? hora_inicio : String(hora_inicio).padStart(5, '0');
  const hf = hora_fin.slice ? hora_fin : String(hora_fin).padStart(5, '0');
  if (hi >= hf) {
    return res.status(400).json({ ok: false, mensaje: 'La hora de fin debe ser mayor a la hora de inicio.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const grupo = await _esMiGrupo(conn, grupo_id, req.usuario);
    if (!grupo) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'Curso no encontrado en tu institución.' });
    }
    const autoriz = _autorizarHorario(grupo, req.usuario);
    if (!autoriz.ok) {
      await conn.rollback();
      return res.status(autoriz.code).json({ ok: false, mensaje: autoriz.mensaje });
    }

    // La materia debe pertenecer al curso o ser una materia general de
    // esta institución (sin curso, creada por el admin).
    const [mat] = await conn.query(
      `SELECT m.id FROM materias m
       WHERE m.id = ? AND m.institucion_id = ? AND m.activa = TRUE
         AND (m.grupo_id = ? OR m.grupo_id IS NULL)`,
      [materia_id, req.usuario.institucion_id, grupo_id]
    );
    if (!mat.length) {
      await conn.rollback();
      return res.status(400).json({ ok: false, mensaje: 'Esa materia no pertenece al curso ni es una materia general de la institución.' });
    }

    // Periodo activo (obligatorio para poder guardar)
    const periodos = await _periodosVigentes(conn, req.usuario.institucion_id);
    if (!periodos.length) {
      await conn.rollback();
      return res.status(409).json({ ok: false, mensaje: 'Tu institución todavía no tiene ningún periodo académico. Crea uno primero en la pestaña "Periodos".' });
    }
    // Usa el primer periodo del año vigente (suele ser el activo)
    const periodoId = periodos[0].id;

    // Docente: si no viene, usa el primer docente asignado a la materia
    // (en el curso o como general). Si viene, debe estar asignado.
    let docId = docente_id || null;
    if (!docId) {
      const [dms] = await conn.query(
        `SELECT docente_id FROM docentes_materias
         WHERE materia_id = ? AND (grupo_id = ? OR grupo_id IS NULL)
         LIMIT 1`,
        [materia_id, grupo_id]
      );
      docId = dms.length ? dms[0].docente_id : null;
    }
    if (!docId) {
      await conn.rollback();
      return res.status(400).json({ ok: false, mensaje: 'La materia no tiene profesor asignado. Asígnalo desde la pestaña Materias.' });
    }
    if (docente_id) {
      const [asig] = await conn.query(
        `SELECT 1 FROM docentes_materias
         WHERE materia_id = ? AND docente_id = ? AND (grupo_id = ? OR grupo_id IS NULL)
         LIMIT 1`,
        [materia_id, docente_id, grupo_id]
      );
      if (!asig.length) {
        await conn.rollback();
        return res.status(400).json({ ok: false, mensaje: 'Ese profesor no está asignado a la materia. Asígnalo desde la pestaña Materias.' });
      }
    }

    // Regla del Punto 1: el director NO inventa horas; debe usar una
    // hora ya definida en la plantilla de la institución (los admin
    // definen la plantilla y sí pueden ajustar manualmente).
    if (!['admin', 'superadmin'].includes(req.usuario.rol)) {
      const [plantilla] = await conn.query(
        `SELECT hora_inicio, hora_fin FROM horario_horas
         WHERE institucion_id = ? AND dia_semana = ? AND hora_inicio = ? AND hora_fin = ?`,
        [req.usuario.institucion_id, dia, hi, hf]
      );
      if (!plantilla.length) {
        await conn.rollback();
        return res.status(400).json({ ok: false, mensaje: 'Ese bloque horario no existe en las horas de trabajo de la institución. El administrador debe definirlo primero en "Horario > Horas de trabajo".' });
      }
    }

    const id = randomUUID();
    await conn.query(
      `INSERT INTO horarios (id, grupo_id, materia_id, docente_id, dia_semana, hora_inicio, hora_fin, aula, periodo_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, grupo_id, materia_id, docId, dia, hi, hf, aula || null, periodoId]
    );

    await conn.commit();
    return res.status(201).json({ ok: true, mensaje: 'Franja agregada al horario.', id });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, mensaje: 'Ya existe una franja que empieza a esa misma hora en ese día. Elige otro horario de inicio.' });
    }
    console.error('crearHorario:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    conn.release();
  }
};

// PUT /api/academico/horario/:id
exports.actualizarHorario = async (req, res) => {
  const { materia_id, docente_id, dia_semana, hora_inicio, hora_fin, aula } = req.body;

  try {
    // Buscar la franja y su grupo (para validar permiso del director)
    const [filaRows] = await pool.query(
      `SELECT h.*, g.director_id, g.id AS grupo_id
       FROM horarios h
       JOIN grupos g ON g.id = h.grupo_id
       JOIN grados gr ON gr.id = g.grado_id
       WHERE h.id = ? AND gr.institucion_id = ?`,
      [req.params.id, req.usuario.institucion_id]
    );
    if (!filaRows.length) return res.status(404).json({ ok: false, mensaje: 'Franja no encontrada.' });

    const fila = filaRows[0];
    const grupo = { id: fila.grupo_id, director_id: fila.director_id, rol: req.usuario.rol };
    const autoriz = _autorizarHorario(grupo, req.usuario);
    if (!autoriz.ok) return res.status(autoriz.code).json({ ok: false, mensaje: autoriz.mensaje });

    const dia = dia_semana !== undefined ? Number(dia_semana) : fila.dia_semana;
    if (!Number.isInteger(dia) || dia < 1 || dia > 7) {
      return res.status(400).json({ ok: false, mensaje: 'Día inválido.' });
    }
    const hi = hora_inicio !== undefined ? (hora_inicio.slice ? hora_inicio : String(hora_inicio).padStart(5, '0')) : fila.hora_inicio;
    const hf = hora_fin !== undefined ? (hora_fin.slice ? hora_fin : String(hora_fin).padStart(5, '0')) : fila.hora_fin;
    if (hi >= hf) return res.status(400).json({ ok: false, mensaje: 'La hora de fin debe ser mayor a la hora de inicio.' });

    // Regla del Punto 1: el director solo puede usar horas de la plantilla.
    if (!['admin', 'superadmin'].includes(req.usuario.rol)) {
      const [plantilla] = await pool.query(
        `SELECT hora_inicio, hora_fin FROM horario_horas
         WHERE institucion_id = ? AND dia_semana = ? AND hora_inicio = ? AND hora_fin = ?`,
        [req.usuario.institucion_id, dia, hi, hf]
      );
      if (!plantilla.length) {
        return res.status(400).json({ ok: false, mensaje: 'Ese bloque horario no existe en las horas de trabajo de la institución. El administrador debe definirlo primero en "Horario > Horas de trabajo".' });
      }
    }

    // Si cambia la materia, validar que pertenece al mismo grupo o es
    // una materia general de la institución
    let newMateria = materia_id !== undefined ? materia_id : fila.materia_id;
    if (materia_id && materia_id !== fila.materia_id) {
      const [mat] = await pool.query(
        `SELECT id FROM materias
         WHERE id = ? AND institucion_id = ? AND activa = TRUE
           AND (grupo_id = ? OR grupo_id IS NULL)`,
        [materia_id, req.usuario.institucion_id, fila.grupo_id]
      );
      if (!mat.length) return res.status(400).json({ ok: false, mensaje: 'Esa materia no pertenece al curso ni es una materia general de la institución.' });
    }

    const nuevoDocente = docente_id !== undefined ? docente_id : fila.docente_id;

    // El docente de la franja debe estar asignado a la materia resultante.
    const [asig] = await pool.query(
      `SELECT 1 FROM docentes_materias
       WHERE materia_id = ? AND docente_id = ? AND (grupo_id = ? OR grupo_id IS NULL)
       LIMIT 1`,
      [newMateria, nuevoDocente, fila.grupo_id]
    );
    if (!asig.length) {
      return res.status(400).json({ ok: false, mensaje: 'Ese profesor no está asignado a la materia. Asígnalo desde la pestaña Materias.' });
    }

    const [result] = await pool.query(
      `UPDATE horarios
       SET materia_id = ?, docente_id = ?, dia_semana = ?, hora_inicio = ?, hora_fin = ?, aula = ?
       WHERE id = ?`,
      [newMateria, nuevoDocente, dia, hi, hf, aula !== undefined ? aula : fila.aula, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ ok: false, mensaje: 'Franja no encontrada.' });
    return res.json({ ok: true, mensaje: 'Franja actualizada.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, mensaje: 'Ya existe una franja que empieza a esa misma hora en ese día. Elige otro horario de inicio.' });
    }
    console.error('actualizarHorario:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// DELETE /api/academico/horario/:id
exports.eliminarHorario = async (req, res) => {
  try {
    const [filaRows] = await pool.query(
      `SELECT h.*, g.director_id, g.id AS grupo_id
       FROM horarios h
       JOIN grupos g ON g.id = h.grupo_id
       JOIN grados gr ON gr.id = g.grado_id
       WHERE h.id = ? AND gr.institucion_id = ?`,
      [req.params.id, req.usuario.institucion_id]
    );
    if (!filaRows.length) return res.status(404).json({ ok: false, mensaje: 'Franja no encontrada.' });

    const fila = filaRows[0];
    const grupo = { id: fila.grupo_id, director_id: fila.director_id, rol: req.usuario.rol };
    const autoriz = _autorizarHorario(grupo, req.usuario);
    if (!autoriz.ok) return res.status(autoriz.code).json({ ok: false, mensaje: autoriz.mensaje });

    await pool.query(`DELETE FROM horarios WHERE id = ?`, [req.params.id]);
    return res.json({ ok: true, mensaje: 'Franja eliminada del horario.' });
  } catch (err) {
    console.error('eliminarHorario:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ============================================================
//  Plantilla global de horas de trabajo de la institución
//  (Punto 1 del ROADMAP, 2026-09-02)
//    - El ADMIN define las horas en las que se trabaja.
//    - El DIRECTOR asigna materias por hora sin inventar horas.
// ============================================================

const DIAS_NOMBRE = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

// GET /api/academico/horario/horas?dia_semana=
// Horas planteadas de la institución (admin y director la leen).
exports.listarHorasInstitucion = async (req, res) => {
  const { dia_semana } = req.query;
  try {
    let sql = `
      SELECT h.id, h.dia_semana, h.hora_inicio, h.hora_fin
      FROM horario_horas h
      WHERE h.institucion_id = ?`;
    const params = [req.usuario.institucion_id];
    if (dia_semana) { sql += ` AND h.dia_semana = ?`; params.push(Number(dia_semana)); }
    sql += ` ORDER BY h.dia_semana ASC, h.hora_inicio ASC`;

    const [rows] = await pool.query(sql, params);
    // Formatear como HH:MM (mysql2 devuelve TIME como "HH:MM:SS")
    const horas = rows.map(r => ({
      ...r,
      hora_inicio: r.hora_inicio ? String(r.hora_inicio).slice(0, 5) : r.hora_inicio,
      hora_fin:    r.hora_fin    ? String(r.hora_fin).slice(0, 5)    : r.hora_fin,
      dia_nombre: DIAS_NOMBRE[Number(r.dia_semana)] || '',
    }));
    return res.json({ ok: true, horas });
  } catch (err) {
    console.error('listarHorasInstitucion:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// POST /api/academico/horario/horas
// { dia_semana, hora_inicio, hora_fin }
exports.crearHoraInstitucion = async (req, res) => {
  const { dia_semana, hora_inicio, hora_fin } = req.body;
  return _guardarHoraInstitucion(req, res, null, dia_semana, hora_inicio, hora_fin);
};

// PUT /api/academico/horario/horas/:id
exports.actualizarHoraInstitucion = async (req, res) => {
  const { dia_semana, hora_inicio, hora_fin } = req.body;
  return _guardarHoraInstitucion(req, res, req.params.id, dia_semana, hora_inicio, hora_fin);
};

// Helper de crear/actualizar hora institucional
async function _guardarHoraInstitucion(req, res, id, dia_semana, hora_inicio, hora_fin) {
  const dia = Number(dia_semana);
  if (!Number.isInteger(dia) || dia < 1 || dia > 7) {
    return res.status(400).json({ ok: false, mensaje: 'Escoge un día válido (1=lunes ... 7=domingo).' });
  }
  if (!hora_inicio || !hora_fin) {
    return res.status(400).json({ ok: false, mensaje: 'hora de inicio y hora de fin son obligatorias.' });
  }
  const hi = hora_inicio.slice ? hora_inicio.slice(0, 5) : String(hora_inicio).padStart(5, '0');
  const hf = hora_fin.slice ? hora_fin.slice(0, 5) : String(hora_fin).padStart(5, '0');
  if (hi >= hf) {
    return res.status(400).json({ ok: false, mensaje: 'La hora de fin debe ser mayor a la hora de inicio.' });
  }

  try {
    if (id) {
      const [result] = await pool.query(
        `UPDATE horario_horas SET dia_semana = ?, hora_inicio = ?, hora_fin = ? WHERE id = ? AND institucion_id = ?`,
        [dia, hi, hf, id, req.usuario.institucion_id]
      );
      if (result.affectedRows === 0) return res.status(404).json({ ok: false, mensaje: 'Hora no encontrada.' });
      return res.json({ ok: true, mensaje: 'Hora actualizada.' });
    }

    const newId = randomUUID();
    await pool.query(
      `INSERT INTO horario_horas (id, institucion_id, dia_semana, hora_inicio, hora_fin)
       VALUES (?, ?, ?, ?, ?)`,
      [newId, req.usuario.institucion_id, dia, hi, hf]
    );
    return res.status(201).json({ ok: true, mensaje: 'Hora agregada a la plantilla.', id: newId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, mensaje: 'Ya existe una hora que empieza a esa misma hora en ese día.' });
    }
    console.error('_guardarHoraInstitucion:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
}

// DELETE /api/academico/horario/horas/:id
exports.eliminarHoraInstitucion = async (req, res) => {
  try {
    const [result] = await pool.query(
      `DELETE FROM horario_horas WHERE id = ? AND institucion_id = ?`,
      [req.params.id, req.usuario.institucion_id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ ok: false, mensaje: 'Hora no encontrada.' });
    return res.json({ ok: true, mensaje: 'Hora eliminada de la plantilla.' });
  } catch (err) {
    console.error('eliminarHoraInstitucion:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};