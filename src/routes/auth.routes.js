const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/auth.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');
const { loginLimiter, publicoLimiter } = require('../middleware/rateLimit.middleware');
const { crearUploaderImagen } = require('../middleware/upload.middleware');

const uploadFoto = crearUploaderImagen('perfiles');

router.post('/login', loginLimiter, ctrl.login);
router.post('/logout', authMiddleware, ctrl.logout);
router.post('/olvide-password', publicoLimiter, ctrl.olvidePassword);
router.post('/reestablecer-password', publicoLimiter, ctrl.reestablecerPassword);
router.post('/definir-password', authMiddleware, ctrl.definirPassword);
router.get('/perfil', authMiddleware, ctrl.obtenerPerfil);
router.put('/perfil', authMiddleware, ctrl.actualizarPerfil);
router.post('/foto', authMiddleware, uploadFoto.single('imagen'), ctrl.subirFoto);
router.post('/restablecer', authMiddleware, soloRoles('admin', 'superadmin'), ctrl.restablecerPorAdmin);

module.exports = router;
