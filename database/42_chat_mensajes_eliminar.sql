-- =====================================================================
-- 42_chat_mensajes_eliminar.sql
-- Eliminar / ocultar mensajes en la mensajería directa.
--  - chat_mensajes.eliminado: mensaje eliminado para todos.
--  - chat_mensajes.eliminado_por / eliminado_at: auditoría del borrado.
--  - chat_mensajes_ocultos: mensajes ocultos solo para un usuario.
-- =====================================================================

USE sia_db;

START TRANSACTION;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = 'sia_db' AND table_name = 'chat_mensajes' AND column_name = 'eliminado');
SET @sql := IF(@c = 0,
  'ALTER TABLE chat_mensajes ADD COLUMN eliminado TINYINT(1) NOT NULL DEFAULT 0 AFTER leido',
  'DO (SELECT 1)');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = 'sia_db' AND table_name = 'chat_mensajes' AND column_name = 'eliminado_por');
SET @sql := IF(@c = 0,
  'ALTER TABLE chat_mensajes ADD COLUMN eliminado_por CHAR(36) NULL AFTER eliminado',
  'DO (SELECT 1)');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = 'sia_db' AND table_name = 'chat_mensajes' AND column_name = 'eliminado_at');
SET @sql := IF(@c = 0,
  'ALTER TABLE chat_mensajes ADD COLUMN eliminado_at DATETIME NULL AFTER eliminado_por',
  'DO (SELECT 1)');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
           WHERE CONSTRAINT_SCHEMA = 'sia_db' AND TABLE_NAME = 'chat_mensajes'
             AND CONSTRAINT_NAME = 'fk_chat_mensajes_eliminado_por');
SET @sql := IF(@c = 0,
  'ALTER TABLE chat_mensajes ADD CONSTRAINT fk_chat_mensajes_eliminado_por FOREIGN KEY (eliminado_por) REFERENCES usuarios(id) ON DELETE SET NULL',
  'DO (SELECT 1)');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

CREATE TABLE IF NOT EXISTS chat_mensajes_ocultos (
    mensaje_id CHAR(36) NOT NULL,
    usuario_id CHAR(36) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (mensaje_id, usuario_id),
    KEY idx_chat_oculto_usuario (usuario_id),
    CONSTRAINT fk_chat_oculto_mensaje FOREIGN KEY (mensaje_id) REFERENCES chat_mensajes(id) ON DELETE CASCADE,
    CONSTRAINT fk_chat_oculto_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;
