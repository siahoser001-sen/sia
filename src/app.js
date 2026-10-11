require('dotenv').config();
const path    = require('path');
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const http    = require('http');
const { Server } = require('socket.io');
const { initSockets } = require('./sockets/socket');
const manejadorErrores = require('./middleware/manejadorErrores');

const app = express();

// ── Headers de seguridad ─────────────────────────────────────
// CSP solo para el frontend estático: se permite lo que el SIA usa
// (elementos de Socket.io, estilos inline, imágenes de /storage) sin
// abrir el CSP por completo.
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.disable('x-powered-by');

// ── Trust proxy ──────────────────────────────────────────────
// Solo cuando el sistema está detrás de un proxy/nginx. Sin esto,
// `req.ip` tomaría la IP del proxy para todos y el rate-limit por
// IP (ver rateLimit.middleware.js) limitaría a todo el mundo con
// la misma dirección. Con TRUST_PROXY=1 se confía en la cabecera
// `X-Forwarded-For` para leer la IP real del cliente.
if ((process.env.TRUST_PROXY || '').toString().trim() === '1') {
  app.set('trust proxy', 1);
}

// ── CORS ─────────────────────────────────────────────────────
// CORS_ORIGIN en .env puede ser:
//   - vacío / no definido  -> refleja el origin de quien pregunta
//     (necesario para poder abrir el sistema desde el celular,
//     desde otra PC de la red, o desde un dominio distinto)
//   - una lista separada por comas -> solo esos orígenes
//   - "*" -> cualquier origen
const origenesPermitidos = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

if (origenesPermitidos.length === 0) {
  console.warn('\n⚠️  CORS_ORIGIN vacío: CORS refleja CUALQUIER origen (necesario para el celular en LAN).\n   Si este servidor queda expuesto a Internet, define CORS_ORIGIN en .env para restringir orígenes.\n');
}

const corsOptions = {
  origin: origenesPermitidos.length === 0
    ? true // refleja el origin entrante (equivale a permitir cualquiera, con credenciales)
    : (origen, cb) => cb(null, !origen || origenesPermitidos.includes(origen)),
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

// ── Frontend (HTML/CSS/JS) servido por el mismo backend ───────
// Al servir el frontend desde el mismo servidor que la API,
// se puede abrir el sistema desde cualquier dispositivo de la
// red (celular, tablet, otra PC) usando la IP de este equipo,
// sin depender de Live Server ni de que "localhost" exista en
// el dispositivo remoto. Ver README, sección "Acceso desde otros
// dispositivos".
app.use('/frontend', express.static(path.join(__dirname, '../frontend'), {
  // Los .html cambian con cada deploy: revalidar siempre en vez de cachearlos.
  // cacheControl:false evita que serve-static pise el header con max-age=0.
  cacheControl: false,
  setHeaders(res, filePath) {
    // .html, .js, .css y .svg cambian con cada deploy: revalidar siempre
    // en vez de servirlos desde la caché del navegador (deja imágenes
    // pesadas como los fondos con la caché del navegador).
    if (['.html', '.js', '.css', '.svg'].includes(path.extname(filePath))) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// Archivos subidos por usuarios (fondos personalizados, etc.).
// Separado de /frontend porque su contenido es dinámico y
// específico de cada usuario/institución, no parte del código.
app.use('/storage', express.static(path.join(__dirname, '../storage')));

app.use('/api/auth',          require('./routes/auth.routes'));
app.use('/api/instituciones', require('./routes/institucion.routes'));
app.use('/api/docentes',      require('./routes/docente.routes'));
app.use('/api/academico',     require('./routes/academico.routes'));
app.use('/api/clases',        require('./routes/clases.routes'));
app.use('/api/matriculas',    require('./routes/matriculas.routes'));
app.use('/api/acudientes',    require('./routes/acudientes.routes'));
app.use('/api/notas',         require('./routes/notas.routes'));
app.use('/api/asistencia',    require('./routes/asistencia.routes'));
app.use('/api/resumen',       require('./routes/resumen.routes'));
app.use('/api/publicaciones', require('./routes/publicaciones.routes'));
app.use('/api/sistema',       require('./routes/sistema.routes'));
app.use('/api/actividad',     require('./routes/actividad.routes'));
app.use('/api/llamadas',      require('./routes/llamadas.routes'));
app.use('/api/boletines',     require('./routes/boletin.routes'));
app.use('/api/plan-evaluacion', require('./routes/plan-evaluacion.routes'));
app.use('/api/tareas',         require('./routes/tareas.routes'));
app.use('/api/calendario',    require('./routes/calendario.routes'));
app.use('/api/notificaciones', require('./routes/notificaciones.routes'));
app.use('/api/chat',           require('./routes/chat.routes'));
app.use('/api/reportes',       require('./routes/reportes.routes'));

// Raíz: redirige a la pantalla de login del frontend en vez de
// dejar al usuario viendo un JSON pelado.
app.get('/', (_, res) => res.redirect('/frontend/login.html'));
app.get('/api', (_, res) => res.json({ ok: true, mensaje: 'SIA API MySQL ✅' }));

app.use((req, res) => res.status(404).json({ ok: false, mensaje: `Ruta ${req.method} ${req.path} no existe.` }));
app.use(manejadorErrores);

// ── Servidor HTTP + socket.io compartiendo el mismo puerto ────
const server = http.createServer(app);
const io = new Server(server, { cors: corsOptions });

// Se guarda la instancia de io en el app para poder emitir eventos
// desde los controladores (ej. clases.controller.js -> req.app.get('io')).
app.set('io', io);
initSockets(io);

const PORT = process.env.PORT || 3000;
// 0.0.0.0 = escucha en todas las interfaces de red del equipo,
// no solo en localhost. Es lo que permite entrar desde el celular
// usando la IP del equipo (ej. http://192.168.1.10:3000).
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`\n🚀 SIA corriendo en http://localhost:${PORT}`);
  console.log(`   Desde otros dispositivos de la misma red: http://<IP-de-este-equipo>:${PORT}`);
  console.log(`   (ver README para cómo encontrar esa IP)\n`);
});
