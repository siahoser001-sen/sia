// ============================================================
//  plan-evaluacion.routes.js
//  Todas las rutas requieren login. Ver permisos finos por acción
//  dentro del controller (gestionar el plan vs. calificar una celda
//  son permisos distintos).
//  Montado en /api/plan-evaluacion
// ============================================================

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/plan-evaluacion.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');
const { crearUploaderEntregaTarea } = require('../middleware/upload.middleware');

router.use(authMiddleware);
const uploadActividad = crearUploaderEntregaTarea();

// Ítems del plan (actividades y su peso)
router.get('/materia/:materiaId',       soloRoles('admin', 'superadmin', 'docente'), ctrl.listarItems);
router.get('/materias-curso/:grupoId',  soloRoles('admin', 'superadmin', 'docente'), ctrl.listarMateriasDeCurso);
router.post('/',                        soloRoles('admin', 'superadmin', 'docente'), ctrl.crearItem);

// Hoja de calificación. `/celda` va ANTES de `/:id`: si no, Express
// interpreta "celda" como el id de un ítem del plan y responde
// "Actividad no encontrada".
router.get('/materia/:materiaId/hoja',  soloRoles('admin', 'superadmin', 'docente'), ctrl.hojaCalificacion);
router.put('/celda',                    soloRoles('admin', 'superadmin', 'docente'), ctrl.guardarCelda);

router.put('/:id',                      soloRoles('admin', 'superadmin', 'docente'), uploadActividad.single('archivo'), ctrl.actualizarItem);
router.delete('/:id',                   soloRoles('docente'), ctrl.eliminarItem);

module.exports = router;
