function condicionMateriaEnGrupo(aliasMateria = 'm', grupo = '?') {
  return `(${aliasMateria}.grupo_id = ${grupo} OR EXISTS (
    SELECT 1 FROM materias_curso mc
    WHERE mc.materia_id = ${aliasMateria}.id AND mc.grupo_id = ${grupo}
  ))`;
}

function condicionDocenteEnGrupo(aliasDocente = 'dm', aliasMateria = 'm', grupo = '?') {
  return `(${aliasDocente}.grupo_id = ${grupo} OR (
    ${aliasDocente}.grupo_id IS NULL AND ${condicionMateriaEnGrupo(aliasMateria, grupo)}
  ))`;
}

function parametrosMateriaEnGrupo(grupoId) {
  return [grupoId, grupoId];
}

function parametrosDocenteEnGrupo(grupoId) {
  return [grupoId, grupoId, grupoId];
}

async function materiaPerteneceAlGrupo(conn, materiaId, grupoId) {
  if (!materiaId || !grupoId) return false;
  const [rows] = await conn.query(
    `SELECT 1
     FROM materias m
     WHERE m.id = ? AND m.activa = TRUE
       AND ${condicionMateriaEnGrupo()}`,
    [materiaId, ...parametrosMateriaEnGrupo(grupoId)]
  );
  return rows.length > 0;
}

async function docenteAsignadoEnGrupo(conn, materiaId, docenteId, grupoId, periodoId = null) {
  if (!materiaId || !docenteId || !grupoId) return false;
  let sql = `SELECT 1
             FROM docentes_materias dm
             JOIN materias m ON m.id = dm.materia_id
             WHERE dm.materia_id = ? AND dm.docente_id = ?
               AND m.activa = TRUE
               AND ${condicionDocenteEnGrupo()}`;
  const params = [materiaId, docenteId, ...parametrosDocenteEnGrupo(grupoId)];
  if (periodoId) {
    sql += ` AND dm.periodo_id = ?`;
    params.push(periodoId);
  }
  sql += ` LIMIT 1`;
  const [rows] = await conn.query(sql, params);
  return rows.length > 0;
}

async function gruposDocenteMateria(conn, materiaId, docenteId, periodoId = null) {
  let sql = `SELECT DISTINCT g.id AS grupo_id
             FROM grupos g
             JOIN grados gr ON gr.id = g.grado_id
             JOIN materias m ON m.id = ?
             JOIN docentes_materias dm ON dm.materia_id = m.id AND dm.docente_id = ?
             WHERE m.activa = TRUE
               AND ${condicionDocenteEnGrupo('dm', 'm', 'g.id')}`;
  const params = [materiaId, docenteId];
  if (periodoId) {
    sql += ` AND dm.periodo_id = ?`;
    params.push(periodoId);
  }
  sql += ` ORDER BY gr.orden, g.nombre`;
  const [rows] = await conn.query(sql, params);
  return rows.map(row => row.grupo_id);
}

async function gruposActivosEstudianteEnMateria(conn, estudianteId, materiaId) {
  const [rows] = await conn.query(
    `SELECT DISTINCT mt.grupo_id
     FROM matriculas mt
     JOIN materias m ON m.id = ?
     WHERE mt.estudiante_id = ? AND mt.estado = 'activa'
       AND ${condicionMateriaEnGrupo('m', 'mt.grupo_id')}`,
    [materiaId, estudianteId]
  );
  return rows.map(row => row.grupo_id);
}

async function materiasConDocentesDeGrupo(conn, grupoId) {
  const [rows] = await conn.query(
    `SELECT m.id AS materia_id, m.nombre AS materia, m.grupo_id AS materia_grupo_id,
            dm.id AS docente_materia_id, dm.docente_id,
            CONCAT(u.nombres, ' ', u.apellidos) AS docente,
            g.id AS grupo_id, g.nombre AS grupo, gr.nombre AS grado,
            CONCAT(gr.nombre, g.nombre) AS curso
     FROM materias m
     JOIN grupos g ON g.id = ?
     JOIN grados gr ON gr.id = g.grado_id
     LEFT JOIN docentes_materias dm
       ON dm.materia_id = m.id AND ${condicionDocenteEnGrupo('dm', 'm', '?')}
     LEFT JOIN usuarios u ON u.id = dm.docente_id
     WHERE m.activa = TRUE AND m.institucion_id = gr.institucion_id
       AND ${condicionMateriaEnGrupo('m', '?')}
     ORDER BY m.nombre, docente`,
    [grupoId, ...parametrosDocenteEnGrupo(grupoId), ...parametrosMateriaEnGrupo(grupoId)]
  );
  return rows;
}

module.exports = {
  condicionMateriaEnGrupo,
  condicionDocenteEnGrupo,
  parametrosMateriaEnGrupo,
  parametrosDocenteEnGrupo,
  materiaPerteneceAlGrupo,
  docenteAsignadoEnGrupo,
  gruposDocenteMateria,
  gruposActivosEstudianteEnMateria,
  materiasConDocentesDeGrupo,
};
