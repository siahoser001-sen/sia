// ============================================================
//  calendario.routes.js
//  Montado en /api/calendario
//  El permiso fino (admin del colegio, o docente director del
//  curso puntual) se valida dentro del controller porque depende
//  de datos (¿quién dirige este grupo?), no solo del rol — mismo
//  patrón que resumen.routes.js.
// ============================================================

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/calendario.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');

router.use(authMiddleware);

router.get('/eventos',        soloRoles('admin', 'superadmin', 'docente', 'estudiante', 'acudiente'), ctrl.listarEventos);
router.post('/eventos',       soloRoles('admin', 'superadmin', 'docente'), ctrl.crearEvento);
router.put('/eventos/:id',    soloRoles('admin', 'superadmin', 'docente'), ctrl.actualizarEvento);
router.delete('/eventos/:id', soloRoles('admin', 'superadmin', 'docente'), ctrl.eliminarEvento);

router.get('/mis-cursos', soloRoles('admin', 'superadmin', 'docente'), ctrl.misCursosParaEventos);

module.exports = router;
