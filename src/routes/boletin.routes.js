// ============================================================
//  boletin.routes.js
//  Montado en /api/boletines
//  El permiso fino (director del curso, docente que dicta ahí, o
//  admin/superadmin de la institución) se valida dentro del
//  controller porque depende de datos, no solo del rol.
// ============================================================

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/boletin.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');

router.use(authMiddleware);

router.post('/estudiante/:estudianteId/generar', soloRoles('admin', 'superadmin', 'docente'), ctrl.generarBoletin);
router.get('/estudiante/:estudianteId', soloRoles('admin', 'superadmin', 'docente'), ctrl.historialEstudiante);
router.get('/:id/descargar', soloRoles('admin', 'superadmin', 'docente'), ctrl.descargarBoletin);

module.exports = router;
