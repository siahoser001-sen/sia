// ============================================================
//  routes/docente.routes.js
// ============================================================
const express      = require('express');
const router       = express.Router();
const ctrl         = require('../controllers/docente.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');

// Público — el docente se registra indicando su institución
router.post('/solicitar', ctrl.solicitarRegistro);

// Solo admin institucional
router.get('/solicitudes',              authMiddleware, soloRoles('admin'), ctrl.listarSolicitudes);
router.post('/:solicitudId/aprobar',    authMiddleware, soloRoles('admin'), ctrl.aprobarDocente);
router.post('/:solicitudId/rechazar',   authMiddleware, soloRoles('admin'), ctrl.rechazarDocente);

module.exports = router;
