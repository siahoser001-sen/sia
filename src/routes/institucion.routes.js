const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/institucion.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');

router.post('/solicitar',             ctrl.solicitarRegistro);
router.get('/buscar',                 ctrl.buscarInstituciones);
router.get('/solicitudes',            authMiddleware, soloRoles('superadmin'), ctrl.listarSolicitudes);
router.post('/:solicitudId/aprobar',  authMiddleware, soloRoles('superadmin'), ctrl.aprobarSolicitud);
router.post('/:solicitudId/rechazar', authMiddleware, soloRoles('superadmin'), ctrl.rechazarSolicitud);
module.exports = router;
