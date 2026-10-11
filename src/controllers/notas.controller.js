// ============================================================
//  notas.controller.js — MySQL
//  Registro de notas por estudiante/materia/periodo.
//  Regla de negocio clave: la suma de peso_pct de todas las notas
//  de un mismo estudiante+materia+periodo no puede superar 100.
// ============================================================

const pool = require('../config/db');
const { randomUUID } = require('crypto');
const { crearNotificacion } = require('../services/notificacion.service');

// Verifica que el docente autenticado dicte esa materia en ese periodo,
// y devuelve el grupo_id correspondiente (lo necesitamos para validar
// que el estudiante esté matriculado ahí).
async function obtenerGrupoDeDocente(conn, docenteId, materiaId, periodoId) {
  const [rows] = await conn.query(
    `SELECT grupo_id FROM docentes_materias
     WHERE docente_id = ? AND materia_id = ? AND periodo_id = ?`,
    [docenteId, materiaId, periodoId]
  );
  return rows.length ? rows[0].grupo_id : null;
}

async function sumaPesoActual(conn, estudianteId, materiaId, periodoId, excluirNotaId = null) {
  const params = [estudianteId, materiaId, periodoId];
  let sql = `SELECT COALESCE(SUM(peso_pct), 0) AS total FROM notas
             WHERE estudiante_id = ? AND materia_id = ? AND periodo_id = ?`;
  if (excluirNotaId) {
    sql += ` AND id != ?`;
    params.push(excluirNotaId);
  }
  const [[{ total }]] = await conn.query(sql, params);
  return Number(total);
}

// ────────────────────────────────────────────────────────────
//  POST /api/notas  (docente)
// ────────────────────────────────────────────────────────────
exports.crear = async (req, res) => {
  const {
    estudiante_id, materia_id, periodo_id,
    tipo_nota, descripcion, valor, valor_max, peso_pct, fecha_eval, observacion,
  } = req.body;

  if (!estudiante_id || !materia_id || !periodo_id || !tipo_nota || valor === undefined || peso_pct === undefined) {
    return res.status(400).json({
      ok: false,
      mensaje: 'estudiante_id, materia_id, periodo_id, tipo_nota, valor y peso_pct son obligatorios.',
    });
  }
  if (peso_pct <= 0 || peso_pct > 100) {
    return res.status(400).json({ ok: false, mensaje: 'peso_pct debe estar entre 1 y 100.' });
  }
  if ((descripcion || '').length > 255 || (observacion || '').length > 500) {
    return res.status(400).json({ ok: false, mensaje: 'El texto de la descripción u observación es demasiado largo.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const grupoId = await obtenerGrupoDeDocente(conn, req.usuario.id, materia_id, periodo_id);
    if (!grupoId) {
      await conn.rollback();
      return res.status(403).json({ ok: false, mensaje: 'No dictas esta materia en este periodo.' });
    }

    const [matriculado] = await conn.query(
      `SELECT id FROM matriculas WHERE estudiante_id = ? AND grupo_id = ? AND estado = 'activa'`,
      [estudiante_id, grupoId]
    );
    if (!matriculado.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'El estudiante no está matriculado activo en tu grupo.' });
    }

    const pesoActual = await sumaPesoActual(conn, estudiante_id, materia_id, periodo_id);
    if (pesoActual + Number(peso_pct) > 100) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        mensaje: `Los pesos de este estudiante en esta materia/periodo ya suman ${pesoActual}%. Con este ítem se pasarían de 100%.`,
      });
    }

    const id = randomUUID();
    await conn.query(
      `INSERT INTO notas
        (id, estudiante_id, materia_id, periodo_id, docente_id, tipo_nota, descripcion, valor, valor_max, peso_pct, fecha_eval, observacion)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_DATE), ?)`,
      [id, estudiante_id, materia_id, periodo_id, req.usuario.id, tipo_nota, descripcion || null,
       valor, valor_max || 10.00, peso_pct, fecha_eval || null, observacion || null]
    );

    await conn.commit();

    // Aviso al estudiante de su nueva nota (punto 6).
    await crearNotificacion({
      destinatario: estudiante_id,
      tipo:         'nota_publicada',
      titulo:       `Registraron una nota en ${tipo_nota}`,
      mensaje:      `Te registraron una nota de ${valor} en "${descripcion || tipo_nota}" en #nombreinstitucion.`,
      ref_id:       id,
      ref_tabla:    'notas',
    });

    return res.status(201).json({ ok: true, mensaje: 'Nota registrada.', id });

  } catch (err) {
    await conn.rollback();
    if (err.errno === 3819 || /chk_valor|chk_peso/.test(err.message || '')) {
      return res.status(400).json({ ok: false, mensaje: 'El valor o el peso no cumplen las reglas de validación.' });
    }
    console.error('crear nota:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    conn.release();
  }
};

// ────────────────────────────────────────────────────────────
//  PUT /api/notas/:id  (docente dueño de la nota)
// ────────────────────────────────────────────────────────────
exports.actualizar = async (req, res) => {
  const { id } = req.params;
  const { valor, valor_max, peso_pct, descripcion, observacion, fecha_eval } = req.body;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [notaActual] = await conn.query(
      `SELECT * FROM notas WHERE id = ? AND docente_id = ?`,
      [id, req.usuario.id]
    );
    if (!notaActual.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'Nota no encontrada o no te pertenece.' });
    }

    if (peso_pct !== undefined) {
      const { estudiante_id, materia_id, periodo_id } = notaActual[0];
      const pesoActual = await sumaPesoActual(conn, estudiante_id, materia_id, periodo_id, id);
      if (pesoActual + Number(peso_pct) > 100) {
        await conn.rollback();
        return res.status(400).json({
          ok: false,
          mensaje: `Con este cambio, los pesos sumarían más de 100% (actualmente ${pesoActual}% sin contar esta nota).`,
        });
      }
    }

    await conn.query(
      `UPDATE notas
       SET valor = COALESCE(?, valor),
           valor_max = COALESCE(?, valor_max),
           peso_pct = COALESCE(?, peso_pct),
           descripcion = COALESCE(?, descripcion),
           observacion = COALESCE(?, observacion),
           fecha_eval = COALESCE(?, fecha_eval)
       WHERE id = ?`,
      [valor, valor_max, peso_pct, descripcion, observacion, fecha_eval, id]
    );

    await conn.commit();
    return res.json({ ok: true, mensaje: 'Nota actualizada.' });

  } catch (err) {
    await conn.rollback();
    console.error('actualizar nota:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    conn.release();
  }
};

// ────────────────────────────────────────────────────────────
//  DELETE /api/notas/:id  (docente dueño)
// ────────────────────────────────────────────────────────────
exports.eliminar = async (req, res) => {
  try {
    const [result] = await pool.query(
      `DELETE FROM notas WHERE id = ? AND docente_id = ?`,
      [req.params.id, req.usuario.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Nota no encontrada o no te pertenece.' });
    }
    return res.json({ ok: true, mensaje: 'Nota eliminada.' });
  } catch (err) {
    console.error('eliminar nota:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  GET /api/notas/estudiante/:estudianteId/materia/:materiaId?periodo_id=
//  admin/superadmin, docente (dueño), acudiente (su hijo), estudiante (self)
// ────────────────────────────────────────────────────────────
exports.listarPorEstudianteMateria = async (req, res) => {
  const { estudianteId, materiaId } = req.params;
  const { periodo_id } = req.query;
  const { rol, id: usuarioId } = req.usuario;

  try {
    if (rol === 'estudiante' && usuarioId !== estudianteId) {
      return res.status(403).json({ ok: false, mensaje: 'No puedes ver notas de otro estudiante.' });
    }
    if (rol === 'acudiente') {
      const [rel] = await pool.query(
        `SELECT 1 FROM acudientes_estudiantes WHERE acudiente_id = ? AND estudiante_id = ?`,
        [usuarioId, estudianteId]
      );
      if (!rel.length) {
        return res.status(403).json({ ok: false, mensaje: 'No eres acudiente registrado de este estudiante.' });
      }
    }
    if (rol === 'docente') {
      const [dicta] = await pool.query(
        `SELECT 1 FROM docentes_materias WHERE docente_id = ? AND materia_id = ?`,
        [usuarioId, materiaId]
      );
      if (!dicta.length) {
        return res.status(403).json({ ok: false, mensaje: 'No dictas esta materia.' });
      }
    }

    let sql = `SELECT id, tipo_nota, descripcion, valor, valor_max, peso_pct, fecha_eval, observacion, periodo_id
               FROM notas WHERE estudiante_id = ? AND materia_id = ?`;
    const params = [estudianteId, materiaId];
    if (periodo_id) {
      sql += ` AND periodo_id = ?`;
      params.push(periodo_id);
    }
    sql += ` ORDER BY fecha_eval ASC`;

    const [rows] = await pool.query(sql, params);
    return res.json({ ok: true, total: rows.length, notas: rows });
  } catch (err) {
    console.error('listarPorEstudianteMateria:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  GET /api/notas/promedio/:estudianteId/materia/:materiaId/periodo/:periodoId
//  Promedio ponderado por peso_pct, escalado a base 10.
// ────────────────────────────────────────────────────────────
exports.promedioEstudiante = async (req, res) => {
  const { estudianteId, materiaId, periodoId } = req.params;
  const { rol, id: usuarioId, institucion_id } = req.usuario;

  try {
    // Solo estudiante (self), acudiente (hijo), docente (materia asignada) o admin pueden ver esto.
    if (rol === 'estudiante' && usuarioId !== estudianteId) {
      return res.status(403).json({ ok: false, mensaje: 'No puedes ver el promedio de otro estudiante.' });
    }
    if (rol === 'acudiente') {
      const [rel] = await pool.query(
        `SELECT 1 FROM acudientes_estudiantes WHERE acudiente_id = ? AND estudiante_id = ?`,
        [usuarioId, estudianteId]
      );
      if (!rel.length) {
        return res.status(403).json({ ok: false, mensaje: 'No eres acudiente registrado de este estudiante.' });
      }
    }
    if (rol === 'docente') {
      const [dicta] = await pool.query(
        `SELECT 1 FROM docentes_materias WHERE docente_id = ? AND materia_id = ? AND grupo_id IN
         (SELECT grupo_id FROM matriculas WHERE estudiante_id = ?)`,
        [usuarioId, materiaId, estudianteId]
      );
      if (!dicta.length) {
        return res.status(403).json({ ok: false, mensaje: 'No dictas esta materia para este estudiante.' });
      }
    }

    const [rows] = await pool.query(
      `SELECT valor, valor_max, peso_pct FROM notas
       WHERE estudiante_id = ? AND materia_id = ? AND periodo_id = ?`,
      [estudianteId, materiaId, periodoId]
    );
    if (!rows.length) {
      return res.json({ ok: true, promedio: null, mensaje: 'Sin notas registradas para ese periodo.' });
    }
    let sumaPonderada = 0;
    let sumaPesos = 0;
    for (const n of rows) {
      sumaPonderada += (Number(n.valor) / Number(n.valor_max)) * Number(n.peso_pct);
      sumaPesos += Number(n.peso_pct);
    }
    const promedio = sumaPesos > 0 ? (sumaPonderada / sumaPesos) * 10 : null;
    return res.json({
      ok: true,
      promedio: promedio !== null ? Number(promedio.toFixed(2)) : null,
      pesos_registrados: sumaPesos,
      completo: sumaPesos >= 100,
    });
  } catch (err) {
    console.error('promedioEstudiante:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  GET /api/notas/promedios-grupo/:grupoId/materia/:materiaId/periodo/:periodoId
//  admin/superadmin/docente (dueño) — vista de promedios de todo el grupo,
//  útil para el reporte de fin de periodo.
// ────────────────────────────────────────────────────────────
exports.promediosGrupo = async (req, res) => {
  const { grupoId, materiaId, periodoId } = req.params;

  try {
    if (req.usuario.rol === 'docente') {
      const [dicta] = await pool.query(
        `SELECT 1 FROM docentes_materias WHERE docente_id = ? AND materia_id = ? AND grupo_id = ? AND periodo_id = ?`,
        [req.usuario.id, materiaId, grupoId, periodoId]
      );
      if (!dicta.length) {
        return res.status(403).json({ ok: false, mensaje: 'No dictas esta materia en este grupo/periodo.' });
      }
    }

    const [estudiantes] = await pool.query(
      `SELECT u.id, u.nombres, u.apellidos
       FROM matriculas mt JOIN usuarios u ON u.id = mt.estudiante_id
       WHERE mt.grupo_id = ? AND mt.estado = 'activa'
       ORDER BY u.apellidos, u.nombres`,
      [grupoId]
    );

    const [notas] = await pool.query(
      `SELECT estudiante_id, valor, valor_max, peso_pct FROM notas
       WHERE materia_id = ? AND periodo_id = ?
         AND estudiante_id IN (SELECT estudiante_id FROM matriculas WHERE grupo_id = ? AND estado = 'activa')`,
      [materiaId, periodoId, grupoId]
    );

    const acumulado = {};
    for (const n of notas) {
      if (!acumulado[n.estudiante_id]) acumulado[n.estudiante_id] = { ponderada: 0, pesos: 0 };
      acumulado[n.estudiante_id].ponderada += (Number(n.valor) / Number(n.valor_max)) * Number(n.peso_pct);
      acumulado[n.estudiante_id].pesos += Number(n.peso_pct);
    }

    const resultado = estudiantes.map((est) => {
      const acc = acumulado[est.id];
      const promedio = acc && acc.pesos > 0 ? Number(((acc.ponderada / acc.pesos) * 10).toFixed(2)) : null;
      return {
        estudiante_id: est.id,
        nombres: est.nombres,
        apellidos: est.apellidos,
        promedio,
        pesos_registrados: acc ? acc.pesos : 0,
      };
    });

    return res.json({ ok: true, total: resultado.length, promedios: resultado });
  } catch (err) {
    console.error('promediosGrupo:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};
