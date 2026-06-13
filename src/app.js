require('dotenv').config();
const express = require('express');
const cors    = require('cors');
 
const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://127.0.0.1:5500' }));
app.use(express.json());
 
app.use('/api/auth',          require('./routes/auth.routes'));
app.use('/api/instituciones', require('./routes/institucion.routes'));
app.use('/api/docentes',      require('./routes/docente.routes'));
app.use('/api/academico',     require('./routes/academico.routes'));
 
app.get('/', (_, res) => res.json({ ok: true, mensaje: 'SIA API MySQL ✅' }));
app.use((req, res) => res.status(404).json({ ok: false, mensaje: `Ruta ${req.method} ${req.path} no existe.` }));
 
app.listen(process.env.PORT || 3000, () => {
  console.log(`\n🚀 SIA corriendo en http://localhost:${process.env.PORT || 3000}\n`);
});
 
