-- ============================================================
--  SIA v2 — Tablas adicionales MySQL
--  Ejecutar DESPUÉS de 01_sia_base.sql
-- ============================================================

USE sia_db;

-- ── Solicitudes de instituciones ──────────────────────────────
CREATE TABLE solicitudes_instituciones (
    id              CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    nombre          VARCHAR(200) NOT NULL,
    codigo_dane     VARCHAR(12)  NOT NULL,
    email           VARCHAR(150) NOT NULL,
    telefono        VARCHAR(20),
    municipio       VARCHAR(100),
    departamento    VARCHAR(100),
    admin_nombre    VARCHAR(150) NOT NULL,
    admin_email     VARCHAR(150) NOT NULL,
    admin_password  TEXT         NOT NULL,
    estado          ENUM('pendiente','aprobada','rechazada') NOT NULL DEFAULT 'pendiente',
    motivo_rechazo  TEXT,
    revisado_por    CHAR(36),
    revisado_at     DATETIME,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (revisado_por) REFERENCES usuarios(id)
);

-- ── Solicitudes de docentes ───────────────────────────────────
CREATE TABLE solicitudes_docentes (
    id               CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    institucion_id   CHAR(36)     NOT NULL,
    nombres          VARCHAR(100) NOT NULL,
    apellidos        VARCHAR(100) NOT NULL,
    tipo_documento   VARCHAR(10)  NOT NULL DEFAULT 'CC',
    numero_documento VARCHAR(20)  NOT NULL,
    email            VARCHAR(150) NOT NULL,
    telefono         VARCHAR(20),
    password_hash    TEXT         NOT NULL,
    estado           ENUM('pendiente','aprobada','rechazada') NOT NULL DEFAULT 'pendiente',
    motivo_rechazo   TEXT,
    revisado_por     CHAR(36),
    revisado_at      DATETIME,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (institucion_id) REFERENCES instituciones(id) ON DELETE CASCADE,
    FOREIGN KEY (revisado_por)   REFERENCES usuarios(id),
    UNIQUE KEY uq_solicitud_docente (institucion_id, email)
);

-- ── Notificaciones internas ───────────────────────────────────
CREATE TABLE notificaciones (
    id           CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    destinatario CHAR(36)     NOT NULL,
    tipo         ENUM('solicitud_institucion','solicitud_docente','aprobacion','rechazo','comunicado','nota_publicada','tarea_asignada','entrega_calificada') NOT NULL,
    titulo       VARCHAR(200) NOT NULL,
    mensaje      TEXT         NOT NULL,
    leida        BOOLEAN      NOT NULL DEFAULT FALSE,
    ref_id       CHAR(36),
    ref_tabla    VARCHAR(60),
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (destinatario) REFERENCES usuarios(id) ON DELETE CASCADE,
    INDEX idx_notif_destinatario (destinatario, leida)
);
