const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/institucion.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');
const { publicoLimiter } = require('../middleware/rateLimit.middleware');
const { crearUploaderImagen } = require('../middleware/upload.middleware');

const uploadLogo = crearUploaderImagen('logos');

router.post('/solicitar',             publicoLimiter, ctrl.solicitarRegistro);
router.get('/buscar',                 ctrl.buscarInstituciones);
router.get('/solicitudes',            authMiddleware, soloRoles('superadmin'), ctrl.listarSolicitudes);
router.post('/:solicitudId/aprobar',  authMiddleware, soloRoles('superadmin'), ctrl.aprobarSolicitud);
router.post('/:solicitudId/rechazar', authMiddleware, soloRoles('superadmin'), ctrl.rechazarSolicitud);

// Logo de la institución (solo el admin puede subirlo/actualizarlo)
router.post('/logo',                  authMiddleware, soloRoles('admin'), uploadLogo.single('imagen'), ctrl.subirLogo);

// Gestión de instituciones ya existentes (superadmin)
router.get('/',                       authMiddleware, soloRoles('superadmin'), ctrl.listarInstituciones);
router.put('/:id',                    authMiddleware, soloRoles('superadmin'), ctrl.actualizarInstitucion);
router.put('/:id/activa',             authMiddleware, soloRoles('superadmin'), ctrl.cambiarEstadoInstitucion);

module.exports = router;
