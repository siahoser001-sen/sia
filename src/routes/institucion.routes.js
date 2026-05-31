// ============================================================
//  routes/institucion.routes.js
// ============================================================
const express      = require('express');
const router       = express.Router();
const ctrl         = require('../controllers/institucion.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');

// Público — cualquier persona puede solicitar registrar su colegio
router.post('/solicitar', ctrl.solicitarRegistro);

// Solo superadmin
router.get('/solicitudes',              authMiddleware, soloRoles('superadmin'), ctrl.listarSolicitudes);
router.post('/:solicitudId/aprobar',    authMiddleware, soloRoles('superadmin'), ctrl.aprobarSolicitud);
router.post('/:solicitudId/rechazar',   authMiddleware, soloRoles('superadmin'), ctrl.rechazarSolicitud);

module.exports = router;
