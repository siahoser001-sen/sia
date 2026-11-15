require('dotenv').config();
const pool = require('./src/config/db');
(async () => {
  const [rows] = await pool.query(
    `SELECT id, nombre, activo, DATE_FORMAT(fecha_inicio,'%Y-%m-%d') AS ini,
            DATE_FORMAT(fecha_fin,'%Y-%m-%d') AS fin
     FROM periodos_academicos WHERE institucion_id='a1c0ffee-0000-4000-8000-000000000011'
     ORDER BY fecha_inicio`);
  console.table(rows);
  await pool.end();
})();
