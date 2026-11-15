-- Guarda el destino de las notificaciones vinculadas a actividades.
USE sia_db;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = 'sia_db' AND table_name = 'notificaciones' AND column_name = 'materia_id');
SET @sql := IF(@c = 0,
  'ALTER TABLE notificaciones ADD COLUMN materia_id CHAR(36) NULL AFTER ref_tabla',
  'DO (SELECT 1)');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = 'sia_db' AND table_name = 'notificaciones' AND column_name = 'grupo_id');
SET @sql := IF(@c = 0,
  'ALTER TABLE notificaciones ADD COLUMN grupo_id CHAR(36) NULL AFTER materia_id',
  'DO (SELECT 1)');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = 'sia_db' AND table_name = 'notificaciones' AND column_name = 'actividad_id');
SET @sql := IF(@c = 0,
  'ALTER TABLE notificaciones ADD COLUMN actividad_id CHAR(36) NULL AFTER grupo_id',
  'DO (SELECT 1)');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
