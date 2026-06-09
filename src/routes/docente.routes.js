const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/docente.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');

router.post('/solicitar',             ctrl.solicitarRegistro);
router.get('/solicitudes',            authMiddleware, soloRoles('admin'), ctrl.listarSolicitudes);
router.post('/:solicitudId/aprobar',  authMiddleware, soloRoles('admin'), ctrl.aprobarDocente);
router.post('/:solicitudId/rechazar', authMiddleware, soloRoles('admin'), ctrl.rechazarDocente);
module.exports = router;
