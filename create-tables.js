#!/usr/bin/env node
const pool = require('./src/config/db');

const queries = [
  `CREATE TABLE IF NOT EXISTS sesiones_clase (
    id                  CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    docente_materia_id  CHAR(36)     NOT NULL,
    estado              ENUM('activa','finalizada') NOT NULL DEFAULT 'activa',
    sala_jitsi          VARCHAR(150) NOT NULL,
    iniciada_por        CHAR(36)     NOT NULL,
    iniciada_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finalizada_at       DATETIME,
    FOREIGN KEY (docente_materia_id) REFERENCES docentes_materias(id) ON DELETE CASCADE,
    FOREIGN KEY (iniciada_por)       REFERENCES usuarios(id),
    INDEX idx_sesion_docmat_estado (docente_materia_id, estado)
  )`,
  
  `CREATE TABLE IF NOT EXISTS pizarron_trazos (
    id                  CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    sesion_id           CHAR(36)     NOT NULL,
    usuario_id          CHAR(36)     NOT NULL,
    trazo_json          LONGTEXT     NOT NULL,
    created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sesion_id)  REFERENCES sesiones_clase(id) ON DELETE CASCADE,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    INDEX idx_trazo_sesion (sesion_id)
  )`
];

(async () => {
  try {
    console.log('🔧 Creando tablas...\n');
    
    for (const query of queries) {
      try {
        await pool.query(query);
        console.log('✅ Tabla creada/verificada');
      } catch (err) {
        console.error('❌ Error:', err.message);
      }
    }
    
    console.log('\n✅ Completado');
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    await pool.end();
    process.exit(1);
  }
})();
