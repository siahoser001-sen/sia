-- =====================================================================
-- 24_reporte_estudiantil.sql
-- Expediente del estudiante para el "Reporte estudiantil" de 3 páginas
-- (datos / compromiso / observaciones) + páginas personalizadas.
--   • reporte_compromisos      → página de compromiso (observación +
--     compromiso por mal desempeño o comportamiento, con estado y
--     seguimiento).
--   • reporte_observaciones    → observaciones individuales cronológicas.
--   • reporte_paginas_personalizadas → páginas extra con bloques
--     (texto/cuadros); el frontend empieza a usarlas en la tarea
--     "Punto 4".
-- Archivo idempotente (IF NOT EXISTS) para poder reintentarlo de forma
-- segura si falló a mitad de camino.
-- =====================================================================

CREATE TABLE IF NOT EXISTS reporte_compromisos (
    id               CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    institucion_id   CHAR(36)     NOT NULL,
    estudiante_id    CHAR(36)     NOT NULL,
    creado_por       CHAR(36)     NOT NULL,
    rol_creador      VARCHAR(20)  NOT NULL,
    motivo           VARCHAR(150) NOT NULL,
    observacion      TEXT,
    compromiso       TEXT         NOT NULL,
    estado           ENUM('pendiente','cumplido') NOT NULL DEFAULT 'pendiente',
    fecha_compromiso DATE         NOT NULL,
    fecha_limite     DATE,
    fecha_cumplido   DATE,
    seguimiento      TEXT,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (institucion_id) REFERENCES instituciones(id),
    FOREIGN KEY (estudiante_id)  REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (creado_por)     REFERENCES usuarios(id),
    INDEX idx_rc_estudiante (estudiante_id),
    INDEX idx_rc_institucion (institucion_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reporte_observaciones (
    id               CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    institucion_id   CHAR(36)     NOT NULL,
    estudiante_id    CHAR(36)     NOT NULL,
    creado_por       CHAR(36)     NOT NULL,
    rol_creador      VARCHAR(20)  NOT NULL,
    tipo             ENUM('academica','comportamiento','positiva','general') NOT NULL DEFAULT 'general',
    observacion      TEXT         NOT NULL,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (institucion_id) REFERENCES instituciones(id),
    FOREIGN KEY (estudiante_id)  REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (creado_por)     REFERENCES usuarios(id),
    INDEX idx_ro_estudiante (estudiante_id),
    INDEX idx_ro_institucion (institucion_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reporte_paginas_personalizadas (
    id               CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    institucion_id   CHAR(36)     NOT NULL,
    estudiante_id    CHAR(36)     NOT NULL,
    creado_por       CHAR(36),
    titulo           VARCHAR(120) NOT NULL DEFAULT 'Página personalizada',
    contenido_json   JSON,
    orden            INT          NOT NULL DEFAULT 0,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (institucion_id) REFERENCES instituciones(id),
    FOREIGN KEY (estudiante_id)  REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (creado_por)     REFERENCES usuarios(id),
    INDEX idx_rpp_estudiante (estudiante_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;