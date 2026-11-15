-- =====================================================================
-- 35_chat_adjuntos.sql
-- Adjuntos y mensajes de voz de la mensajería directa.
-- =====================================================================

USE sia_db;

START TRANSACTION;

SET @tiene_archivo_id = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_mensajes'
    AND COLUMN_NAME = 'archivo_id'
);
SET @ddl = IF(@tiene_archivo_id = 0,
  'ALTER TABLE chat_mensajes ADD COLUMN archivo_id CHAR(36) NULL AFTER remitente_id',
  'SELECT 1');
PREPARE chat_adj_1 FROM @ddl; EXECUTE chat_adj_1; DEALLOCATE PREPARE chat_adj_1;

SET @tiene_tipo = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_mensajes'
    AND COLUMN_NAME = 'tipo'
);
SET @ddl = IF(@tiene_tipo = 0,
  'ALTER TABLE chat_mensajes ADD COLUMN tipo ENUM(''texto'',''archivo'',''audio'') NOT NULL DEFAULT ''texto'' AFTER archivo_id',
  'SELECT 1');
PREPARE chat_adj_2 FROM @ddl; EXECUTE chat_adj_2; DEALLOCATE PREPARE chat_adj_2;

SET @tiene_transcripcion = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_mensajes'
    AND COLUMN_NAME = 'transcripcion'
);
SET @ddl = IF(@tiene_transcripcion = 0,
  'ALTER TABLE chat_mensajes ADD COLUMN transcripcion TEXT NULL AFTER texto',
  'SELECT 1');
PREPARE chat_adj_3 FROM @ddl; EXECUTE chat_adj_3; DEALLOCATE PREPARE chat_adj_3;

SET @texto_opcional = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_mensajes'
    AND COLUMN_NAME = 'texto' AND IS_NULLABLE = 'YES'
);
SET @ddl = IF(@texto_opcional = 0,
  'ALTER TABLE chat_mensajes MODIFY COLUMN texto TEXT NULL',
  'SELECT 1');
PREPARE chat_adj_4 FROM @ddl; EXECUTE chat_adj_4; DEALLOCATE PREPARE chat_adj_4;

SET @tiene_fk_archivo = (
  SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_mensajes'
    AND CONSTRAINT_NAME = 'fk_chat_mensajes_archivo'
);
SET @ddl = IF(@tiene_fk_archivo = 0,
  'ALTER TABLE chat_mensajes ADD CONSTRAINT fk_chat_mensajes_archivo FOREIGN KEY (archivo_id) REFERENCES archivos(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE chat_adj_5 FROM @ddl; EXECUTE chat_adj_5; DEALLOCATE PREPARE chat_adj_5;

SET @tiene_tipo_chat = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'archivos'
    AND COLUMN_NAME = 'tipo' AND COLUMN_TYPE LIKE '%chat_adjunto%'
);
SET @ddl = IF(@tiene_tipo_chat = 0,
  'ALTER TABLE archivos MODIFY COLUMN tipo ENUM(''recurso_clase'',''tarea_entregada'',''foto_perfil'',''logo_institucion'',''comunicado'',''fondo_personalizado'',''boletin'',''certificado'',''chat_adjunto'',''otro'') NOT NULL DEFAULT ''otro''',
  'SELECT 1');
PREPARE chat_adj_6 FROM @ddl; EXECUTE chat_adj_6; DEALLOCATE PREPARE chat_adj_6;

COMMIT;
