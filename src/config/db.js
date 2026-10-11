// ============================================================
//  db.js — Conexión a MySQL con mysql2
//  Usa pool de conexiones para mejor rendimiento.
//  Diferencia clave vs PostgreSQL:
//    - Driver: mysql2 en lugar de pg
//    - Los parámetros usan ? en lugar de $1, $2
//    - Las queries devuelven [rows, fields] en lugar de { rows }
// ============================================================

const mysql  = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 3306,
  database: process.env.DB_NAME     || 'sia_db',
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit:    10,
  charset: 'utf8mb4',
  enableKeepAlive: true,
});

// Verificar conexión al iniciar (sin bloquear) con reintentos:
// XAMPP/MySQL a veces ya muestran "verde" pero InnoDB sigue montando la base
// y la primera conexión puede llegar en ese instante (á write ECONNRESET).
const CONEXION_INTENTOS       = 8;
const CONEXION_ESPERA_MS      = 1500;

function verificarConexion(intento) {
  pool.getConnection()
    .then(conn => {
      console.log('✅ Conectado a MySQL —', process.env.DB_NAME);
      conn.release();
    })
    .catch(err => {
      if (intento < CONEXION_INTENTOS) {
        console.warn(`⏳ MySQL no respondió en el intento ${intento} (${err.message}). Reintentando en ${CONEXION_ESPERA_MS / 1000}s…`);
        setTimeout(() => verificarConexion(intento + 1), CONEXION_ESPERA_MS);
      } else {
        console.error('❌ Error conectando a MySQL después de', CONEXION_INTENTOS, 'intentos:', err.message);
      }
    });
}

setImmediate(() => verificarConexion(1));

module.exports = pool;
