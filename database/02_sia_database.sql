-- ============================================================
--  SIA v2 — Tablas adicionales
--  Ejecutar DESPUÉS de sia_database.sql (ya existente)
--  Agrega: solicitudes institucionales, solicitudes docentes,
--  notificaciones internas del sistema.
-- ============================================================

SET search_path TO sia, public;

-- ============================================================
--  TABLA: solicitudes_instituciones
--  Flujo: formulario público → pendiente → superadmin aprueba/rechaza
--  Mientras está pendiente, NO existe en la tabla instituciones.
--  Solo al aprobar se crea la institución oficial.
-- ============================================================
CREATE TYPE estado_solicitud AS ENUM ('pendiente', 'aprobada', 'rechazada');

CREATE TABLE solicitudes_instituciones (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre           VARCHAR(200) NOT NULL,
    codigo_dane      VARCHAR(12)  NOT NULL,
    email            VARCHAR(150) NOT NULL,
    telefono         VARCHAR(20),
    municipio        VARCHAR(100),
    departamento     VARCHAR(100),
    -- Datos del rector/admin que registra
    admin_nombre     VARCHAR(150) NOT NULL,
    admin_email      VARCHAR(150) NOT NULL,
    admin_password   TEXT         NOT NULL,   -- bcrypt hash (se hashea antes de guardar)
    -- Control de estado
    estado           estado_solicitud NOT NULL DEFAULT 'pendiente',
    motivo_rechazo   TEXT,                    -- Solo se llena si estado = 'rechazada'
    revisado_por     UUID REFERENCES usuarios(id),   -- El superadmin que revisó
    revisado_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE solicitudes_instituciones IS
  'Solicitudes de registro de colegios. Pendientes hasta que el superadmin aprueba. Al aprobar se crean registros en instituciones y usuarios.';

-- ============================================================
--  TABLA: solicitudes_docentes
--  Flujo: docente se registra → pendiente → admin del colegio aprueba
--  El docente NO puede entrar al sistema hasta ser aprobado.
--  Al aprobar se activa su cuenta en usuarios.
-- ============================================================
CREATE TABLE solicitudes_docentes (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institucion_id   UUID         NOT NULL REFERENCES instituciones(id) ON DELETE CASCADE,
    nombres          VARCHAR(100) NOT NULL,
    apellidos        VARCHAR(100) NOT NULL,
    tipo_documento   VARCHAR(10)  NOT NULL DEFAULT 'CC',
    numero_documento VARCHAR(20)  NOT NULL,
    email            VARCHAR(150) NOT NULL,
    telefono         VARCHAR(20),
    password_hash    TEXT         NOT NULL,
    -- Control
    estado           estado_solicitud NOT NULL DEFAULT 'pendiente',
    motivo_rechazo   TEXT,
    revisado_por     UUID REFERENCES usuarios(id),   -- El admin institucional que revisó
    revisado_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_solicitud_docente UNIQUE (institucion_id, email)
);

COMMENT ON TABLE solicitudes_docentes IS
  'Solicitudes de registro de docentes por institución. El admin institucional las aprueba o rechaza.';

-- ============================================================
--  TABLA: notificaciones
--  Notificaciones internas del sistema (no correo, sino el
--  ícono de campanita dentro del dashboard).
--  Complementa los correos automáticos de Nodemailer.
-- ============================================================
CREATE TYPE tipo_notificacion AS ENUM (
    'solicitud_institucion',   -- Nueva institución pendiente → al superadmin
    'solicitud_docente',       -- Nuevo docente pendiente → al admin institucional
    'aprobacion',              -- Tu solicitud fue aprobada → al solicitante
    'rechazo',                 -- Tu solicitud fue rechazada → al solicitante
    'comunicado',              -- Nuevo comunicado publicado → según visibilidad
    'nota_publicada',          -- Docente publicó notas → al estudiante/acudiente
    'tarea_asignada',          -- Nueva tarea → al estudiante
    'entrega_calificada'       -- Docente calificó entrega → al estudiante
);

CREATE TABLE notificaciones (
    id            UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
    destinatario  UUID              NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo          tipo_notificacion NOT NULL,
    titulo        VARCHAR(200)      NOT NULL,
    mensaje       TEXT              NOT NULL,
    leida         BOOLEAN           NOT NULL DEFAULT FALSE,
    -- Referencia opcional a la entidad relacionada
    ref_id        UUID,             -- ID de la solicitud, comunicado, nota, etc.
    ref_tabla     VARCHAR(60),      -- 'solicitudes_docentes', 'comunicados', etc.
    created_at    TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notif_destinatario ON notificaciones(destinatario, leida);

COMMENT ON TABLE notificaciones IS
  'Notificaciones internas del sistema (campanita del dashboard). Complementa los correos automáticos.';
