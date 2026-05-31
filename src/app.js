// ============================================================
//  app.js — Servidor principal SIA v2
// ============================================================
require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5500' }));
app.use(express.json());

// Rutas
app.use('/api/auth',         require('./routes/auth.routes'));
app.use('/api/instituciones', require('./routes/institucion.routes'));
app.use('/api/docentes',      require('./routes/docente.routes'));

// Verificar que el servidor vive
app.get('/', (_, res) => res.json({ ok: true, mensaje: 'SIA API v2 ✅' }));

// Ruta no encontrada
app.use((req, res) => res.status(404).json({ ok: false, mensaje: `Ruta ${req.method} ${req.path} no existe.` }));

app.listen(process.env.PORT || 3000, () => {
  console.log(`\n🚀 SIA corriendo en http://localhost:${process.env.PORT || 3000}\n`);
});
