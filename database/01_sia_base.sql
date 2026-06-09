-- ============================================================
--  SIA — Base de datos MySQL
--  Ejecutar en MySQL Workbench sobre la base sia_db
--  Orden: primero este archivo, luego 02_sia_v2.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS sia_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE sia_db;

-- ── Áreas del conocimiento (globales) ────────────────────────
CREATE TABLE areas (
    id          CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    color_hex   CHAR(7)      DEFAULT '#4A90D9',
    icono       VARCHAR(50)
);

INSERT INTO areas (nombre, color_hex, icono) VALUES
    ('Matemáticas',              '#E74C3C', 'calculator'),
    ('Lenguaje y Comunicación',  '#3498DB', 'book-open'),
    ('Ciencias Naturales',       '#27AE60', 'leaf'),
    ('Ciencias Sociales',        '#F39C12', 'globe'),
    ('Educación Artística',      '#9B59B6', 'palette'),
    ('Educación Física',         '#1ABC9C', 'activity'),
    ('Tecnología e Informática', '#2C3E50', 'monitor'),
    ('Inglés',                   '#E67E22', 'message-circle'),
    ('Ética y Valores',          '#795548', 'heart'),
    ('Religión',                 '#607D8B', 'sun');

-- ── Instituciones ─────────────────────────────────────────────
CREATE TABLE instituciones (
    id                  CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    nombre              VARCHAR(200) NOT NULL,
    nit                 VARCHAR(20)  UNIQUE,
    codigo_dane         VARCHAR(12)  UNIQUE,
    direccion           VARCHAR(300),
    municipio           VARCHAR(100),
    departamento        VARCHAR(100) DEFAULT 'Antioquia',
    telefono            VARCHAR(20),
    email_institucional VARCHAR(150),
    logo_url            TEXT,
    sede_principal_id   CHAR(36)     REFERENCES instituciones(id),
    activa              BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ── Configuración por institución ────────────────────────────
CREATE TABLE configuracion (
    id               CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
    institucion_id   CHAR(36)      NOT NULL UNIQUE,
    nota_minima      DECIMAL(5,2)  NOT NULL DEFAULT 1.0,
    nota_maxima      DECIMAL(5,2)  NOT NULL DEFAULT 5.0,
    nota_aprobatoria DECIMAL(5,2)  NOT NULL DEFAULT 3.0,
    num_periodos     SMALLINT      NOT NULL DEFAULT 4,
    tipo_periodo     VARCHAR(20)   NOT NULL DEFAULT 'bimestre',
    permite_acudiente_ver_notas BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (institucion_id) REFERENCES instituciones(id) ON DELETE CASCADE
);

-- ── Periodos académicos ───────────────────────────────────────
CREATE TABLE periodos_academicos (
    id               CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    institucion_id   CHAR(36)     NOT NULL,
    nombre           VARCHAR(100) NOT NULL,
    anio_lectivo     SMALLINT     NOT NULL,
    numero_periodo   SMALLINT     NOT NULL,
    fecha_inicio     DATE         NOT NULL,
    fecha_fin        DATE         NOT NULL,
    activo           BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (institucion_id) REFERENCES instituciones(id) ON DELETE CASCADE,
    UNIQUE KEY uq_periodo (institucion_id, anio_lectivo, numero_periodo),
    CONSTRAINT chk_fechas CHECK (fecha_fin > fecha_inicio)
);

-- ── Grados ───────────────────────────────────────────────────
CREATE TABLE grados (
    id             CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
    institucion_id CHAR(36)    NOT NULL,
    nombre         VARCHAR(50) NOT NULL,
    nivel          VARCHAR(30) NOT NULL,
    orden          SMALLINT    NOT NULL,
    activo         BOOLEAN     NOT NULL DEFAULT TRUE,
    FOREIGN KEY (institucion_id) REFERENCES instituciones(id) ON DELETE CASCADE,
    UNIQUE KEY uq_grado (institucion_id, nombre)
);

-- ── Grupos ───────────────────────────────────────────────────
CREATE TABLE grupos (
    id             CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
    grado_id       CHAR(36)    NOT NULL,
    nombre         VARCHAR(10) NOT NULL,
    capacidad_max  SMALLINT    DEFAULT 35,
    activo         BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (grado_id) REFERENCES grados(id) ON DELETE CASCADE,
    UNIQUE KEY uq_grupo (grado_id, nombre)
);

-- ── Materias ─────────────────────────────────────────────────
CREATE TABLE materias (
    id             CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    area_id        CHAR(36)     NOT NULL,
    grado_id       CHAR(36)     NOT NULL,
    nombre         VARCHAR(150) NOT NULL,
    descripcion    TEXT,
    intensidad_hs  SMALLINT,
    activa         BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (area_id)   REFERENCES areas(id),
    FOREIGN KEY (grado_id)  REFERENCES grados(id) ON DELETE CASCADE,
    UNIQUE KEY uq_materia (area_id, grado_id, nombre)
);

-- ── Usuarios (tabla central) ──────────────────────────────────
CREATE TABLE usuarios (
    id               CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    institucion_id   CHAR(36),
    rol              ENUM('superadmin','admin','docente','estudiante','acudiente') NOT NULL,
    nombres          VARCHAR(100) NOT NULL,
    apellidos        VARCHAR(100) NOT NULL,
    tipo_documento   VARCHAR(10)  NOT NULL DEFAULT 'CC',
    numero_documento VARCHAR(20)  NOT NULL,
    email            VARCHAR(150) UNIQUE,
    telefono         VARCHAR(20),
    direccion        VARCHAR(300),
    fecha_nacimiento DATE,
    genero           CHAR(1),
    foto_url         TEXT,
    password_hash    TEXT,
    activo           BOOLEAN      NOT NULL DEFAULT TRUE,
    ultimo_acceso    DATETIME,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (institucion_id) REFERENCES instituciones(id),
    UNIQUE KEY uq_documento (tipo_documento, numero_documento),
    INDEX idx_rol (rol),
    INDEX idx_institucion (institucion_id)
);

-- Usuario superadmin inicial
-- Contraseña: Admin2025! (el hash se genera desde Node.js al insertar)
-- Este INSERT usa texto plano temporalmente — cámbialo desde el sistema
INSERT INTO usuarios (id, rol, nombres, apellidos, tipo_documento, numero_documento, email, password_hash, activo)
VALUES (
    UUID(),
    'superadmin',
    'Oscar Andrés', 'Navarro Ochoa',
    'CC', '1000000001',
    'admin@sia.edu.co',
    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- hash de 'Admin2025!'
    TRUE
);

-- ── Docentes por materia ──────────────────────────────────────
CREATE TABLE docentes_materias (
    id          CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    docente_id  CHAR(36) NOT NULL,
    materia_id  CHAR(36) NOT NULL,
    grupo_id    CHAR(36) NOT NULL,
    periodo_id  CHAR(36) NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (docente_id)  REFERENCES usuarios(id)            ON DELETE CASCADE,
    FOREIGN KEY (materia_id)  REFERENCES materias(id)            ON DELETE CASCADE,
    FOREIGN KEY (grupo_id)    REFERENCES grupos(id)              ON DELETE CASCADE,
    FOREIGN KEY (periodo_id)  REFERENCES periodos_academicos(id) ON DELETE CASCADE,
    UNIQUE KEY uq_docente_materia (docente_id, materia_id, grupo_id, periodo_id)
);

-- ── Matrículas ────────────────────────────────────────────────
CREATE TABLE matriculas (
    id            CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    estudiante_id CHAR(36)     NOT NULL,
    grupo_id      CHAR(36)     NOT NULL,
    anio_lectivo  SMALLINT     NOT NULL,
    fecha_ingreso DATE         NOT NULL DEFAULT (CURRENT_DATE),
    fecha_retiro  DATE,
    estado        ENUM('activa','retirada','trasladada','graduada') NOT NULL DEFAULT 'activa',
    observaciones TEXT,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (estudiante_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (grupo_id)      REFERENCES grupos(id)   ON DELETE CASCADE,
    UNIQUE KEY uq_matricula (estudiante_id, grupo_id, anio_lectivo),
    INDEX idx_estudiante (estudiante_id),
    INDEX idx_grupo (grupo_id)
);

-- ── Acudientes ────────────────────────────────────────────────
CREATE TABLE acudientes_estudiantes (
    acudiente_id  CHAR(36)    NOT NULL,
    estudiante_id CHAR(36)    NOT NULL,
    parentesco    VARCHAR(50) DEFAULT 'Acudiente',
    es_principal  BOOLEAN     NOT NULL DEFAULT FALSE,
    PRIMARY KEY (acudiente_id, estudiante_id),
    FOREIGN KEY (acudiente_id)  REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (estudiante_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- ── Notas ─────────────────────────────────────────────────────
CREATE TABLE notas (
    id            CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    estudiante_id CHAR(36)     NOT NULL,
    materia_id    CHAR(36)     NOT NULL,
    periodo_id    CHAR(36)     NOT NULL,
    docente_id    CHAR(36)     NOT NULL,
    tipo_nota     VARCHAR(60)  NOT NULL,
    descripcion   VARCHAR(200),
    valor         DECIMAL(5,2) NOT NULL,
    valor_max     DECIMAL(5,2) NOT NULL DEFAULT 10.00,
    peso_pct      DECIMAL(5,2) NOT NULL DEFAULT 100.00,
    fecha_eval    DATE         NOT NULL DEFAULT (CURRENT_DATE),
    observacion   TEXT,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (estudiante_id) REFERENCES usuarios(id)            ON DELETE CASCADE,
    FOREIGN KEY (materia_id)    REFERENCES materias(id)            ON DELETE CASCADE,
    FOREIGN KEY (periodo_id)    REFERENCES periodos_academicos(id),
    FOREIGN KEY (docente_id)    REFERENCES usuarios(id),
    INDEX idx_notas_estudiante (estudiante_id),
    INDEX idx_notas_materia    (materia_id),
    INDEX idx_notas_periodo    (periodo_id),
    CONSTRAINT chk_valor  CHECK (valor >= 0 AND valor <= valor_max),
    CONSTRAINT chk_peso   CHECK (peso_pct > 0 AND peso_pct <= 100)
);

-- ── Asistencia ────────────────────────────────────────────────
CREATE TABLE asistencia (
    id            CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    estudiante_id CHAR(36)     NOT NULL,
    materia_id    CHAR(36)     NOT NULL,
    docente_id    CHAR(36)     NOT NULL,
    fecha         DATE         NOT NULL,
    estado        ENUM('presente','ausente','tarde','excusado') NOT NULL DEFAULT 'presente',
    observacion   VARCHAR(200),
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (estudiante_id) REFERENCES usuarios(id)  ON DELETE CASCADE,
    FOREIGN KEY (materia_id)    REFERENCES materias(id)  ON DELETE CASCADE,
    FOREIGN KEY (docente_id)    REFERENCES usuarios(id),
    UNIQUE KEY uq_asistencia (estudiante_id, materia_id, fecha),
    INDEX idx_asistencia_fecha (fecha)
);

-- ── Archivos ─────────────────────────────────────────────────
CREATE TABLE archivos (
    id              CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    subido_por      CHAR(36)     NOT NULL,
    tipo            ENUM('recurso_clase','tarea_entregada','foto_perfil','logo_institucion','comunicado','otro') NOT NULL DEFAULT 'otro',
    nombre_original VARCHAR(255) NOT NULL,
    nombre_storage  VARCHAR(255) NOT NULL,
    ruta_storage    TEXT         NOT NULL,
    mime_type       VARCHAR(100),
    tamanio_bytes   BIGINT,
    es_publico      BOOLEAN      NOT NULL DEFAULT FALSE,
    ref_materia_id  CHAR(36),
    ref_nota_id     CHAR(36),
    ref_grupo_id    CHAR(36),
    descripcion     TEXT,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (subido_por) REFERENCES usuarios(id),
    INDEX idx_archivos_tipo (tipo)
);

-- ── Tareas ────────────────────────────────────────────────────
CREATE TABLE tareas (
    id            CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    docente_id    CHAR(36)     NOT NULL,
    materia_id    CHAR(36)     NOT NULL,
    grupo_id      CHAR(36)     NOT NULL,
    periodo_id    CHAR(36)     NOT NULL,
    titulo        VARCHAR(200) NOT NULL,
    descripcion   TEXT,
    fecha_asig    DATE         NOT NULL DEFAULT (CURRENT_DATE),
    fecha_entrega DATE         NOT NULL,
    valor_max     DECIMAL(5,2) DEFAULT 10.00,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (docente_id)  REFERENCES usuarios(id),
    FOREIGN KEY (materia_id)  REFERENCES materias(id) ON DELETE CASCADE,
    FOREIGN KEY (grupo_id)    REFERENCES grupos(id)   ON DELETE CASCADE,
    FOREIGN KEY (periodo_id)  REFERENCES periodos_academicos(id)
);

-- ── Entregas de tareas ────────────────────────────────────────
CREATE TABLE entregas_tareas (
    id            CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    tarea_id      CHAR(36)     NOT NULL,
    estudiante_id CHAR(36)     NOT NULL,
    archivo_id    CHAR(36),
    comentario    TEXT,
    estado        ENUM('pendiente','entregada','tarde','calificada') NOT NULL DEFAULT 'pendiente',
    calificacion  DECIMAL(5,2),
    feedback_doc  TEXT,
    fecha_entrega DATETIME,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (tarea_id)      REFERENCES tareas(id)   ON DELETE CASCADE,
    FOREIGN KEY (estudiante_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    UNIQUE KEY uq_entrega (tarea_id, estudiante_id)
);

-- ── Comunicados ───────────────────────────────────────────────
CREATE TABLE comunicados (
    id             CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    autor_id       CHAR(36)     NOT NULL,
    institucion_id CHAR(36)     NOT NULL,
    titulo         VARCHAR(200) NOT NULL,
    cuerpo         TEXT         NOT NULL,
    tipo           VARCHAR(50)  DEFAULT 'general',
    fecha_inicio   DATE         NOT NULL DEFAULT (CURRENT_DATE),
    fecha_fin      DATE,
    para_rol       ENUM('superadmin','admin','docente','estudiante','acudiente'),
    para_grado_id  CHAR(36),
    para_grupo_id  CHAR(36),
    archivo_id     CHAR(36),
    publicado      BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (autor_id)       REFERENCES usuarios(id),
    FOREIGN KEY (institucion_id) REFERENCES instituciones(id) ON DELETE CASCADE,
    INDEX idx_comunicados_fecha (fecha_inicio)
);

-- ── Horarios ─────────────────────────────────────────────────
CREATE TABLE horarios (
    id          CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
    grupo_id    CHAR(36)    NOT NULL,
    materia_id  CHAR(36)    NOT NULL,
    docente_id  CHAR(36)    NOT NULL,
    dia_semana  SMALLINT    NOT NULL,
    hora_inicio TIME        NOT NULL,
    hora_fin    TIME        NOT NULL,
    aula        VARCHAR(50),
    periodo_id  CHAR(36)    NOT NULL,
    FOREIGN KEY (grupo_id)   REFERENCES grupos(id)              ON DELETE CASCADE,
    FOREIGN KEY (materia_id) REFERENCES materias(id)            ON DELETE CASCADE,
    FOREIGN KEY (docente_id) REFERENCES usuarios(id),
    FOREIGN KEY (periodo_id) REFERENCES periodos_academicos(id),
    UNIQUE KEY uq_horario (grupo_id, dia_semana, hora_inicio, periodo_id),
    CONSTRAINT chk_hora CHECK (hora_fin > hora_inicio),
    CONSTRAINT chk_dia  CHECK (dia_semana BETWEEN 1 AND 7)
);

-- ── Vista: resumen de notas por período ──────────────────────
CREATE VIEW resumen_notas_periodo AS
SELECT
    n.estudiante_id,
    CONCAT(u.nombres, ' ', u.apellidos) AS estudiante,
    n.materia_id,
    m.nombre                             AS materia,
    n.periodo_id,
    p.nombre                             AS periodo,
    ROUND(
        SUM(n.valor * n.peso_pct / n.valor_max) / NULLIF(SUM(n.peso_pct), 0) * 5,
    2)                                   AS promedio_ponderado,
    COUNT(n.id)                          AS total_evaluaciones
FROM notas n
JOIN usuarios u ON u.id = n.estudiante_id
JOIN materias m ON m.id = n.materia_id
JOIN periodos_academicos p ON p.id = n.periodo_id
GROUP BY n.estudiante_id, u.nombres, u.apellidos,
         n.materia_id, m.nombre, n.periodo_id, p.nombre;
