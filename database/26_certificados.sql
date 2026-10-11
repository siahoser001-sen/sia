-- =====================================================================
-- 26_certificados.sql
-- Certificados y constancias (ROADMAP, Punto 6).
--   • archivos.tipo gana 'certificado' (PDF generado, mismo patrón que
--     'boletin').
--   • instituciones gana los campos de firma de los documentos que se
--     EXPIDEN en esa institución: nombre_firma (quién firma), cargo_firma
--     (su cargo) y documento_firma (documento de identidad de quien
--     firma). Por defecto se resuelve con el admin que genera el
--     certificado; se edita desde la sección "Certificados".
--   • certificados: historial de documentos expedidos. Cada generación
--     es una fila nueva (no se sobreescribe) y el PDF queda en storage/
--     como un `archivos` más, para re-descarga.
-- Compatible con MySQL 8 y MariaDB, IDEMPOTENTE (guardas sobre
-- information_schema + PREPARE, patrón de la migración 25).
-- =====================================================================

USE sia_db;

SET SESSION sql_mode = REPLACE(@@sql_mode, 'ANSI_QUOTES', '');

-- ── 1) archivos.tipo gana 'certificado' ───────────────────────
-- Rehacer el ENUM completo manteniendo los valores actuales ('boletin'
-- ya existe por la 16) y agregando 'certificado' antes de 'otro'.
SET @has_cert = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'archivos'
    AND COLUMN_NAME = 'tipo' AND COLUMN_TYPE LIKE '%certificado%'
);
SET @ddl = IF(@has_cert = 0,
  "ALTER TABLE archivos MODIFY COLUMN tipo ENUM(
     'recurso_clase','tarea_entregada','foto_perfil','logo_institucion',
     'comunicado','fondo_personalizado','boletin','certificado','otro'
   ) NOT NULL DEFAULT 'otro'",
  "SELECT 'archivos.tipo ya tiene certificado'");
PREPARE c1 FROM @ddl; EXECUTE c1; DEALLOCATE PREPARE c1;

-- ── 2) Campos de firma en instituciones ───────────────────────
SET @has_firma = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'instituciones'
    AND COLUMN_NAME = 'nombre_firma'
);
SET @ddl2 = IF(@has_firma = 0,
  "ALTER TABLE instituciones
     ADD COLUMN nombre_firma   VARCHAR(150) NULL AFTER logo_url,
     ADD COLUMN cargo_firma    VARCHAR(120) NULL AFTER nombre_firma,
     ADD COLUMN documento_firma VARCHAR(20)  NULL AFTER cargo_firma",
  "SELECT 'campos de firma ya existian'");
PREPARE c2 FROM @ddl2; EXECUTE c2; DEALLOCATE PREPARE c2;

-- ── 3) Tabla certificados (historial) ─────────────────────────
CREATE TABLE IF NOT EXISTS certificados (
    id              CHAR(36)  PRIMARY KEY DEFAULT (UUID()),
    institucion_id  CHAR(36)  NOT NULL,
    estudiante_id   CHAR(36)  NOT NULL,
    tipo            ENUM('estudio','notas','paz_y_salvo') NOT NULL,
    consecutivo     INT UNSIGNED NOT NULL,
    anio_lectivo    SMALLINT  NOT NULL,
    generado_por    CHAR(36)  NOT NULL,
    archivo_id      CHAR(36)  NOT NULL,
    created_at      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cert_consec (institucion_id, consecutivo),
    INDEX idx_cert_estudiante (estudiante_id),
    CONSTRAINT fk_cert_institucion FOREIGN KEY (institucion_id) REFERENCES instituciones(id),
    CONSTRAINT fk_cert_estudiante  FOREIGN KEY (estudiante_id)  REFERENCES usuarios(id) ON DELETE CASCADE,
    CONSTRAINT fk_cert_generado    FOREIGN KEY (generado_por)   REFERENCES usuarios(id),
    CONSTRAINT fk_cert_archivo     FOREIGN KEY (archivo_id)     REFERENCES archivos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;