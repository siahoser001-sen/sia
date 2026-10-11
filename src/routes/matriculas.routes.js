// ============================================================
//  matriculas.routes.js
//  Montado en /api/matriculas
// ============================================================

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/matriculas.controller');
const promocionCtrl = require('../controllers/promocion.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');
const { publicoLimiter } = require('../middleware/rateLimit.middleware');

// Pública: el estudiante todavía no tiene sesión (se está registrando).
router.post('/unirse', publicoLimiter, ctrl.unirseConCodigo);

router.use(authMiddleware);

// Cierre de año / promoción masiva (Punto 5). Antes que las rutas
// con parámetro para evitar conflictos de matcheo.
router.get('/promocion/previa', soloRoles('admin', 'superadmin'), promocionCtrl.previa);
router.post('/promocion',       soloRoles('admin', 'superadmin'), promocionCtrl.ejecutar);

router.post('/',                          soloRoles('admin', 'superadmin'), ctrl.matricular);
router.get('/grupo/:grupoId',             soloRoles('admin', 'superadmin', 'docente'), ctrl.listarPorGrupo);
router.get('/estudiantes-buscar',         soloRoles('admin', 'superadmin'), ctrl.buscarEstudiantes);
router.get('/mis-hijos',                  soloRoles('acudiente'), ctrl.misHijos);
router.get('/estudiante/:estudianteId',   ctrl.obtenerPorEstudiante); // valida rol internamente
router.put('/:id/retirar',                soloRoles('admin', 'superadmin'), ctrl.retirar);
router.post('/:id/trasladar',             soloRoles('admin', 'superadmin'), ctrl.trasladar);

// Estudiante ya autenticado, sin curso activo, uniéndose con un código
// nuevo (cambio de curso) — ver reglas en el controlador.
router.post('/unirse-clase',              soloRoles('estudiante'), ctrl.unirseAClase);
// Estudiante ya autenticado revalidando el código de su curso actual
// después de que el director lo regeneró.
router.post('/:id/revalidar',             soloRoles('estudiante'), ctrl.revalidarCodigo);
// Eliminar (no solo retirar) por datos mal registrados — bloquea el
// reingreso con esos mismos datos a ese curso.
router.delete('/:id/eliminar-estudiante', soloRoles('admin', 'superadmin', 'docente'), ctrl.eliminarEstudiante);

module.exports = router;
