const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/asistencia-dia.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');
const { crearUploaderArchivoAsistencia } = require('../middleware/upload.middleware');

const uploadArchivo = crearUploaderArchivoAsistencia();

router.use(authMiddleware);

router.get('/', ctrl.listarMes);
router.put('/', soloRoles('docente'), ctrl.guardarCelda);
router.post(
  '/archivo',
  soloRoles('docente'),
  uploadArchivo.single('archivo'),
  ctrl.subirArchivo
);
router.get('/archivo/:archivoId', ctrl.abrirArchivo);

module.exports = router;
