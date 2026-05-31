// ====================================================
//  db.js — Conexión a PostgreSQL
//  Usa un pool de conexiones para mejor rendimiento.
//  Importar este archivo en cualquier módulo que
//  necesite consultar la base de datos.
// ====================================================

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Verificar conexión al iniciar
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Error conectando a PostgreSQL:', err.message);
    return;
  }
  release();
  console.log('✅ Conectado a PostgreSQL —', process.env.DB_NAME);
});

module.exports = pool;
