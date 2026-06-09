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
});

// Verificar conexión al iniciar
pool.getConnection()
  .then(conn => {
    console.log('✅ Conectado a MySQL —', process.env.DB_NAME);
    conn.release();
  })
  .catch(err => {
    console.error('❌ Error conectando a MySQL:', err.message);
  });

module.exports = pool;
