-- =====================================================================
-- 29_tareas_estado.sql
-- Ciclo lectivo + límites (ROADMAP D6).
--   • tareas.estado: 'borrador' | 'publicada'. Una tarea creada cuando
--     el periodo NO está abierto se guarda en 'borrador' (no se notifica
--     ni la ve el estudiante). Se publica sola al abrir el periodo, o el
--     docente la publica antes con el botón "Publicar".
--     DEFAULT 'publicada' para no ocultar las tareas ya existentes.
-- Compatible con MySQL 8 y MariaDB, IDEMPOTENTE (information_schema +
-- PREPARE, patrón de la migración 25/26/28).
-- =====================================================================

USE sia_db;

SET SESSION sql_mode = REPLACE(@@sql_mode, 'ANSI_QUOTES', '');

SET @has_estado = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tareas'
    AND COLUMN_NAME = 'estado'
);
SET @ddl = IF(@has_estado = 0,
  "ALTER TABLE tareas
     ADD COLUMN estado ENUM('borrador','publicada') NOT NULL DEFAULT 'publicada' AFTER valor_max,
     ADD INDEX idx_tarea_estado (estado)",
  "SELECT 'tareas.estado ya existia'");
PREPARE c1 FROM @ddl; EXECUTE c1; DEALLOCATE PREPARE c1;
