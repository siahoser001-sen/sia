// ============================================================
//  migrate.js — Ejecuta las migraciones de database/NN_*.sql
//  desde código, sin depender de PHPMyAdmin ni MySQL Workbench.
//
//  Uso:
//    npm run migrate            -> aplica las pendientes en orden
//    npm run migrate:seed       -> marca como "aplicadas" todas las
//                                  migraciones 01..19 SIN ejecutarlas,
//                                  para la primera vez (las que ya
//                                  corriste a mano). Úsalo UNA vez.
//                                  A partir de ahí, migrate solo
//                                  aplicará las nuevas (20+).
//
//  Cómo funciona:
//    1. Se conecta con la MISMA config de src/config/db.js (.env).
//    2. Crea la tabla de control `schema_migrations` si no existe.
//    3. Lee database/NN_*.sql en orden ascendente.
//    4. Ejecuta SOLO los que aún no estén registrados (con
//       multipleStatements para correr el .sql completo).
//    5. Registra cada archivo aplicado.
//
//  Nota: si una migración falla a mitad de camino, se detiene y
//  NO se marca como aplicada, para que puedas corregir y reintentar
//  (las migraciones de este repo usan START TRANSACTION...COMMIT,
//  así que quedan a medio camino a salvo de rollback manual).
// ============================================================

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DB_DIR = path.join(__dirname, 'database');
const SEED_SOLO = process.argv.includes('--seed'); // primera vez: marcar 01..19 como ya aplicadas
const mysql = require('mysql2/promise');

function listarSaleError(e) {
  console.error('❌ No se pudo listar la carpeta database/:', e.message);
  process.exit(1);
}

(async () => {
  // --- leer archivos .sql ordenados ---
  let files;
  try {
    files = fs.readdirSync(DB_DIR).filter(f => /^\d+_.*\.sql$/i.test(f)).sort((a, b) => {
      const na = parseInt(a.split('_')[0], 10);
      const nb = parseInt(b.split('_')[0], 10);
      return na - nb;
    });
  } catch (e) {
    listarSaleError(e);
  }

  if (files.length === 0) {
    console.log('No hay migraciones *.sql en database/');
    process.exit(0);
  }

  const dbName = process.env.DB_NAME || 'sia_db';

  // Conexión inicial SIN base para poder crearla si falta (idempotente),
  // después nos cambiamos a la base objetivo.
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    port:     Number(process.env.DB_PORT     || 3306),
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
    charset: 'utf8mb4',
  });

  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
    await conn.changeUser({ database: dbName });

    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL UNIQUE,
        aplicada_el DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

    const [rows] = await conn.query(`SELECT nombre FROM schema_migrations`);
    const aplicadas = new Set(rows.map(r => r.nombre));

    // --- modo --seed: solo marcar las existentes (primera vez) ---
    if (SEED_SOLO) {
      const porMarcar = files.filter(f => !aplicadas.has(f));
      if (porMarcar.length === 0) {
        console.log('✅ Ya estaba todo marcado. Nada que hacer.');
      } else {
        console.log(`Marcando ${porMarcar.length} migración(es) como aplicadas (sin ejecutarlas):`);
        const sqlInsert = `INSERT IGNORE INTO schema_migrations (nombre) VALUES ${porMarcar.map(() => '(?)').join(',')}`;
        await conn.query(sqlInsert, porMarcar);
        porMarcar.forEach(f => console.log('  • ' + f));
        console.log('\n⚠️  Importante: solo usa --seed si YA corriste esas migraciones a mano.');
        console.log('   A partir de ahora, `npm run migrate` aplicará SOLO las nuevas (20+).');
      }
      await conn.end();
      process.exit(0);
    }

    let pendientes = files.filter(f => !aplicadas.has(f));
    if (pendientes.length === 0) {
      console.log('✅ Todo está al día. No hay migraciones pendientes.');
      await conn.end();
      process.exit(0);
    }

    console.log(`Se aplicarán ${pendientes.length} migración(es):`);
    pendientes.forEach(f => console.log('  • ' + f));

    for (const f of pendientes) {
      process.stdout.write(`▶ ${f} ... `);
      try {
        const sql = fs.readFileSync(path.join(DB_DIR, f), 'utf8');
        await conn.query(sql);
        await conn.query(`INSERT INTO schema_migrations (nombre) VALUES (?)`, [f]);
        console.log('OK');
      } catch (err) {
        console.log('FALLO');
        console.error('No aplicada (no quedó registrada):');
        console.error(err.message);
        await conn.end();
        process.exit(1);
      }
    }

    console.log('\n✅ Migraciones aplicadas correctamente.');
  } catch (err) {
    console.error('Error inicializando el runner:', err.message);
    await conn.end().catch(() => {});
    process.exit(1);
  }

  await conn.end();
  process.exit(0);
})();
