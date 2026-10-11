-- ============================================================
--  06_configuracion_sistema.sql
--  Tabla singleton para la configuración general de la
--  plataforma (nombre visible, logo). Es independiente de la
--  tabla `configuracion`, que es por institución.
-- ============================================================

CREATE TABLE IF NOT EXISTS configuracion_sistema (
    id                CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    nombre_plataforma VARCHAR(100) NOT NULL DEFAULT 'SIA',
    logo_url          TEXT,
    actualizado_por   CHAR(36),
    updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (actualizado_por) REFERENCES usuarios(id)
);

-- Fila única inicial (singleton)
INSERT INTO configuracion_sistema (nombre_plataforma)
SELECT 'SIA' WHERE NOT EXISTS (SELECT 1 FROM configuracion_sistema);
