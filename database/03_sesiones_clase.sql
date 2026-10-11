-- ============================================================
--  SIA v3 — Sesiones de clase (videollamadas por materia)
--  Ejecutar DESPUÉS de 01_sia_base.sql y 02_sia_v2.sql
-- ============================================================

USE sia_db;

-- ── Sesiones de clase (llamada activa por docente_materia) ────
CREATE TABLE sesiones_clase (
    id                  CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    docente_materia_id  CHAR(36)     NOT NULL,
    estado              ENUM('activa','finalizada') NOT NULL DEFAULT 'activa',
    sala_jitsi          VARCHAR(150) NOT NULL,
    iniciada_por        CHAR(36)     NOT NULL,
    iniciada_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finalizada_at       DATETIME,
    FOREIGN KEY (docente_materia_id) REFERENCES docentes_materias(id) ON DELETE CASCADE,
    FOREIGN KEY (iniciada_por)       REFERENCES usuarios(id),
    INDEX idx_sesion_docmat_estado (docente_materia_id, estado)
);

-- Restricción a nivel de aplicación (MySQL no soporta índice único parcial):
-- el backend SIEMPRE debe verificar que no exista otra fila con
-- (docente_materia_id, estado='activa') antes de insertar una nueva.

-- ── Log de trazos del pizarrón (opcional, para reconstruir sesión) ─
-- Se usa solo si se decide persistir el pizarrón; si no, los trazos
-- viven solo en memoria durante la sesión de socket.io.
CREATE TABLE pizarron_trazos (
    id                  CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    sesion_clase_id     CHAR(36)     NOT NULL,
    docente_id          CHAR(36)     NOT NULL,
    datos_trazo         JSON         NOT NULL,
    created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sesion_clase_id) REFERENCES sesiones_clase(id) ON DELETE CASCADE,
    FOREIGN KEY (docente_id)      REFERENCES usuarios(id)
);
