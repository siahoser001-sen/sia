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

router.use(authMiddleware);

// Ítems del plan (actividades y su peso)
router.get('/materia/:materiaId',       soloRoles('admin', 'superadmin', 'docente'), ctrl.listarItems);
router.get('/materias-curso/:grupoId',  soloRoles('admin', 'superadmin', 'docente'), ctrl.listarMateriasDeCurso);
router.post('/',                        soloRoles('admin', 'superadmin', 'docente'), ctrl.crearItem);
router.put('/:id',                      soloRoles('admin', 'superadmin', 'docente'), ctrl.actualizarItem);
router.delete('/:id',                   soloRoles('admin', 'superadmin', 'docente'), ctrl.eliminarItem);

// Hoja de calificación
router.get('/materia/:materiaId/hoja',  soloRoles('admin', 'superadmin', 'docente'), ctrl.hojaCalificacion);
router.put('/celda',                    soloRoles('admin', 'superadmin', 'docente'), ctrl.guardarCelda);

module.exports = router;
