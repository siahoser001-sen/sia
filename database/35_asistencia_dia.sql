-- Asistencia compartida por curso: una fila por estudiante y fecha.
USE sia_db;

CREATE TABLE IF NOT EXISTS asistencia_dia (
  id              CHAR(36) NOT NULL PRIMARY KEY DEFAULT (UUID()),
  institucion_id  CHAR(36) NOT NULL,
  grupo_id        CHAR(36) NOT NULL,
  estudiante_id   CHAR(36) NOT NULL,
  fecha           DATE NOT NULL,
  estado          ENUM('asistio','falta','tarde','justificada') NOT NULL,
  motivo          TEXT NULL,
  archivo_url     VARCHAR(500) NULL,
  archivo_nombre  VARCHAR(255) NULL,
  registrado_por  CHAR(36) NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_asistencia_dia_grupo_estudiante_fecha (grupo_id, estudiante_id, fecha),
  KEY idx_asistencia_dia_grupo_fecha (grupo_id, fecha),
  KEY idx_asistencia_dia_estudiante_fecha (estudiante_id, fecha),
  CONSTRAINT fk_asistencia_dia_institucion FOREIGN KEY (institucion_id)
    REFERENCES instituciones (id) ON DELETE CASCADE,
  CONSTRAINT fk_asistencia_dia_grupo FOREIGN KEY (grupo_id)
    REFERENCES grupos (id) ON DELETE CASCADE,
  CONSTRAINT fk_asistencia_dia_estudiante FOREIGN KEY (estudiante_id)
    REFERENCES usuarios (id) ON DELETE CASCADE,
  CONSTRAINT fk_asistencia_dia_registrado_por FOREIGN KEY (registrado_por)
    REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
