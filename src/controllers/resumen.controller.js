// ============================================================
//  resumen.controller.js — MySQL
//  Vista agregada "por curso" que necesita el director de curso
//  (y el admin/superadmin): fallas totales + promedio general de
//  cada estudiante combinando TODAS las materias del curso, y el
//  desglose materia por materia de un estudiante puntual.
//
//  Regla de negocio confirmada por el usuario (2026-08-17):
//  el promedio general de un estudiante es el promedio SIMPLE de
//  sus promedios por materia (todas las materias pesan igual, no
//  se pondera por horas semanales ni nada más).
// ============================================================

const pool = require('../config/db');

// Devuelve el grado_id/institucion_id de un grupo, o null si no existe.
async function datosGrupo(grupoId) {
  const [rows] = await pool.query(
    `SELECT g.id, gr.institucion_id
     FROM grupos g JOIN grados gr ON gr.id = g.grado_id
     WHERE g.id = ?`,
    [grupoId]
  );
  return rows.length ? rows[0] : null;
}

// admin/superadmin de la institución, o el docente director de ESE grupo.
async function puedeVerResumenCurso(req, grupo) {
  if (!grupo) return false;
  if (req.usuario.rol === 'superadmin') return true;
  if (req.usuario.rol === 'admin') return grupo.institucion_id === req.usuario.institucion_id;
  if (req.usuario.rol === 'docente') {
    const [rows] = await pool.query(
      `SELECT 1 FROM grupos WHERE id = ? AND director_id = ?`,
      [grupo.id, req.usuario.id]
    );
    return rows.length > 0;
  }
  return false;
}

// Devuelve la materia junto con su grupo/institución, o null si no existe.
async function datosMateria(materiaId) {
  const [rows] = await pool.query(
    `SELECT m.id, m.grupo_id, gr.institucion_id
     FROM materias m
     JOIN grupos g ON g.id = m.grupo_id
     JOIN grados gr ON gr.id = g.grado_id
     WHERE m.id = ?`,
    [materiaId]
  );
  return rows.length ? rows[0] : null;
}

// admin/superadmin de la institución, el docente que dicta esa materia
// puntual, o el docente director del curso al que pertenece (aunque no
// la dicte).
async function puedeVerResumenMateria(req, materia) {
  if (!materia) return false;
  if (req.usuario.rol === 'superadmin') return true;
  if (req.usuario.rol === 'admin') return materia.institucion_id === req.usuario.institucion_id;
  if (req.usuario.rol === 'docente') {
    const [dicta] = await pool.query(
      `SELECT 1 FROM docentes_materias WHERE materia_id = ? AND docente_id = ?`,
      [materia.id, req.usuario.id]
    );
    if (dicta.length > 0) return true;
    const [director] = await pool.query(
      `SELECT 1 FROM grupos WHERE id = ? AND director_id = ?`,
      [materia.grupo_id, req.usuario.id]
    );
    return director.length > 0;
  }
  return false;
}

// Si no mandan periodo_id, se usa el periodo marcado como activo de la
// institución (mismo criterio que al asignar docentes a materias).
async function resolverPeriodoId(periodoIdQuery, institucionId) {
  if (periodoIdQuery) return periodoIdQuery;
  const [rows] = await pool.query(
    `SELECT id FROM periodos_academicos WHERE institucion_id = ? AND activo = TRUE LIMIT 1`,
    [institucionId]
  );
  return rows.length ? rows[0].id : null;
}

// Trae el rango de fechas del periodo (para filtrar asistencia, que no
// tiene periodo_id propio — se ubica por fecha dentro del rango).
async function rangoFechasPeriodo(periodoId) {
  if (!periodoId) return null;
  const [rows] = await pool.query(
    `SELECT fecha_inicio, fecha_fin FROM periodos_academicos WHERE id = ?`,
    [periodoId]
  );
  return rows.length ? rows[0] : null;
}

function promedioDesdeNotas(rows) {
  // rows: [{ valor, valor_max, peso_pct }]
  if (!rows.length) return { promedio: null, pesos: 0 };
  let ponderada = 0, pesos = 0;
  for (const n of rows) {
    ponderada += (Number(n.valor) / Number(n.valor_max)) * Number(n.peso_pct);
    pesos += Number(n.peso_pct);
  }
  return { promedio: pesos > 0 ? Number(((ponderada / pesos) * 10).toFixed(2)) : null, pesos };
}

// ────────────────────────────────────────────────────────────
//  GET /api/resumen/curso/:grupoId?periodo_id=
//  Fallas totales + promedio general por estudiante (todas las
//  materias del curso combinadas). Solo director del curso o admin.
// ────────────────────────────────────────────────────────────
exports.resumenCurso = async (req, res) => {
  const { grupoId } = req.params;

  try {
    const grupo = await datosGrupo(grupoId);
    if (!(await puedeVerResumenCurso(req, grupo))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para ver el resumen de este curso.' });
    }

    const periodoId = await resolverPeriodoId(req.query.periodo_id, grupo.institucion_id);
    if (!periodoId) {
      return res.status(409).json({ ok: false, mensaje: 'No hay ningún periodo académico activo ni creado. Crea uno primero.' });
    }
    const rango = await rangoFechasPeriodo(periodoId);
    const [perInfo] = await pool.query(
      `SELECT nombre, anio_lectivo FROM periodos_academicos WHERE id = ?`,
      [periodoId]
    );
    const periodoNombre = perInfo.length ? perInfo[0].nombre : null;
    const anioLectivo   = perInfo.length ? perInfo[0].anio_lectivo : null;

    const [estudiantes] = await pool.query(
      `SELECT u.id, u.nombres, u.apellidos
       FROM matriculas mt JOIN usuarios u ON u.id = mt.estudiante_id
       WHERE mt.grupo_id = ? AND mt.estado = 'activa'
       ORDER BY u.apellidos, u.nombres`,
      [grupoId]
    );
    if (!estudiantes.length) {
      return res.json({ ok: true, periodo_id: periodoId, periodo_nombre: periodoNombre, anio_lectivo: anioLectivo, total: 0, estudiantes: [], promedio_curso: null });
    }

    // Notas de todas las materias del curso, en el periodo pedido.
    const [notas] = await pool.query(
      `SELECT n.estudiante_id, n.materia_id, n.valor, n.valor_max, n.peso_pct
       FROM notas n JOIN materias m ON m.id = n.materia_id
       WHERE m.grupo_id = ? AND n.periodo_id = ?`,
      [grupoId, periodoId]
    );

    // Asistencia de todas las materias del curso, agrupada por estudiante y
    // estado (presente / tarde / ausente / excusado), acotada a las fechas
    // del periodo si se conocen.
    let sqlAsis = `
      SELECT a.estudiante_id, a.estado, COUNT(*) AS total
      FROM asistencia a JOIN materias m ON m.id = a.materia_id
      WHERE m.grupo_id = ?`;
    const paramsAsis = [grupoId];
    if (rango) {
      sqlAsis += ` AND a.fecha BETWEEN ? AND ?`;
      paramsAsis.push(rango.fecha_inicio, rango.fecha_fin);
    }
    sqlAsis += ` GROUP BY a.estudiante_id, a.estado`;
    const [asisRows] = await pool.query(sqlAsis, paramsAsis);
    const asistenciaPorEstudiante = {};
    for (const r of asisRows) {
      (asistenciaPorEstudiante[r.estudiante_id] ||= {})[r.estado] = r.total;
    }

    // Notas agrupadas por estudiante+materia → promedio por materia →
    // promedio simple entre materias (regla confirmada por el usuario).
    const porEstudianteMateria = {};
    for (const n of notas) {
      const key = `${n.estudiante_id}|${n.materia_id}`;
      if (!porEstudianteMateria[key]) porEstudianteMateria[key] = [];
      porEstudianteMateria[key].push(n);
    }
    const promediosPorMateria = {}; // estudiante_id -> [promedio_materia, ...]
    for (const key of Object.keys(porEstudianteMateria)) {
      const [estudianteId] = key.split('|');
      const { promedio } = promedioDesdeNotas(porEstudianteMateria[key]);
      if (promedio !== null) {
        (promediosPorMateria[estudianteId] ||= []).push(promedio);
      }
    }

    const resultado = estudiantes.map(e => {
      const lista = promediosPorMateria[e.id] || [];
      const promedioGeneral = lista.length
        ? Number((lista.reduce((a, b) => a + b, 0) / lista.length).toFixed(2))
        : null;
      const asis = asistenciaPorEstudiante[e.id] || {};
      return {
        estudiante_id: e.id,
        nombres: e.nombres,
        apellidos: e.apellidos,
        promedio_general: promedioGeneral,
        materias_con_notas: lista.length,
        fallas_totales: asis['ausente'] || 0,
        asistencia: {
          presentes: asis['presente'] || 0,
          retardos:  asis['tarde'] || 0,
          faltas:    asis['ausente'] || 0,
          justificadas: asis['excusado'] || 0,
        },
      };
    });

    const conPromedio = resultado.filter(r => r.promedio_general !== null);
    const promedioCurso = conPromedio.length
      ? Number((conPromedio.reduce((a, r) => a + r.promedio_general, 0) / conPromedio.length).toFixed(2))
      : null;

    return res.json({ ok: true, periodo_id: periodoId, periodo_nombre: periodoNombre, anio_lectivo: anioLectivo, total: resultado.length, estudiantes: resultado, promedio_curso: promedioCurso });
  } catch (err) {
    console.error('resumenCurso:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  GET /api/resumen/curso/:grupoId/estudiante/:estudianteId?periodo_id=
//  Desglose materia por materia (fallas + promedio) de un estudiante.
// ────────────────────────────────────────────────────────────
exports.resumenCursoEstudiante = async (req, res) => {
  const { grupoId, estudianteId } = req.params;

  try {
    const grupo = await datosGrupo(grupoId);
    if (!(await puedeVerResumenCurso(req, grupo))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para ver el resumen de este curso.' });
    }

    const periodoId = await resolverPeriodoId(req.query.periodo_id, grupo.institucion_id);
    if (!periodoId) {
      return res.status(409).json({ ok: false, mensaje: 'No hay ningún periodo académico activo ni creado. Crea uno primero.' });
    }
    const rango = await rangoFechasPeriodo(periodoId);

    const [matriculado] = await pool.query(
      `SELECT 1 FROM matriculas WHERE estudiante_id = ? AND grupo_id = ? AND estado = 'activa'`,
      [estudianteId, grupoId]
    );
    if (!matriculado.length) {
      return res.status(404).json({ ok: false, mensaje: 'Ese estudiante no está matriculado activo en este curso.' });
    }

    const [materias] = await pool.query(
      `SELECT m.id, m.nombre, a.nombre AS area_nombre, a.color_hex
       FROM materias m JOIN areas a ON a.id = m.area_id
       WHERE m.grupo_id = ? AND m.activa = TRUE
       ORDER BY a.nombre, m.nombre`,
      [grupoId]
    );

    const [notas] = await pool.query(
      `SELECT materia_id, valor, valor_max, peso_pct FROM notas
       WHERE estudiante_id = ? AND periodo_id = ?
         AND materia_id IN (SELECT id FROM materias WHERE grupo_id = ?)`,
      [estudianteId, periodoId, grupoId]
    );
    const notasPorMateria = {};
    for (const n of notas) (notasPorMateria[n.materia_id] ||= []).push(n);

    let sqlFallas = `
      SELECT materia_id, COUNT(*) AS fallas FROM asistencia
      WHERE estudiante_id = ? AND estado = 'ausente'
        AND materia_id IN (SELECT id FROM materias WHERE grupo_id = ?)`;
    const paramsFallas = [estudianteId, grupoId];
    if (rango) {
      sqlFallas += ` AND fecha BETWEEN ? AND ?`;
      paramsFallas.push(rango.fecha_inicio, rango.fecha_fin);
    }
    sqlFallas += ` GROUP BY materia_id`;
    const [fallasRows] = await pool.query(sqlFallas, paramsFallas);
    const fallasPorMateria = {};
    for (const f of fallasRows) fallasPorMateria[f.materia_id] = f.fallas;

    const desglose = materias.map(m => {
      const { promedio } = promedioDesdeNotas(notasPorMateria[m.id] || []);
      return {
        materia_id: m.id,
        materia_nombre: m.nombre,
        area_nombre: m.area_nombre,
        color_hex: m.color_hex,
        promedio,
        fallas: fallasPorMateria[m.id] || 0,
      };
    });

    return res.json({ ok: true, periodo_id: periodoId, materias: desglose });
  } catch (err) {
    console.error('resumenCursoEstudiante:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  GET /api/resumen/materia/:materiaId?periodo_id=
//  Fallas + promedio de cada estudiante matriculado en el curso de
//  esa materia puntual. Permiso: el docente que la dicta, el director
//  del curso (aunque no la dicte), o admin/superadmin.
// ────────────────────────────────────────────────────────────
exports.resumenMateria = async (req, res) => {
  const { materiaId } = req.params;

  try {
    const materia = await datosMateria(materiaId);
    if (!(await puedeVerResumenMateria(req, materia))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para ver el resumen de esta materia.' });
    }

    const periodoId = await resolverPeriodoId(req.query.periodo_id, materia.institucion_id);
    if (!periodoId) {
      return res.status(409).json({ ok: false, mensaje: 'No hay ningún periodo académico activo ni creado. Crea uno primero.' });
    }
    const rango = await rangoFechasPeriodo(periodoId);

    const [estudiantes] = await pool.query(
      `SELECT u.id, u.nombres, u.apellidos
       FROM matriculas mt JOIN usuarios u ON u.id = mt.estudiante_id
       WHERE mt.grupo_id = ? AND mt.estado = 'activa'
       ORDER BY u.apellidos, u.nombres`,
      [materia.grupo_id]
    );
    if (!estudiantes.length) {
      return res.json({ ok: true, periodo_id: periodoId, total: 0, estudiantes: [] });
    }

    const [notas] = await pool.query(
      `SELECT estudiante_id, valor, valor_max, peso_pct FROM notas
       WHERE materia_id = ? AND periodo_id = ?`,
      [materiaId, periodoId]
    );
    const notasPorEstudiante = {};
    for (const n of notas) (notasPorEstudiante[n.estudiante_id] ||= []).push(n);

    let sqlFallas = `
      SELECT estudiante_id, COUNT(*) AS fallas FROM asistencia
      WHERE materia_id = ? AND estado = 'ausente'`;
    const paramsFallas = [materiaId];
    if (rango) {
      sqlFallas += ` AND fecha BETWEEN ? AND ?`;
      paramsFallas.push(rango.fecha_inicio, rango.fecha_fin);
    }
    sqlFallas += ` GROUP BY estudiante_id`;
    const [fallasRows] = await pool.query(sqlFallas, paramsFallas);
    const fallasPorEstudiante = {};
    for (const f of fallasRows) fallasPorEstudiante[f.estudiante_id] = f.fallas;

    const resultado = estudiantes.map(e => {
      const { promedio } = promedioDesdeNotas(notasPorEstudiante[e.id] || []);
      return {
        estudiante_id: e.id,
        nombres: e.nombres,
        apellidos: e.apellidos,
        promedio,
        fallas: fallasPorEstudiante[e.id] || 0,
      };
    });

    return res.json({ ok: true, periodo_id: periodoId, total: resultado.length, estudiantes: resultado });
  } catch (err) {
    console.error('resumenMateria:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};
