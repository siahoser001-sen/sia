-- Umbral de aprobación configurable por institución en escala de 0 a 10.
START TRANSACTION;

SET @columna_existe := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'configuracion'
    AND column_name = 'nota_minima_aprobacion'
);
SET @sql := IF(
  @columna_existe = 0,
  'ALTER TABLE configuracion ADD COLUMN nota_minima_aprobacion DECIMAL(4,2) NOT NULL DEFAULT 6.00',
  'DO 0'
);
PREPARE migracion FROM @sql;
EXECUTE migracion;
DEALLOCATE PREPARE migracion;

SET @restriccion_existe := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'configuracion'
    AND constraint_name = 'chk_config_nota_minima_aprobacion'
);
SET @sql := IF(
  @restriccion_existe = 0,
  'ALTER TABLE configuracion ADD CONSTRAINT chk_config_nota_minima_aprobacion CHECK (nota_minima_aprobacion >= 0 AND nota_minima_aprobacion <= 10)',
  'DO 0'
);
PREPARE migracion FROM @sql;
EXECUTE migracion;
DEALLOCATE PREPARE migracion;

COMMIT;
