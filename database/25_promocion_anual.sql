-- =====================================================================
-- 25_promocion_anual.sql
-- Cierre de año / promoción masiva (ROADMAP, Punto 5).
--   • matriculas.estado gana 'promovido': las filas del año que cierra
--     NO se borran; pasan a 'promovido' y quedan como histórico.
--   • grupos.anio_lectivo: identifica a qué año lectivo pertenece cada
--     grupo (el mismo "501" del año vigente y el "501" del año siguiente
--     son entidades distintas). El UNIQUE uq_grupo pasa de
--     (grado_id, nombre) a (grado_id, nombre, anio_lectivo).
-- Compatible con MySQL 8 y MariaDB: NO usa RENAME INDEX (MariaDB no lo
-- soporta); recrea el índice con ADD/DROP en un orden FK-seguro
-- (el índice nuevo arranca por grado_id, así que sigue cubriendo la FK
-- grupos.grado_id -> grados(id) al momento de soltar el viejo).
-- Archivo IDEMPOTENTE: usa guardas sobre information_schema, así si
-- falla a mitad de camino se puede reintentar sin tocar lo ya aplicado.
-- =====================================================================

USE sia_db;

-- Doble comilla = literal de string (desactiva ANSI_QUOTES por si acaso)
SET SESSION sql_mode = REPLACE(@@sql_mode, 'ANSI_QUOTES', '');

-- 1) anio_lectivo en grupos (nullable mientras se backfillea)
SET @col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grupos' AND COLUMN_NAME = 'anio_lectivo'
);
SET @ddl = IF(@col = 0,
  "ALTER TABLE grupos ADD COLUMN anio_lectivo SMALLINT NULL AFTER grado_id",
  "SELECT 'anio_lectivo ya existia'");
PREPARE c1 FROM @ddl; EXECUTE c1; DEALLOCATE PREPARE c1;

-- 2) Backfill: último año lectivo visto en las matrículas del grupo;
--    si el grupo no tiene matrículas, el año actual. Es idempotente.
UPDATE grupos g
LEFT JOIN (
    SELECT grupo_id, MAX(anio_lectivo) AS max_anio
    FROM matriculas
    GROUP BY grupo_id
) m ON m.grupo_id = g.id
SET g.anio_lectivo = COALESCE(m.max_anio, YEAR(CURRENT_DATE));

-- 3) Not NULL (repetir es inofensivo)
ALTER TABLE grupos
    MODIFY anio_lectivo SMALLINT NOT NULL;

-- 4) UNIQUE por año: (grado_id, nombre, anio_lectivo)
--    Convergente e idempotente para MySQL 8 y MariaDB (IF EXISTS, como
--    en la migración 23): el índice temporero arranca por grado_id y
--    cubre la FK grupos.grado_id -> grados(id) mientras se suelta el
--    uq_grupo viejo.
--    A) Índice temporero si falta (decisión con lectura previa al DDL)
SET @has_anio = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grupos' AND INDEX_NAME = 'uq_grupo_anio'
);
SET @ddl = IF(@has_anio = 0,
  "ALTER TABLE grupos ADD UNIQUE KEY uq_grupo_anio (grado_id, nombre, anio_lectivo)",
  "SELECT 'uq_grupo_anio ya existia'");
PREPARE c2 FROM @ddl; EXECUTE c2; DEALLOCATE PREPARE c2;

--    B) Soltar el uq_grupo viejo (y el nuevo si se repitió)
ALTER TABLE grupos DROP INDEX IF EXISTS uq_grupo;

--    C) Nombre canónico con el año
ALTER TABLE grupos ADD UNIQUE KEY uq_grupo (grado_id, nombre, anio_lectivo);

--    D) Limpiar el temporero
ALTER TABLE grupos DROP INDEX IF EXISTS uq_grupo_anio;

-- 5) Nuevo estado 'promovido' para las matrículas del año que cierra
ALTER TABLE matriculas
    MODIFY estado ENUM('activa','retirada','trasladada','graduada','promovido') NOT NULL DEFAULT 'activa';