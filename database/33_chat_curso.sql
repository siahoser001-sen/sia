-- =====================================================================
-- 33_chat_curso.sql
-- Chat del curso (ROADMAP Ronda F, punto F5).
--   Un canal de chat POR CURSO (grupo) donde solo escriben los docentes
--   asignados (y co-docentes) además del SISTEMA. Estudiantes y acudientes
--   solo leen. El sistema publica: creación/cierre de actividades,
--   notas publicadas, comunicados del curso y videollamadas (con el
--   código de sala y el enlace directo en `datos`).
-- Cambios:
--   chats: tipo + 'curso', columna grupo_id (única: un chat por curso).
--         ente_a/ente_b pasan a NULL (en un chat de curso no hay par).
--   chat_mensajes: remitente_id nullable (mensajes del sistema), columna
--         origen ('usuario'|'sistema'), evento (tipo del aviso) y datos
--         JSON (p. ej. { sala, url } de la videollamada).
-- Idempotente (MySQL 8 / MariaDB), igual que el resto del repo.
-- =====================================================================

USE sia_db;

START TRANSACTION;

-- ── chats: tipo 'curso' ─────────────────────────────────────────────
SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = 'sia_db' AND table_name = 'chats' AND column_name = 'grupo_id');
SET @sql := IF(@c = 0,
  'ALTER TABLE chats ADD COLUMN grupo_id CHAR(36) NULL AFTER institucion_id',
  'DO (SELECT 1)');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = 'sia_db' AND table_name = 'chats' AND column_name = 'tipo');
SET @sql := IF(@c > 0,
  "ALTER TABLE chats MODIFY COLUMN tipo ENUM('institucion','personal','curso') NOT NULL",
  'DO (SELECT 1)');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ente_a/ente_b a NULL (en chat de curso no aplican)
ALTER TABLE chats MODIFY ente_a CHAR(36) NULL, MODIFY ente_b CHAR(36) NULL;

-- Un único chat por curso
SET @i := (SELECT COUNT(*) FROM information_schema.statistics
           WHERE table_schema = 'sia_db' AND table_name = 'chats' AND index_name = 'uq_chat_curso');
SET @sql := IF(@i = 0,
  'ALTER TABLE chats ADD UNIQUE KEY uq_chat_curso (grupo_id)',
  'DO (SELECT 1)');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── chat_mensajes: remitente sistema ────────────────────────────────
ALTER TABLE chat_mensajes MODIFY remitente_id CHAR(36) NULL;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = 'sia_db' AND table_name = 'chat_mensajes' AND column_name = 'origen');
SET @sql := IF(@c = 0,
  "ALTER TABLE chat_mensajes ADD COLUMN origen ENUM('usuario','sistema') NOT NULL DEFAULT 'usuario' AFTER remitente_id",
  'DO (SELECT 1)');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = 'sia_db' AND table_name = 'chat_mensajes' AND column_name = 'evento');
SET @sql := IF(@c = 0,
  "ALTER TABLE chat_mensajes ADD COLUMN evento VARCHAR(40) NULL AFTER texto",
  'DO (SELECT 1)');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = 'sia_db' AND table_name = 'chat_mensajes' AND column_name = 'datos');
SET @sql := IF(@c = 0,
  'ALTER TABLE chat_mensajes ADD COLUMN datos JSON NULL AFTER evento',
  'DO (SELECT 1)');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

COMMIT;
