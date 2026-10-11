-- =====================================================================
-- 17_calendario_eventos.sql
-- Calendario anual + eventos + cierre de periodo (sección 7 del
-- ROADMAP). Decisiones confirmadas por el usuario (2026-08-19):
--   - Estilo de calendario: híbrido mini-calendario + detalle del día
--     (frontend/calendario.html) — no afecta el schema, solo el diseño.
--   - Cierre de periodo: el admin lo agrega A MANO como un evento
--     aparte (tipo='cierre_periodo'); NO se deriva automáticamente de
--     periodos_academicos.fecha_fin. periodo_id es opcional, solo para
--     poder referenciar visualmente a cuál periodo pertenece ese cierre
--     si el admin lo quiere ligar (no crea el evento por sí solo).
--   - Quién puede crear eventos: admin/superadmin (cualquier evento de
--     su institución, general o por curso) + docente director de curso
--     (solo eventos de SU curso puntual, grupo_id = el que dirige).
--     Se valida en el controller (src/controllers/calendario.controller.js),
--     igual que el patrón ya usado en resumen.controller.js para
--     "director de curso" (grupos.director_id).
-- =====================================================================

USE sia_db;

CREATE TABLE calendario_eventos (
    id             CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    institucion_id CHAR(36)     NOT NULL,
    -- NULL = evento de todo el colegio (solo admin/superadmin lo crea).
    -- Con valor = evento visible solo para ese curso puntual (admin o
    -- el docente director de ese grupo).
    grupo_id       CHAR(36)     NULL,
    -- Solo para tipo='cierre_periodo', referencia opcional e informativa
    -- al periodo que se está cerrando (no genera el evento automático).
    periodo_id     CHAR(36)     NULL,
    creado_por     CHAR(36)     NOT NULL,
    titulo         VARCHAR(150) NOT NULL,
    descripcion    TEXT,
    fecha          DATE         NOT NULL,
    tipo           ENUM('general','cierre_periodo','otro') NOT NULL DEFAULT 'general',
    color_hex      VARCHAR(7)   DEFAULT NULL,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (institucion_id) REFERENCES instituciones(id)        ON DELETE CASCADE,
    FOREIGN KEY (grupo_id)       REFERENCES grupos(id)               ON DELETE CASCADE,
    FOREIGN KEY (periodo_id)     REFERENCES periodos_academicos(id)  ON DELETE SET NULL,
    FOREIGN KEY (creado_por)     REFERENCES usuarios(id)             ON DELETE CASCADE,
    INDEX idx_calendario_institucion (institucion_id),
    INDEX idx_calendario_grupo (grupo_id),
    INDEX idx_calendario_fecha (fecha)
);
