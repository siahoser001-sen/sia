// ============================================================
//  notas.routes.js
//  Montado en /api/notas
// ============================================================

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/notas.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');

router.use(authMiddleware);

router.post('/',    soloRoles('docente'), ctrl.crear);
router.put('/:id',  soloRoles('docente'), ctrl.actualizar);
router.delete('/:id', soloRoles('docente'), ctrl.eliminar);

router.get('/estudiante/:estudianteId/materia/:materiaId', ctrl.listarPorEstudianteMateria); // valida rol internamente
router.get('/promedio/:estudianteId/materia/:materiaId/periodo/:periodoId', ctrl.promedioEstudiante);
router.get('/promedios-grupo/:grupoId/materia/:materiaId/periodo/:periodoId',
  soloRoles('admin', 'superadmin', 'docente'), ctrl.promediosGrupo);

module.exports = router;
