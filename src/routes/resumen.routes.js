// ============================================================
//  resumen.routes.js
//  Montado en /api/resumen
//  El permiso fino (director del curso puntual, o admin de la
//  institución) se valida dentro del controller porque depende
//  de datos (¿quién dirige este grupo?), no solo del rol.
// ============================================================

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/resumen.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');

router.use(authMiddleware);

router.get('/curso/:grupoId', soloRoles('admin', 'superadmin', 'docente'), ctrl.resumenCurso);
router.get('/curso/:grupoId/estudiante/:estudianteId', soloRoles('admin', 'superadmin', 'docente'), ctrl.resumenCursoEstudiante);
router.get('/materia/:materiaId', soloRoles('admin', 'superadmin', 'docente'), ctrl.resumenMateria);

module.exports = router;
