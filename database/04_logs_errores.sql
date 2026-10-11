-- ============================================================
--  SIA — logs_errores (Fase 1 del módulo de diagnóstico)
--  Ejecutar DESPUÉS de 01_sia_base.sql, 02_sia_v2.sql y
--  03_sesiones_clase.sql
-- ============================================================

USE sia_db;

CREATE TABLE logs_errores (
    id              CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    timestamp       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modulo          VARCHAR(50)  NOT NULL,
    tipo_error      VARCHAR(80)  NOT NULL,
    mensaje         TEXT         NOT NULL,
    stack           TEXT,
    metodo_http     VARCHAR(10),
    ruta            VARCHAR(200),
    status_code     SMALLINT,
    usuario_id      CHAR(36),
    institucion_id  CHAR(36),
    resuelto        BOOLEAN      NOT NULL DEFAULT FALSE,
    FOREIGN KEY (usuario_id)     REFERENCES usuarios(id)      ON DELETE SET NULL,
    FOREIGN KEY (institucion_id) REFERENCES instituciones(id) ON DELETE SET NULL,
    INDEX idx_logerr_timestamp (timestamp),
    INDEX idx_logerr_modulo    (modulo),
    INDEX idx_logerr_resuelto  (resuelto)
);
