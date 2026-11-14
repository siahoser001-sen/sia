// ============================================================
//  scripts/libre-puerto.js
//  Libera el puerto del servidor (por defecto 3000) antes de
//  arrancarlo. Evita el error recurrente:
//
//      Error: listen EADDRINUSE: address already in use 0.0.0.0:3000
//
//  que ocurre cuando quedó un proceso `node` (o `nodemon`) anterior
//  con el puerto ocupado (por ejemplo, al cerrar la terminal sin
//  detenerlo bien, o al reiniciar el servidor con cambios).
//
//  Se ejecuta automáticamente con `npm start` y `npm run dev`
//  gracias a los hooks `prestart` / `predev` del package.json.
//
//  También se puede usar a mano:
//      node scripts/libre-puerto.js [puerto]
// ============================================================

const { execSync } = require('child_process');

const PUERTO = String(process.argv[2] || process.env.PORT || 3000);

// Devuelve los PIDs que están ESCUCHANDO en el puerto dado (excluye este proceso).
function pidsEscuchando(puerto) {
  const pids = new Set();
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano -p TCP', { encoding: 'utf8' });
      for (const linea of out.split(/\r?\n/)) {
        if (!/LISTENING/i.test(linea)) continue;
        const cols  = linea.trim().split(/\s+/);
        const local = cols[1] || '';
        if (!local.endsWith(':' + puerto)) continue;
        const pid = parseInt(cols[cols.length - 1], 10);
        if (pid && pid !== process.pid) pids.add(pid);
      }
    } else {
      const out = execSync(`lsof -ti tcp:${puerto} 2>/dev/null || true`, { encoding: 'utf8' });
      for (const t of out.split(/\s+/)) {
        const pid = parseInt(t, 10);
        if (pid && pid !== process.pid) pids.add(pid);
      }
    }
  } catch (_) {
    // Si netstat/lsof no está disponible, no se libera nada; el server arrancará
    // igual (o fallará con el error normal de puerto ocupado).
  }
  return [...pids];
}

function matar(pid, puerto) {
  try {
    if (process.platform === 'win32') execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
    else                              execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
    console.log(`   • Puerto ${puerto} liberado (proceso ${pid} cerrado).`);
  } catch (_) {
    console.warn(`   ⚠ No se pudo cerrar el proceso ${pid} que usa el puerto ${puerto}.`);
  }
}

// Espera (hasta ~3s) a que el puerto quede realmente libre.
function esperarLibre(puerto, intentos = 15) {
  for (let i = 0; i < intentos; i++) {
    if (pidsEscuchando(puerto).length === 0) return true;
    try { execSync(process.platform === 'win32' ? 'ping -n 1 127.0.0.1 >nul' : 'sleep 0.2', { stdio: 'ignore' }); } catch (_) {}
  }
  return pidsEscuchando(puerto).length === 0;
}

const pids = pidsEscuchando(PUERTO);
if (pids.length) {
  console.log(`⏳ El puerto ${PUERTO} estaba ocupado; liberándolo para arrancar limpio...`);
  pids.forEach(pid => matar(pid, PUERTO));
  if (!esperarLibre(PUERTO)) {
    console.warn(`   ⚠ El puerto ${PUERTO} sigue ocupado; si el arranque falla, ciérralo manualmente.`);
  }
} else {
  console.log(`✅ Puerto ${PUERTO} libre.`);
}
