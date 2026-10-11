// ============================================================
//  reportes.routes.js
//  Montado en /api/reportes
//  El permiso fino (docente con acceso al curso del estudiante,
//  estudiante o acudiente sobre su propio expediente) se valida
//  dentro del controller porque depende de los datos.
// ============================================================

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/reportes.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');

router.use(authMiddleware);

// Certificados y constancias (punto 6): configuración de firma,
// historial por estudiante y generación/descarga de PDF.
router.put('/certificados/firma',              soloRoles('admin', 'superadmin'), ctrl.actualizarFirma);
router.get('/certificados/:id/descargar',      ctrl.descargarCertificado);
router.get('/estudiante/:estudianteId/certificados', ctrl.historialCertificados);
router.get('/estudiante/:estudianteId/certificado/:tipo', ctrl.certificado);

// Página 1 — datos + resumen académico del estudiante.
router.get('/estudiante/:estudianteId', ctrl.obtenerReporte);

// Impresión/descarga (punto 3): PDF o Word, por página o todas.
router.get('/estudiante/:estudianteId/imprimir', ctrl.imprimir);

// Página 2 — compromisos.
router.get('/estudiante/:estudianteId/compromisos', ctrl.listarCompromisos);
router.post('/estudiante/:estudianteId/compromisos', ctrl.crearCompromiso);
router.put('/estudiante/:estudianteId/compromisos/:id', ctrl.actualizarCompromiso);
router.delete('/estudiante/:estudianteId/compromisos/:id', ctrl.eliminarCompromiso);

// Página 3 — observaciones.
router.get('/estudiante/:estudianteId/observaciones', ctrl.listarObservaciones);
router.post('/estudiante/:estudianteId/observaciones', ctrl.crearObservacion);
router.put('/estudiante/:estudianteId/observaciones/:id', ctrl.actualizarObservacion);
router.delete('/estudiante/:estudianteId/observaciones/:id', ctrl.eliminarObservacion);

// Páginas personalizadas (punto 4): CRUD del mini-maquetador.
router.get('/estudiante/:estudianteId/paginas', ctrl.listarPaginas);
router.post('/estudiante/:estudianteId/paginas', ctrl.crearPagina);
router.put('/estudiante/:estudianteId/paginas/:id', ctrl.actualizarPagina);
router.delete('/estudiante/:estudianteId/paginas/:id', ctrl.eliminarPagina);

module.exports = router;