const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/sistema.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');
const { crearUploaderImagen } = require('../middleware/upload.middleware');

const uploadFondo = crearUploaderImagen('fondos');

router.get('/configuracion', authMiddleware, ctrl.obtenerConfig);
router.put('/configuracion', authMiddleware, soloRoles('superadmin'), ctrl.actualizarConfig);

// Fondos personalizados: cualquier rol autenticado puede subir el suyo.
router.get('/fondos', authMiddleware, ctrl.misFondos);
router.post('/fondos', authMiddleware, uploadFondo.single('imagen'), ctrl.subirFondo);

module.exports = router;
