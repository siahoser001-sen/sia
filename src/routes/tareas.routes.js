// ============================================================
//  tareas.routes.js
//  Todas las rutas requieren login. Permisos finos por acción
//  dentro del controller (gestionar/ver vs. entregar/calificar).
//  Montado en /api/tareas
// ============================================================

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/tareas.controller');
const archivosCtrl = require('../controllers/tareas-entrega-archivos.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');
const { crearUploaderEntregaTarea } = require('../middleware/upload.middleware');

const uploadEntrega = crearUploaderEntregaTarea();

router.use(authMiddleware);

// Estudiante: sus tareas y la entrega (entregar también un docente
// con rol estudiante iría aquí — pero el estudiante es rol 'estudiante').
router.get('/estudiante',        soloRoles('estudiante'), ctrl.listarPorEstudiante);
router.post('/:id/entrega',      soloRoles('estudiante'), ctrl.entregar);
router.get('/:id/archivo',      ctrl.descargarArchivoActividad);

// Archivos de la entrega (máx. 5 por entrega, ver upload.middleware.js).
router.post(
  '/:id/entrega/archivos',
  soloRoles('estudiante'),
  uploadEntrega.array('archivos', 5),
  archivosCtrl.subir
);
router.delete('/:id/entrega/archivos/:archivoId', soloRoles('estudiante'), archivosCtrl.eliminar);
router.get('/:id/entrega/archivos/:archivoId', archivosCtrl.descargar);

// Gestionar tareas por materia (docente asignado/admin)
router.get('/materia/:materiaId',            soloRoles('admin', 'superadmin', 'docente'), ctrl.listarPorMateria);
router.post('/',                              soloRoles('admin', 'superadmin', 'docente'), uploadEntrega.single('archivo'), ctrl.crear);
router.put('/:id',                            soloRoles('admin', 'superadmin', 'docente'), ctrl.actualizar);
router.put('/:id/publicar',                    soloRoles('admin', 'superadmin', 'docente'), ctrl.publicar);
router.delete('/:id',                         soloRoles('admin', 'superadmin', 'docente'), ctrl.eliminar);
router.get('/:id/entregas',                   soloRoles('admin', 'superadmin', 'docente'), ctrl.listarEntregas);
router.put('/:id/entrega',                    soloRoles('admin', 'superadmin', 'docente'), ctrl.calificarEntrega);

module.exports = router;
