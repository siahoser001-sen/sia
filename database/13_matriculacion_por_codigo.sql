-- ============================================================
--  13_matriculacion_por_codigo.sql
--  Completa el flujo de auto-matrícula por código de clase:
--
--  1) matriculas.codigo_confirmado
--     Guarda con qué código (versión) se creó/revalidó la
--     matrícula. Si más adelante el director regenera el
--     código del grupo, este valor deja de coincidir con
--     grupos.codigo_matricula y el frontend le pide al
--     estudiante que vuelva a digitar el código nuevo
--     ("revalidar"). No afecta notas/asistencia/historial:
--     solo es una bandera de verificación.
--
--  2) matriculas_bloqueadas
--     Cuando el director/admin elimina a un estudiante por
--     datos mal registrados, esos mismos datos (documento +
--     nombre completo) quedan bloqueados para ese curso
--     específico, para que no se puedan volver a usar en el
--     formulario de "Unirme con código de clase".
--
--  Cómo ejecutarlo (igual que los otros archivos de /database):
--  MySQL Workbench → File → Open SQL Script → este archivo
--  → Ctrl+Shift+Enter
-- ============================================================

USE sia_db;

ALTER TABLE matriculas
    ADD COLUMN codigo_confirmado CHAR(8) NULL AFTER anio_lectivo;

CREATE TABLE matriculas_bloqueadas (
    id                CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    grupo_id          CHAR(36)     NOT NULL,
    tipo_documento    VARCHAR(10)  NOT NULL,
    numero_documento  VARCHAR(20)  NOT NULL,
    nombres           VARCHAR(100) NOT NULL,
    apellidos         VARCHAR(100) NOT NULL,
    motivo            TEXT,
    bloqueado_por     CHAR(36)     NOT NULL,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (grupo_id)      REFERENCES grupos(id)   ON DELETE CASCADE,
    FOREIGN KEY (bloqueado_por) REFERENCES usuarios(id),
    INDEX idx_bloqueo_lookup (grupo_id, tipo_documento, numero_documento)
);
