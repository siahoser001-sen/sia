-- ============================================================
--  SIA — Sistema de Información Académica
--  Motor: PostgreSQL 14+
--  Autor: Oscar Andrés Navarro Ochoa
--  Proyecto SENA Ficha 3407184 — Teleinformática y Bases de Datos
--  Versión: 1.0
-- ============================================================

-- ============================================================
--  EXTENSIONES
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- UUIDs automáticos
CREATE EXTENSION IF NOT EXISTS "pgcrypto";     -- Hashing de contraseñas

-- ============================================================
--  ESQUEMA PRINCIPAL
-- ============================================================
CREATE SCHEMA IF NOT EXISTS sia;
SET search_path TO sia, public;

-- ============================================================
--  TABLA: instituciones
--  Guarda cada colegio o sede registrada en el sistema.
--  Una institución puede tener varias sedes (misma tabla, campo sede_principal_id).
-- ============================================================
CREATE TABLE instituciones (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre              VARCHAR(200)  NOT NULL,
    nit                 VARCHAR(20)   UNIQUE,                   -- NIT del colegio
    codigo_dane         VARCHAR(12)   UNIQUE,                   -- Código DANE MEN
    direccion           VARCHAR(300),
    municipio           VARCHAR(100),
    departamento        VARCHAR(100)  DEFAULT 'Antioquia',
    telefono            VARCHAR(20),
    email_institucional VARCHAR(150),
    logo_url            TEXT,                                   -- URL al archivo de logo (ver sección archivos)
    sede_principal_id   UUID REFERENCES instituciones(id),     -- NULL = es sede principal
    activa              BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE instituciones IS 'Colegios y sedes registradas en SIA.';
COMMENT ON COLUMN instituciones.codigo_dane IS 'Código único del MEN para identificar instituciones educativas en Colombia.';
COMMENT ON COLUMN instituciones.sede_principal_id IS 'Si es NULL, este registro ES la sede principal. Si tiene valor, es una sede secundaria.';

-- ============================================================
--  TABLA: periodos_academicos
--  Año escolar dividido en períodos (bimestres, trimestres, semestres).
--  Cada institución maneja sus propios períodos.
-- ============================================================
CREATE TABLE periodos_academicos (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institucion_id   UUID          NOT NULL REFERENCES instituciones(id) ON DELETE CASCADE,
    nombre           VARCHAR(100)  NOT NULL,   -- Ej: "Período 1 - 2025", "Semestre A 2025"
    anio_lectivo     SMALLINT      NOT NULL,   -- Ej: 2025
    numero_periodo   SMALLINT      NOT NULL,   -- 1, 2, 3, 4...
    fecha_inicio     DATE          NOT NULL,
    fecha_fin        DATE          NOT NULL,
    activo           BOOLEAN       NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_fechas CHECK (fecha_fin > fecha_inicio),
    CONSTRAINT uq_periodo  UNIQUE (institucion_id, anio_lectivo, numero_periodo)
);

COMMENT ON TABLE periodos_academicos IS 'Períodos del año escolar por institución (bimestres, trimestres, etc).';

-- ============================================================
--  TABLA: grados
--  Niveles educativos: Preescolar, 1°, 2°... 11°
--  (SIA cubre Preescolar hasta 7° según concepto original)
-- ============================================================
CREATE TABLE grados (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institucion_id UUID         NOT NULL REFERENCES instituciones(id) ON DELETE CASCADE,
    nombre         VARCHAR(50)  NOT NULL,   -- Ej: "Primero", "Segundo", "Transición"
    nivel          VARCHAR(30)  NOT NULL,   -- 'preescolar', 'primaria', 'secundaria'
    orden          SMALLINT     NOT NULL,   -- Para ordenar: 0=Transición, 1=1°, 2=2°...
    activo         BOOLEAN      NOT NULL DEFAULT TRUE,

    CONSTRAINT uq_grado UNIQUE (institucion_id, nombre)
);

COMMENT ON TABLE grados IS 'Grados académicos por institución (Transición, 1°, 2°... 7°).';
COMMENT ON COLUMN grados.orden IS 'Número para ordenar los grados cronológicamente en listados.';

-- ============================================================
--  TABLA: grupos
--  Cada grado puede tener varios grupos: 1°A, 1°B, etc.
-- ============================================================
CREATE TABLE grupos (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    grado_id       UUID         NOT NULL REFERENCES grados(id) ON DELETE CASCADE,
    nombre         VARCHAR(10)  NOT NULL,   -- 'A', 'B', 'C' o '01', '02'
    capacidad_max  SMALLINT     DEFAULT 35,
    activo         BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_grupo UNIQUE (grado_id, nombre)
);

COMMENT ON TABLE grupos IS 'Grupos o salones dentro de cada grado (1°A, 1°B, etc).';

-- ============================================================
--  TABLA: areas
--  Áreas del conocimiento: Matemáticas, Lenguaje, Ciencias, etc.
--  Son globales (no dependen de la institución) para estandarizar.
-- ============================================================
CREATE TABLE areas (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre      VARCHAR(100) NOT NULL UNIQUE,   -- "Matemáticas", "Lenguaje y Comunicación"
    descripcion TEXT,
    color_hex   CHAR(7) DEFAULT '#4A90D9',       -- Color para la UI: #RRGGBB
    icono       VARCHAR(50)                       -- Nombre del ícono (Lucide, FontAwesome, etc.)
);

COMMENT ON TABLE areas IS 'Áreas del conocimiento (globales, estandarizadas para todas las instituciones).';

INSERT INTO areas (nombre, color_hex, icono) VALUES
    ('Matemáticas',                '#E74C3C', 'calculator'),
    ('Lenguaje y Comunicación',    '#3498DB', 'book-open'),
    ('Ciencias Naturales',         '#27AE60', 'leaf'),
    ('Ciencias Sociales',          '#F39C12', 'globe'),
    ('Educación Artística',        '#9B59B6', 'palette'),
    ('Educación Física',           '#1ABC9C', 'activity'),
    ('Tecnología e Informática',   '#2C3E50', 'monitor'),
    ('Inglés',                     '#E67E22', 'message-circle'),
    ('Ética y Valores',            '#795548', 'heart'),
    ('Religión',                   '#607D8B', 'sun');

-- ============================================================
--  TABLA: materias
--  Asignatura concreta dentro de un área, asignada a un grado.
--  Ej: "Álgebra" (área Matemáticas, Grado 7°)
-- ============================================================
CREATE TABLE materias (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    area_id        UUID         NOT NULL REFERENCES areas(id),
    grado_id       UUID         NOT NULL REFERENCES grados(id) ON DELETE CASCADE,
    nombre         VARCHAR(150) NOT NULL,
    descripcion    TEXT,
    intensidad_hs  SMALLINT,   -- Horas semanales
    activa         BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_materia UNIQUE (area_id, grado_id, nombre)
);

COMMENT ON TABLE materias IS 'Asignatura específica ligada a un área y a un grado (Álgebra en 7°, etc).';

-- ============================================================
--  TABLA: usuarios
--  Tabla unificada de personas del sistema.
--  El ROL determina qué puede hacer cada usuario.
--  Incluye: estudiantes, profesores, directivos, padres, admins.
-- ============================================================
CREATE TYPE rol_usuario AS ENUM (
    'superadmin',    -- Admin global del sistema SIA
    'admin',         -- Directivo/rector de la institución
    'docente',       -- Profesor
    'estudiante',    -- Alumno
    'acudiente'      -- Padre de familia o tutor
);

CREATE TABLE usuarios (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institucion_id   UUID          REFERENCES instituciones(id),   -- NULL solo para superadmin
    rol              rol_usuario   NOT NULL,
    nombres          VARCHAR(100)  NOT NULL,
    apellidos        VARCHAR(100)  NOT NULL,
    tipo_documento   VARCHAR(10)   NOT NULL DEFAULT 'CC',   -- CC, TI, CE, PEP, etc.
    numero_documento VARCHAR(20)   NOT NULL,
    email            VARCHAR(150)  UNIQUE,
    telefono         VARCHAR(20),
    direccion        VARCHAR(300),
    fecha_nacimiento DATE,
    genero           CHAR(1),                               -- 'M', 'F', 'O' (Otro)
    foto_url         TEXT,                                  -- URL al archivo de foto
    password_hash    TEXT,                                  -- bcrypt hash
    activo           BOOLEAN       NOT NULL DEFAULT TRUE,
    ultimo_acceso    TIMESTAMPTZ,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_documento UNIQUE (tipo_documento, numero_documento)
);

CREATE INDEX idx_usuarios_institucion ON usuarios(institucion_id);
CREATE INDEX idx_usuarios_rol         ON usuarios(rol);
CREATE INDEX idx_usuarios_email       ON usuarios(email);

COMMENT ON TABLE usuarios IS 'Tabla unificada de todos los usuarios del sistema (estudiantes, docentes, admins, acudientes).';
COMMENT ON COLUMN usuarios.password_hash IS 'Hash bcrypt de la contraseña. NUNCA guardar contraseña en texto plano.';
COMMENT ON COLUMN usuarios.foto_url IS 'URL relativa o absoluta al archivo de foto de perfil (guardado en sistema de archivos o S3).';

-- ============================================================
--  TABLA: docentes_materias
--  Qué profesor dicta qué materia en qué grupo y período.
--  Relación N:M entre docentes, materias y grupos.
-- ============================================================
CREATE TABLE docentes_materias (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    docente_id   UUID  NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    materia_id   UUID  NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
    grupo_id     UUID  NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
    periodo_id   UUID  NOT NULL REFERENCES periodos_academicos(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_docente_materia UNIQUE (docente_id, materia_id, grupo_id, periodo_id)
);

COMMENT ON TABLE docentes_materias IS 'Asignación de docentes a materias y grupos por período académico.';

-- ============================================================
--  TABLA: matriculas
--  Inscripción formal de un estudiante a un grupo en un año lectivo.
--  Un estudiante puede cambiar de grupo (nueva matrícula, estado='inactivo' en la anterior).
-- ============================================================
CREATE TYPE estado_matricula AS ENUM ('activa', 'retirada', 'trasladada', 'graduada');

CREATE TABLE matriculas (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    estudiante_id  UUID             NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    grupo_id       UUID             NOT NULL REFERENCES grupos(id)   ON DELETE CASCADE,
    anio_lectivo   SMALLINT         NOT NULL,
    fecha_ingreso  DATE             NOT NULL DEFAULT CURRENT_DATE,
    fecha_retiro   DATE,
    estado         estado_matricula NOT NULL DEFAULT 'activa',
    observaciones  TEXT,
    created_at     TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_matricula UNIQUE (estudiante_id, grupo_id, anio_lectivo)
);

CREATE INDEX idx_matriculas_estudiante ON matriculas(estudiante_id);
CREATE INDEX idx_matriculas_grupo      ON matriculas(grupo_id);

COMMENT ON TABLE matriculas IS 'Matrícula formal del estudiante a un grupo por año lectivo.';

-- ============================================================
--  TABLA: acudientes_estudiantes
--  Relaciona padres/tutores con sus hijos (un acudiente puede
--  tener varios hijos; un estudiante puede tener varios acudientes).
-- ============================================================
CREATE TABLE acudientes_estudiantes (
    acudiente_id   UUID        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    estudiante_id  UUID        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    parentesco     VARCHAR(50) DEFAULT 'Acudiente',   -- 'Padre', 'Madre', 'Abuelo', etc.
    es_principal   BOOLEAN     NOT NULL DEFAULT FALSE,

    PRIMARY KEY (acudiente_id, estudiante_id)
);

COMMENT ON TABLE acudientes_estudiantes IS 'Relación entre acudientes (padres/tutores) y sus estudiantes.';

-- ============================================================
--  TABLA: notas
--  Calificaciones por estudiante, materia, período y tipo de evaluación.
--  PONDERACIÓN: cada nota tiene un peso (porcentaje) configurable.
-- ============================================================
CREATE TABLE notas (
    id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    estudiante_id  UUID          NOT NULL REFERENCES usuarios(id)         ON DELETE CASCADE,
    materia_id     UUID          NOT NULL REFERENCES materias(id)         ON DELETE CASCADE,
    periodo_id     UUID          NOT NULL REFERENCES periodos_academicos(id),
    docente_id     UUID          NOT NULL REFERENCES usuarios(id),
    tipo_nota      VARCHAR(60)   NOT NULL,   -- 'Taller', 'Examen', 'Proyecto', 'Participación', etc.
    descripcion    VARCHAR(200),             -- Descripción breve de la evaluación
    valor          NUMERIC(5,2)  NOT NULL,   -- La nota: 0.00 – 10.00 (o 0–5 según institución)
    valor_max      NUMERIC(5,2)  NOT NULL DEFAULT 10.00,
    peso_pct       NUMERIC(5,2)  NOT NULL DEFAULT 100.00,  -- % que representa esta nota en el período
    fecha_eval     DATE          NOT NULL DEFAULT CURRENT_DATE,
    observacion    TEXT,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_valor     CHECK (valor >= 0 AND valor <= valor_max),
    CONSTRAINT chk_peso      CHECK (peso_pct > 0 AND peso_pct <= 100),
    CONSTRAINT chk_valor_max CHECK (valor_max > 0)
);

CREATE INDEX idx_notas_estudiante ON notas(estudiante_id);
CREATE INDEX idx_notas_materia    ON notas(materia_id);
CREATE INDEX idx_notas_periodo    ON notas(periodo_id);

COMMENT ON TABLE notas IS 'Calificaciones individuales por estudiante, materia y período.';
COMMENT ON COLUMN notas.peso_pct IS 'Porcentaje que esta nota representa dentro del período. La suma de pesos por estudiante+materia+período debería ser 100%.';
COMMENT ON COLUMN notas.valor_max IS 'Nota máxima posible (puede ser 5.0, 10.0, 100.0 según configuración).';

-- ============================================================
--  TABLA: asistencia
--  Registro diario de asistencia por estudiante y materia.
-- ============================================================
CREATE TYPE estado_asistencia AS ENUM ('presente', 'ausente', 'tarde', 'excusado');

CREATE TABLE asistencia (
    id             UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
    estudiante_id  UUID              NOT NULL REFERENCES usuarios(id)   ON DELETE CASCADE,
    materia_id     UUID              NOT NULL REFERENCES materias(id)   ON DELETE CASCADE,
    docente_id     UUID              NOT NULL REFERENCES usuarios(id),
    fecha          DATE              NOT NULL,
    estado         estado_asistencia NOT NULL DEFAULT 'presente',
    observacion    VARCHAR(200),
    created_at     TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_asistencia UNIQUE (estudiante_id, materia_id, fecha)
);

CREATE INDEX idx_asistencia_estudiante ON asistencia(estudiante_id);
CREATE INDEX idx_asistencia_fecha      ON asistencia(fecha);

COMMENT ON TABLE asistencia IS 'Registro diario de asistencia a clases.';

-- ============================================================
--  TABLA: archivos
--  Metadatos de TODOS los archivos subidos al sistema.
--  Los archivos físicos se guardan en disco o S3 (ver documentación).
--  Esta tabla solo guarda la referencia y metadatos.
-- ============================================================
CREATE TYPE tipo_archivo AS ENUM (
    'recurso_clase',    -- Material educativo subido por el docente
    'tarea_entregada',  -- Entrega de tarea de un estudiante
    'foto_perfil',      -- Foto de usuario
    'logo_institucion', -- Logo del colegio
    'comunicado',       -- Documento de comunicado oficial
    'otro'
);

CREATE TABLE archivos (
    id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    subido_por      UUID          NOT NULL REFERENCES usuarios(id),
    tipo            tipo_archivo  NOT NULL DEFAULT 'otro',
    nombre_original VARCHAR(255)  NOT NULL,   -- Nombre con el que el usuario subió el archivo
    nombre_storage  VARCHAR(255)  NOT NULL,   -- Nombre en disco (UUID + extensión, evita colisiones)
    ruta_storage    TEXT          NOT NULL,   -- Ruta relativa en el servidor o key en S3
    mime_type       VARCHAR(100),             -- 'application/pdf', 'image/png', etc.
    tamanio_bytes   BIGINT,
    es_publico      BOOLEAN       NOT NULL DEFAULT FALSE,
    -- Referencias opcionales: a qué entidad pertenece este archivo
    ref_materia_id  UUID          REFERENCES materias(id),
    ref_nota_id     UUID          REFERENCES notas(id),
    ref_grupo_id    UUID          REFERENCES grupos(id),
    descripcion     TEXT,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_archivos_subido_por ON archivos(subido_por);
CREATE INDEX idx_archivos_tipo       ON archivos(tipo);

COMMENT ON TABLE archivos IS 'Metadatos de archivos subidos. El archivo físico vive en disco/S3, esta tabla solo lo referencia.';
COMMENT ON COLUMN archivos.nombre_storage IS 'Nombre único generado por el sistema para evitar colisiones (ej: uuid4.pdf).';
COMMENT ON COLUMN archivos.ruta_storage   IS 'Ruta relativa ej: /uploads/recursos/2025/ o key S3 ej: sia/recursos/uuid.pdf';

-- ============================================================
--  TABLA: tareas
--  Actividades o tareas asignadas por el docente a un grupo.
-- ============================================================
CREATE TABLE tareas (
    id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    docente_id     UUID        NOT NULL REFERENCES usuarios(id),
    materia_id     UUID        NOT NULL REFERENCES materias(id)  ON DELETE CASCADE,
    grupo_id       UUID        NOT NULL REFERENCES grupos(id)    ON DELETE CASCADE,
    periodo_id     UUID        NOT NULL REFERENCES periodos_academicos(id),
    titulo         VARCHAR(200) NOT NULL,
    descripcion    TEXT,
    fecha_asig     DATE         NOT NULL DEFAULT CURRENT_DATE,
    fecha_entrega  DATE         NOT NULL,
    valor_max      NUMERIC(5,2) DEFAULT 10.00,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_fecha_tarea CHECK (fecha_entrega >= fecha_asig)
);

COMMENT ON TABLE tareas IS 'Actividades o tareas asignadas a un grupo por el docente.';

-- ============================================================
--  TABLA: entregas_tareas
--  Entrega de una tarea por parte de un estudiante.
-- ============================================================
CREATE TYPE estado_entrega AS ENUM ('pendiente', 'entregada', 'tarde', 'calificada');

CREATE TABLE entregas_tareas (
    id              UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    tarea_id        UUID           NOT NULL REFERENCES tareas(id)   ON DELETE CASCADE,
    estudiante_id   UUID           NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    archivo_id      UUID           REFERENCES archivos(id),          -- Archivo adjunto (opcional)
    comentario      TEXT,
    estado          estado_entrega NOT NULL DEFAULT 'pendiente',
    calificacion    NUMERIC(5,2),
    feedback_doc    TEXT,                                            -- Retroalimentación del docente
    fecha_entrega   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_entrega UNIQUE (tarea_id, estudiante_id)
);

COMMENT ON TABLE entregas_tareas IS 'Entrega y calificación de tareas por estudiante.';

-- ============================================================
--  TABLA: comunicados
--  Mensajes o avisos institucionales: circulares, eventos,
--  noticias. Visible según el rol/grupo destino.
-- ============================================================
CREATE TABLE comunicados (
    id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    autor_id       UUID        NOT NULL REFERENCES usuarios(id),
    institucion_id UUID        NOT NULL REFERENCES instituciones(id) ON DELETE CASCADE,
    titulo         VARCHAR(200) NOT NULL,
    cuerpo         TEXT         NOT NULL,
    tipo           VARCHAR(50)  DEFAULT 'general',   -- 'general', 'evento', 'urgente', 'circular'
    fecha_inicio   DATE         NOT NULL DEFAULT CURRENT_DATE,
    fecha_fin      DATE,                              -- NULL = sin expiración
    para_rol       rol_usuario,                       -- NULL = para todos
    para_grado_id  UUID         REFERENCES grados(id),
    para_grupo_id  UUID         REFERENCES grupos(id),
    archivo_id     UUID         REFERENCES archivos(id),   -- Adjunto opcional
    publicado      BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_comunicados_institucion ON comunicados(institucion_id);
CREATE INDEX idx_comunicados_fecha       ON comunicados(fecha_inicio);

COMMENT ON TABLE comunicados IS 'Comunicados, circulares y eventos institucionales.';
COMMENT ON COLUMN comunicados.para_rol IS 'Si es NULL aplica para todos. Si tiene valor, solo para ese rol.';

-- ============================================================
--  TABLA: horarios
--  Horario de clases semanal: qué materia, en qué grupo,
--  qué día, a qué hora.
-- ============================================================
CREATE TABLE horarios (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    grupo_id     UUID        NOT NULL REFERENCES grupos(id)    ON DELETE CASCADE,
    materia_id   UUID        NOT NULL REFERENCES materias(id)  ON DELETE CASCADE,
    docente_id   UUID        NOT NULL REFERENCES usuarios(id),
    dia_semana   SMALLINT    NOT NULL,   -- 1=Lunes, 2=Martes ... 5=Viernes
    hora_inicio  TIME        NOT NULL,
    hora_fin     TIME        NOT NULL,
    aula         VARCHAR(50),            -- 'Salón 201', 'Lab. Sistemas', etc.
    periodo_id   UUID        NOT NULL REFERENCES periodos_academicos(id),

    CONSTRAINT chk_hora      CHECK (hora_fin > hora_inicio),
    CONSTRAINT chk_dia       CHECK (dia_semana BETWEEN 1 AND 7),
    CONSTRAINT uq_horario    UNIQUE (grupo_id, dia_semana, hora_inicio, periodo_id)
);

COMMENT ON TABLE horarios IS 'Horario semanal de clases por grupo, materia y docente.';

-- ============================================================
--  TABLA: configuracion_institución
--  Parámetros configurables por institución:
--  escala de notas, nombre de períodos, etc.
-- ============================================================
CREATE TABLE configuracion (
    id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    institucion_id   UUID          NOT NULL REFERENCES instituciones(id) ON DELETE CASCADE UNIQUE,
    nota_minima      NUMERIC(5,2)  NOT NULL DEFAULT 1.0,    -- Nota mínima aprobatoria
    nota_maxima      NUMERIC(5,2)  NOT NULL DEFAULT 5.0,    -- Nota máxima del sistema
    nota_aprobatoria NUMERIC(5,2)  NOT NULL DEFAULT 3.0,    -- Nota para aprobar
    num_periodos     SMALLINT      NOT NULL DEFAULT 4,      -- Cantidad de períodos al año
    tipo_periodo     VARCHAR(20)   NOT NULL DEFAULT 'bimestre', -- 'bimestre','trimestre','semestre'
    permite_acudiente_ver_notas BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_notas CHECK (nota_minima < nota_maxima AND nota_aprobatoria <= nota_maxima)
);

COMMENT ON TABLE configuracion IS 'Parámetros académicos configurables por institución (escala, períodos, etc).';

-- ============================================================
--  VISTA: resumen_notas_periodo
--  Calcula el promedio ponderado por estudiante/materia/período.
--  Útil para boletines y reportes sin cálculos repetidos.
-- ============================================================
CREATE VIEW sia.resumen_notas_periodo AS
SELECT
    n.estudiante_id,
    u.nombres || ' ' || u.apellidos  AS estudiante,
    n.materia_id,
    m.nombre                          AS materia,
    n.periodo_id,
    p.nombre                          AS periodo,
    ROUND(
        SUM(n.valor * n.peso_pct / n.valor_max) / NULLIF(SUM(n.peso_pct), 0) * (
            SELECT cfg.nota_maxima
            FROM sia.configuracion cfg
            WHERE cfg.institucion_id = (
                SELECT g.id FROM sia.instituciones g LIMIT 1  -- se refina en queries reales
            )
            LIMIT 1
        ),
    2) AS promedio_ponderado,
    COUNT(n.id)                        AS total_evaluaciones
FROM sia.notas n
JOIN sia.usuarios  u ON u.id = n.estudiante_id
JOIN sia.materias  m ON m.id = n.materia_id
JOIN sia.periodos_academicos p ON p.id = n.periodo_id
GROUP BY n.estudiante_id, u.nombres, u.apellidos,
         n.materia_id, m.nombre, n.periodo_id, p.nombre;

COMMENT ON VIEW resumen_notas_periodo IS 'Promedio ponderado por estudiante, materia y período. Base para boletines.';

-- ============================================================
--  FUNCIÓN: actualizar updated_at automáticamente
--  Trigger para mantener updated_at sincronizado en todas las tablas.
-- ============================================================
CREATE OR REPLACE FUNCTION sia.fn_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Aplicar el trigger a todas las tablas con updated_at
CREATE TRIGGER trg_instituciones_upd   BEFORE UPDATE ON sia.instituciones   FOR EACH ROW EXECUTE FUNCTION sia.fn_updated_at();
CREATE TRIGGER trg_usuarios_upd        BEFORE UPDATE ON sia.usuarios         FOR EACH ROW EXECUTE FUNCTION sia.fn_updated_at();
CREATE TRIGGER trg_notas_upd           BEFORE UPDATE ON sia.notas            FOR EACH ROW EXECUTE FUNCTION sia.fn_updated_at();
CREATE TRIGGER trg_entregas_upd        BEFORE UPDATE ON sia.entregas_tareas  FOR EACH ROW EXECUTE FUNCTION sia.fn_updated_at();
CREATE TRIGGER trg_configuracion_upd   BEFORE UPDATE ON sia.configuracion    FOR EACH ROW EXECUTE FUNCTION sia.fn_updated_at();

-- ============================================================
--  DATOS SEMILLA: usuarios de prueba
-- ============================================================

-- Institución de prueba
INSERT INTO sia.instituciones (nombre, nit, municipio, departamento)
VALUES ('Institución Educativa Demo SIA', '900123456-1', 'Medellín', 'Antioquia');

-- Superadmin del sistema
INSERT INTO sia.usuarios (rol, nombres, apellidos, tipo_documento, numero_documento, email, password_hash)
VALUES (
    'superadmin',
    'Oscar Andrés', 'Navarro Ochoa',
    'CC', '1000000001',
    'admin@sia.edu.co',
    crypt('Admin2025!', gen_salt('bf'))   -- Hash bcrypt generado con pgcrypto
);

-- ============================================================
--  FIN DEL SCRIPT
-- ============================================================
