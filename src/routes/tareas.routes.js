// ============================================================
//  tareas.routes.js
//  Todas las rutas requieren login. Permisos finos por acción
//  dentro del controller (gestionar/ver vs. entregar/calificar).
//  Montado en /api/tareas
// ============================================================

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/tareas.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');

router.use(authMiddleware);

// Estudiante: sus tareas y la entrega (entregar también un docente
// con rol estudiante iría aquí — pero el estudiante es rol 'estudiante').
router.get('/estudiante',        soloRoles('estudiante'), ctrl.listarPorEstudiante);
router.post('/:id/entrega',      soloRoles('estudiante'), ctrl.entregar);

// Gestionar tareas por materia (docente/director/admin)
router.get('/materia/:materiaId',            soloRoles('admin', 'superadmin', 'docente'), ctrl.listarPorMateria);
router.post('/',                              soloRoles('admin', 'superadmin', 'docente'), ctrl.crear);
router.put('/:id',                            soloRoles('admin', 'superadmin', 'docente'), ctrl.actualizar);
router.delete('/:id',                         soloRoles('admin', 'superadmin', 'docente'), ctrl.eliminar);
router.get('/:id/entregas',                   soloRoles('admin', 'superadmin', 'docente'), ctrl.listarEntregas);
router.put('/:id/entrega',                    soloRoles('admin', 'superadmin', 'docente'), ctrl.calificarEntrega);

module.exports = router;
