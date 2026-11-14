// ============================================================
//  boletin.routes.js
//  Montado en /api/boletines
//  El permiso fino (director del curso, docente que dicta ahí,
//  admin/superadmin, o estudiante/acudiente con vínculo directo
//  para informes anuales e historial) se valida dentro del
//  controller porque depende de datos, no solo del rol.
// ============================================================

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/boletin.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');

router.use(authMiddleware);

router.post('/estudiante/:estudianteId/generar', soloRoles('admin', 'superadmin', 'docente'), ctrl.generarBoletin);
router.post('/estudiante/:estudianteId/generar-anual', ctrl.generarInformeAnual);
router.get('/estudiante/:estudianteId', ctrl.historialEstudiante);
router.get('/:id/descargar', ctrl.descargarBoletin);

module.exports = router;