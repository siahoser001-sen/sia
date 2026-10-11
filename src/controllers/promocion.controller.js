// ============================================================
//  promocion.controller.js — MySQL
//  Cierre de año / promoción masiva (ROADMAP, Punto 5).
//  Convierte las matrículas activas de los grupos del año vigente
//  en matrículas del año siguiente, sin borrar el histórico (las
//  filas viejas pasan a estado 'promovido').
//  Todo limitado a la institución del usuario autenticado
//  (via el join grupos -> grados -> institucion_id).
// ============================================================

const pool = require('../config/db');
const { randomUUID } = require('crypto');

// ── Helpers ───────────────────────────────────────────────────

// Año lectivo vigente de la institución: el último año con matrículas
// activas; si no hay, el último año de un grupo; si no, el año actual.
async function _anioVigente(conn, institucionId) {
  const [[{ maxMat }]] = await conn.query(
    `SELECT MAX(mt.anio_lectivo) AS maxMat
     FROM matriculas mt
     JOIN grupos g  ON g.id = mt.grupo_id
     JOIN grados gr ON gr.id = g.grado_id
     WHERE gr.institucion_id = ? AND mt.estado = 'activa'`,
    [institucionId]
  );
  if (maxMat) return maxMat;

  const [[{ maxGrupo }]] = await conn.query(
    `SELECT MAX(g.anio_lectivo) AS maxGrupo
     FROM grupos g
     JOIN grados gr ON gr.id = g.grado_id
     WHERE gr.institucion_id = ?`,
    [institucionId]
  );
  return maxGrupo || new Date().getFullYear();
}

function _parsearCodigoCurso(codigo) {
  const c = String(codigo || '').trim();
  if (!/^\d{3,4}$/.test(c)) return null;

  const digitosGrado = c.length === 4 ? 2 : 1;
  const gradoNum = c.slice(0, digitosGrado);
  const grupoNum = c.slice(digitosGrado);
  if (grupoNum.length !== 2) return null;

  return { gradoNombre: String(Number(gradoNum)), grupoNombre: grupoNum };
}

// Busca un grupo (mismo grado+nombre) en el año destino o lo crea.
async function _obtenerOCrearGrupo(conn, { gradoId, nombre, capacidadMax, anioDestino }) {
  const [existe] = await conn.query(
    `SELECT id FROM grupos WHERE grado_id = ? AND nombre = ? AND anio_lectivo = ? LIMIT 1`,
    [gradoId, nombre, anioDestino]
  );
  if (existe.length) return { id: existe[0].id, creado: false };

  const id = randomUUID();
  await conn.query(
    `INSERT INTO grupos (id, grado_id, nombre, capacidad_max, activo, anio_lectivo)
     VALUES (?, ?, ?, ?, TRUE, ?)`,
    [id, gradoId, nombre, capacidadMax || 35, anioDestino]
  );
  return { id, creado: true };
}

// ── GET /api/matriculas/promocion/previa?anio_destino= ────────
// Simulación (no modifica nada): grupos del año vigente con su
// cantidad de matrículas activas y el destino sugerido por defecto.
exports.previa = async (req, res) => {
  const institucionId = req.usuario.institucion_id;
  if (!institucionId) {
    return res.status(400).json({
      ok: false,
      mensaje: 'Tu cuenta no tiene una institución asociada. Si eres superadmin, hazlo desde la sesión del administrador del colegio.'
    });
  }

  try {
    const anioVigente = await _anioVigente(pool, institucionId);
    let anioDestino = anioVigente + 1;

    if (req.query.anio_destino) {
      const a = Number(req.query.anio_destino);
      if (!Number.isInteger(a) || a <= 0) {
        return res.status(400).json({ ok: false, mensaje: 'anio_destino debe ser un año válido.' });
      }
      anioDestino = a;
    }

    // Grados de la institución (para el selector de destino manual)
    const [grados] = await pool.query(
      `SELECT id, nombre, nivel, orden FROM grados
       WHERE institucion_id = ? ORDER BY orden ASC`,
      [institucionId]
    );

    // Grupos que ya existen en el año destino (para reutilizar)
    const [destinos] = await pool.query(
      `SELECT g.id AS grupo_id, g.grado_id, g.nombre, g.capacidad_max, g.activo, g.anio_lectivo,
              gr.nombre AS grado_nombre
       FROM grupos g
       JOIN grados gr ON gr.id = g.grado_id
       WHERE gr.institucion_id = ? AND g.anio_lectivo = ?
       ORDER BY gr.orden ASC, g.nombre ASC`,
      [institucionId, anioDestino]
    );

    // Grupos origen: del año vigente con al menos una matrícula activa
    const [grupos] = await pool.query(
      `SELECT g.id AS grupo_id, g.grado_id, g.nombre, g.capacidad_max, g.anio_lectivo,
              gr.nombre AS grado_nombre, gr.orden,
              COUNT(mt.id) AS cantidad
       FROM grupos g
       JOIN grados gr ON gr.id = g.grado_id
       LEFT JOIN matriculas mt ON mt.grupo_id = g.id AND mt.estado = 'activa'
       WHERE gr.institucion_id = ? AND g.activo = TRUE AND g.anio_lectivo = ?
       GROUP BY g.id, g.grado_id, g.nombre, g.capacidad_max, g.anio_lectivo, gr.nombre, gr.orden
       HAVING cantidad > 0
       ORDER BY gr.orden ASC, g.nombre ASC`,
      [institucionId, anioVigente]
    );

    let yaPromovido = false;
    const gruposMap = (grupos || []).map(g => {
      // Destino por defecto: el mismo grado+nombre en el año destino
      const sugerido = (destinos || []).find(d =>
        d.grado_id === g.grado_id && d.nombre === g.nombre
      );
      const destino = sugerido
        ? { grupo_id: sugerido.grupo_id, grado_nombre: sugerido.grado_nombre, nombre: sugerido.nombre, anio_lectivo: sugerido.anio_lectivo, crear: false }
        : { grupo_id: null, grado_nombre: g.grado_nombre, nombre: g.nombre, anio_lectivo: anioDestino, crear: true };
      return { ...g, destino };
    });

    // ¿Ya hay matrículas creadas en el año destino (ejecución previa)?
    if (destinos && destinos.length) {
      const [existen] = await pool.query(
        `SELECT mt.id FROM matriculas mt
         JOIN grupos g ON g.id = mt.grupo_id
         JOIN grados gr ON gr.id = g.grado_id
         WHERE gr.institucion_id = ? AND mt.anio_lectivo = ? AND mt.estado = 'activa'
         LIMIT 1`,
        [institucionId, anioDestino]
      );
      yaPromovido = existen.length > 0;
    }

    const resumen = {
      grupos: gruposMap.length,
      estudiantes: gruposMap.reduce((acc, g) => acc + (Number(g.cantidad) || 0), 0),
      destinos_a_crear: gruposMap.filter(g => g.destino.crear).length,
    };

    return res.json({ ok: true, anio_actual: anioVigente, anio_destino: anioDestino, ya_promovido: yaPromovido, grados, destinos_disponibles: destinos, grupos: gruposMap, resumen });

  } catch (err) {
    console.error('promocion.previa error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── POST /api/matriculas/promocion (admin/superadmin) ─────────
// Ejecuta el cierre de año. Idempotente: reintentar no duplica
// matrículas (se salta las ya existentes y los grupos ya promovidos).
// body: {
//   anio_destino: 2026,
//   destinos: [
//     { grupo_origen_id, grupo_destino_id? | codigo_destino? , copiar_configuracion? }
//   ]
// }
exports.ejecutar = async (req, res) => {
  const institucionId = req.usuario.institucion_id;
  if (!institucionId) {
    return res.status(400).json({
      ok: false,
      mensaje: 'Tu cuenta no tiene una institución asociada. Si eres superadmin, hazlo desde la sesión del administrador del colegio.'
    });
  }

  const { anio_destino, destinos } = req.body;
  if (!Number.isInteger(Number(anio_destino)) || Number(anio_destino) <= 0) {
    return res.status(400).json({ ok: false, mensaje: 'anio_destino es obligatorio y debe ser un año válido.' });
  }
  if (!Array.isArray(destinos) || destinos.length === 0) {
    return res.status(400).json({ ok: false, mensaje: 'Envía la lista de destinos a promocionar (al menos un grupo).' });
  }

  const anioDestino = Number(anio_destino);
  const conn = await pool.getConnection();
  const resultados = [];

  try {
    await conn.beginTransaction();

    const anioVigente = await _anioVigente(conn, institucionId);
    if (anioDestino <= anioVigente) {
      await conn.rollback();
      return res.status(409).json({
        ok: false,
        mensaje: `El año destino (${anioDestino}) debe ser mayor al año lectivo vigente (${anioVigente}). El cierre ya se ejecutó o el año es incorrecto.`
      });
    }

    // Todos los grupos de la institución, indexados por id
    const [grupos] = await conn.query(
      `SELECT g.id, g.grado_id, g.nombre, g.capacidad_max, g.anio_lectivo,
              gr.nombre AS grado_nombre, gr.institucion_id
       FROM grupos g
       JOIN grados gr ON gr.id = g.grado_id
       WHERE gr.institucion_id = ?`,
      [institucionId]
    );
    const gruposPorId = new Map(grupos.map(g => [g.id, g]));

    for (const item of destinos) {
      const origen = gruposPorId.get(item.grupo_origen_id);
      if (!origen) {
        await conn.rollback();
        return res.status(404).json({ ok: false, mensaje: 'Grupo origen no encontrado en tu institución.' });
      }
      if (origen.anio_lectivo >= anioDestino) {
        await conn.rollback();
        return res.status(409).json({
          ok: false,
          mensaje: `El grupo ${origen.grado_nombre}${origen.nombre} ya pertenece al año ${origen.anio_lectivo}; no se puede promocionar a ${anioDestino}.`
        });
      }

      // ── Resolver el grupo destino ──
      let destino, grupoCreado = false;
      if (item.grupo_destino_id) {
        destino = gruposPorId.get(item.grupo_destino_id);
        if (!destino) {
          await conn.rollback();
          return res.status(404).json({ ok: false, mensaje: 'Grupo destino no encontrado en tu institución.' });
        }
        if (destino.anio_lectivo !== anioDestino) {
          await conn.rollback();
          return res.status(409).json({ ok: false, mensaje: `El grupo destino ${destino.grado_nombre}${destino.nombre} es del año ${destino.anio_lectivo}, no del ${anioDestino}.` });
        }
      } else if (item.codigo_destino) {
        const parseado = _parsearCodigoCurso(item.codigo_destino);
        if (!parseado) {
          await conn.rollback();
          return res.status(400).json({ ok: false, mensaje: `El código destino "${item.codigo_destino}" no es válido (ej. 601 para 6° grupo 01).` });
        }
        const [grado] = await conn.query(
          `SELECT id FROM grados WHERE institucion_id = ? AND nombre = ?`,
          [institucionId, parseado.gradoNombre]
        );
        if (!grado.length) {
          await conn.rollback();
          return res.status(400).json({ ok: false, mensaje: `No existe el grado ${parseado.gradoNombre} en tu institución. Créalo en Gestión académica.` });
        }
        const res = await _obtenerOCrearGrupo(conn, { gradoId: grado[0].id, nombre: parseado.grupoNombre, capacidadMax: origen.capacidad_max, anioDestino });
        destino = { id: res.id, grado_nombre: parseado.gradoNombre, nombre: parseado.grupoNombre };
        grupoCreado = res.creado;
      } else {
        // Por defecto: el mismo curso del año siguiente (mismo grado+nombre)
        const res = await _obtenerOCrearGrupo(conn, { gradoId: origen.grado_id, nombre: origen.nombre, capacidadMax: origen.capacidad_max, anioDestino });
        destino = { id: res.id, grado_nombre: origen.grado_nombre, nombre: origen.nombre };
        grupoCreado = res.creado;
      }

      // ── Opcional: copiar la asignación docente-materia al grupo destino ──
      let configuracionCopiada = false;
      if (item.copiar_configuracion) {
        const [asignaciones] = await conn.query(
          `SELECT materia_id, docente_id, periodo_id FROM docentes_materias WHERE grupo_id = ?`,
          [origen.id]
        );
        for (const a of asignaciones) {
          const [dup] = await conn.query(
            `SELECT id FROM docentes_materias
             WHERE docente_id = ? AND materia_id = ? AND grupo_id = ? AND periodo_id = ? LIMIT 1`,
            [a.docente_id, a.materia_id, destino.id, a.periodo_id]
          );
          if (!dup.length) {
            await conn.query(
              `INSERT INTO docentes_materias (id, docente_id, materia_id, grupo_id, periodo_id)
               VALUES (?, ?, ?, ?, ?)`,
              [randomUUID(), a.docente_id, a.materia_id, destino.id, a.periodo_id]
            );
          }
        }
        configuracionCopiada = true;
      }

      // ── Promover las matrículas activas ──
      const [estudiantes] = await conn.query(
        `SELECT mt.estudiante_id FROM matriculas mt
         WHERE mt.grupo_id = ? AND mt.estado = 'activa'`,
        [origen.id]
      );

      let promovidos = 0;
      let yaExistentes = 0;
      const fechaIngreso = `${anioDestino}-01-01`;

      for (const e of estudiantes) {
        const [dup] = await conn.query(
          `SELECT id FROM matriculas WHERE estudiante_id = ? AND grupo_id = ? AND anio_lectivo = ? LIMIT 1`,
          [e.estudiante_id, destino.id, anioDestino]
        );
        if (dup.length) {
          yaExistentes++;
          continue;
        }
        await conn.query(
          `INSERT INTO matriculas (id, estudiante_id, grupo_id, anio_lectivo, fecha_ingreso, estado, observaciones)
           VALUES (?, ?, ?, ?, ?, 'activa', ?)`,
          [randomUUID(), e.estudiante_id, destino.id, anioDestino, fechaIngreso,
           `Promovido de ${origen.grado_nombre}${origen.nombre} (${origen.anio_lectivo})`]
        );
        promovidos++;
      }

      // Marcar las filas viejas como histórico
      const obsPromovido = `Promovido a ${destino.grado_nombre}${destino.nombre} (${anioDestino}) el ${new Date().toISOString().slice(0, 10)}`;
      await conn.query(
        `UPDATE matriculas
         SET estado = 'promovido',
             fecha_retiro = ?,
             observaciones = CASE
               WHEN observaciones IS NULL OR observaciones = '' THEN ?
               ELSE CONCAT(observaciones, '\n', ?)
             END
         WHERE grupo_id = ? AND estado = 'activa'`,
        [`${anioVigente}-12-31`, obsPromovido, obsPromovido, origen.id]
      );

      resultados.push({
        origen: { grupo_id: origen.id, grado_nombre: origen.grado_nombre, nombre: origen.nombre, anio_lectivo: origen.anio_lectivo },
        destino: { grupo_id: destino.id, grado_nombre: destino.grado_nombre, nombre: destino.nombre, anio_lectivo: anioDestino },
        grupo_creado: grupoCreado,
        promovidos,
        ya_existentes: yaExistentes,
        configuracion_copiada: configuracionCopiada,
      });
    }

    await conn.commit();

    const totalPromovidos = resultados.reduce((a, r) => a + r.promovidos, 0);
    const totalYaExistentes = resultados.reduce((a, r) => a + r.ya_existentes, 0);

    return res.json({
      ok: true,
      mensaje: `Cierre de año ${anioVigente} → ${anioDestino} ejecutado.`,
      anio_actual: anioVigente,
      anio_destino: anioDestino,
      total_promovidos: totalPromovidos,
      total_ya_existentes: totalYaExistentes,
      grupos: resultados,
    });

  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, mensaje: 'Ya existe una matrícula con esos datos (idempotencia).' });
    }
    console.error('promocion.ejecutar error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    conn.release();
  }
};