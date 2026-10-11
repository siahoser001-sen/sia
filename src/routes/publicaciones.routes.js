const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/publicaciones.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');
const { crearUploaderImagen } = require('../middleware/upload.middleware');

const uploadImagenComunicado = crearUploaderImagen('comunicados');

// Sube la imagen exportada por el editor de publicaciones (admin o
// superadmin). Devuelve un archivo_id para adjuntarlo al publicar.
router.post(
  '/imagen',
  authMiddleware,
  soloRoles('superadmin', 'admin'),
  uploadImagenComunicado.single('imagen'),
  ctrl.subirImagen
);

router.post('/global',      authMiddleware, soloRoles('superadmin', 'admin'),      ctrl.publicarGlobal);
router.post('/institucion', authMiddleware, soloRoles('admin'),      ctrl.publicarInstitucion);

router.get('/global', authMiddleware, ctrl.listarGlobales);
router.get('/',       authMiddleware, ctrl.listarPublicaciones);

// Eliminar: superadmin cualquiera, admin solo las de su institución
// (la validación de propiedad vive en el controlador).
router.delete('/:id', authMiddleware, soloRoles('superadmin', 'admin'), ctrl.eliminar);

module.exports = router;
