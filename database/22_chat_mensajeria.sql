-- =====================================================================
-- 22_chat_mensajeria.sql
-- Centro de mensajería (chats estilo Messenger):
--  - `chats`: canal "institucion" (superadmin <-> institución) o par
--    "personal" (admin <-> docente/estudiante/acudiente).
--    ente_a/ente_b guardan los ids según el tipo:
--       institucion → ente_a = id del superadmin, ente_b = id de la institución
--       personal    → par canónico (el menor id primero) para no duplicar chats
--    `bloqueado_por` = quién bloqueó el chat (NULL = activo). Cualquier
--    participante puede bloquear; solo el que bloqueó puede desbloquear.
--  - `chat_mensajes`: mensajes de cada chat.
--  - `chat_config`: por institución, si cualquier usuario registrado puede
--    escribirle al admin (permitir_mensajes_abiertos) o solo si el admin
--    inició el chat (comportamiento por defecto).
-- =====================================================================

START TRANSACTION;

CREATE TABLE IF NOT EXISTS chats (
    id             CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    tipo           ENUM('institucion','personal') NOT NULL,
    ente_a         CHAR(36)     NOT NULL,
    ente_b         CHAR(36)     NOT NULL,
    institucion_id CHAR(36)     NULL,
    creado_por     CHAR(36)     NULL,
    bloqueado_por  CHAR(36)     NULL,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_chat_par (tipo, ente_a, ente_b),
    KEY idx_chat_inst (institucion_id),
    FOREIGN KEY (institucion_id) REFERENCES instituciones(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS chat_mensajes (
    id           CHAR(36)  PRIMARY KEY DEFAULT (UUID()),
    chat_id      CHAR(36)  NOT NULL,
    remitente_id CHAR(36)  NOT NULL,
    texto        TEXT      NOT NULL,
    leido        TINYINT(1) NOT NULL DEFAULT 0,
    created_at   DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chat_id)      REFERENCES chats(id)     ON DELETE CASCADE,
    FOREIGN KEY (remitente_id) REFERENCES usuarios(id)  ON DELETE CASCADE,
    KEY idx_msg_chat (chat_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS chat_config (
    institucion_id               CHAR(36)   PRIMARY KEY,
    permitir_mensajes_abiertos   BOOLEAN    NOT NULL DEFAULT FALSE,
    updated_at                   DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (institucion_id) REFERENCES instituciones(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

COMMIT;