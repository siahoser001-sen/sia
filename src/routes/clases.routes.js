// ============================================================
//  clases.routes.js
//  Montado en /api/clases
// ============================================================

const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');
const ctrl    = require('../controllers/clases.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');

router.use(authMiddleware);

// Middleware: verifica que el usuario (docente dueño o estudiante matriculado)
// tenga derecho a ver/usar esta docente_materia_id específica.
async function perteneceAMateria(req, res, next) {
  const { docenteMateriaId } = req.params;
  const { id: usuarioId, rol } = req.usuario;

  try {
    if (rol === 'docente') {
      const [rows] = await pool.query(
        `SELECT id FROM docentes_materias WHERE id = ? AND docente_id = ?`,
        [docenteMateriaId, usuarioId]
      );
      if (!rows.length) {
        return res.status(403).json({ ok: false, mensaje: 'No tienes acceso a esta materia.' });
      }
      return next();
    }

    if (rol === 'estudiante') {
      const [rows] = await pool.query(
        `SELECT dm.id
         FROM docentes_materias dm
         JOIN matriculas mt ON mt.grupo_id = dm.grupo_id
         WHERE dm.id = ? AND mt.estudiante_id = ? AND mt.estado = 'activa'`,
        [docenteMateriaId, usuarioId]
      );
      if (!rows.length) {
        return res.status(403).json({ ok: false, mensaje: 'No estás matriculado en esta materia.' });
      }
      return next();
    }

    // admin / superadmin: acceso de solo lectura permitido, sin validación extra
    if (rol === 'admin' || rol === 'superadmin') return next();

    return res.status(403).json({ ok: false, mensaje: 'Rol sin acceso a este recurso.' });
  } catch (err) {
    console.error('perteneceAMateria error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
}

router.get('/mis-materias',              soloRoles('docente'),    ctrl.misMateriasDocente);
router.get('/mis-materias-estudiante',   soloRoles('estudiante'), ctrl.misMateriasEstudiante);

router.get('/:docenteMateriaId/estado-llamada',      perteneceAMateria, ctrl.estadoLlamada);
router.post('/:docenteMateriaId/iniciar-llamada',    soloRoles('docente'), perteneceAMateria, ctrl.iniciarLlamada);
router.post('/:docenteMateriaId/finalizar-llamada',  soloRoles('docente'), perteneceAMateria, ctrl.finalizarLlamada);

module.exports = router;
