# SIA — Sistema de Información Académica

> Proyecto académico SENA · Ficha 3407184 · Teleinformática y Bases de Datos  
> Autores: Oscar Andrés Navarro Ochoa - Juan Sebastian Calderon - Giovanny Esteban Reyes Rodriguez - Jhon Harold Hoyos Pacheco - Romel Sneider Toquica Corredor 

---

## Índice

1. [Cómo funciona el sistema](#1-cómo-funciona-el-sistema)
2. [Cómo se redirige según el rol](#2-cómo-se-redirige-según-el-rol)
3. [Cómo están conectadas las pantallas](#3-cómo-están-conectadas-las-pantallas)
4. [Cómo instalar MySQL Workbench](#4-cómo-instalar-mysql-workbench)
5. [Cómo instalar y ejecutar el proyecto](#5-cómo-instalar-y-ejecutar-el-proyecto)
6. [Ver registros en tiempo real](#6-ver-registros-en-tiempo-real)
7. [Estructura de archivos](#7-estructura-de-archivos)
8. [Diferencias entre MySQL y PostgreSQL](#8-diferencias-entre-mysql-y-postgresql)
9. [Solución de errores frecuentes](#9-solución-de-errores-frecuentes)

---

## 1. Cómo funciona el sistema

El SIA tiene dos partes:

**Backend** — carpeta `src/`, corre con Node.js en el puerto 3000. Nunca lo ve el usuario directamente. Recibe peticiones del frontend, consulta MySQL y devuelve JSON.

**Frontend** — carpeta `frontend/`, archivos HTML que se abren con Live Server en el puerto 5500. Se comunican con el backend usando `fetch()`.

```
Usuario hace clic
  → Frontend envía fetch() al backend
    → Backend consulta MySQL
      → MySQL responde
        → Backend responde con JSON
          → Frontend muestra el resultado
```

### Por qué se abre en la misma pestaña
El login usa `window.location.href = ruta` — esto cambia la URL de la pestaña actual, igual que cualquier sistema web real (Gmail, Google, etc.). No abre una pestaña nueva.

---

## 2. Cómo se redirige según el rol

Cuando el usuario inicia sesión:

1. El frontend envía email y contraseña al backend
2. El backend verifica la contraseña con bcrypt
3. Si es correcta, genera un JWT que contiene el rol del usuario
4. El frontend guarda el token en localStorage
5. Lee el rol del token y redirige:

```javascript
function redirigirPorRol(rol) {
  const rutas = {
    superadmin: '/frontend/panel-superadmin.html',
    admin:      '/frontend/panel-admin.html',
    docente:    '/frontend/dashboard.html',
    estudiante: '/frontend/dashboard.html',
    acudiente:  '/frontend/dashboard.html',
  };
  window.location.href = rutas[rol] || '/frontend/dashboard.html';
}
```

### Roles del sistema

| Rol | Pantalla inicial | Permisos |
|---|---|---|
| `superadmin` | panel-superadmin.html | Aprobar/rechazar instituciones |
| `admin` | panel-admin.html | Aprobar/rechazar docentes de su institución |
| `docente` | dashboard.html | Notas, asistencia, tareas |
| `estudiante` | dashboard.html | Ver notas y tareas |
| `acudiente` | dashboard.html | Ver info de su acudido |

### Cómo las pantallas protegidas verifican el acceso
```javascript
const token = localStorage.getItem('sia_token');
if (!token) window.location.href = 'login.html';
```
Si no hay token → redirige al login automáticamente.

---

## 3. Cómo están conectadas las pantallas

```
login.html
  ├── superadmin  → panel-superadmin.html
  ├── admin       → panel-admin.html
  └── otros       → dashboard.html

registro-institucion.html  (público)
  └── POST /api/instituciones/solicitar
        → superadmin recibe correo y notificación
          → panel-superadmin.html → aprobar/rechazar

registro-docente.html  (público)
  └── POST /api/docentes/solicitar
        → admin recibe correo y notificación
          → panel-admin.html → aprobar/rechazar
```

---

## 4. Cómo instalar MySQL Workbench

### Paso 1 — Descargar MySQL Installer
Ve a: https://dev.mysql.com/downloads/installer/

Descarga **MySQL Installer for Windows** (el archivo más grande, ~450MB)

### Paso 2 — Instalar
1. Ejecuta el instalador
2. Elige **"Developer Default"** (instala MySQL Server + Workbench)
3. Clic en **Execute** para instalar todos los componentes
4. En la configuración:
   - **Type and Networking:** deja todo por defecto (puerto 3306)
   - **Authentication:** elige "Use Strong Password Encryption"
   - **Accounts and Roles:** pon una contraseña para `root` y **guárdala**
   - **Windows Service:** deja por defecto
5. Finaliza la instalación

### Paso 3 — Verificar
Abre **MySQL Workbench** desde el menú inicio.  
Verás una conexión llamada "Local instance MySQL" — haz doble clic e ingresa tu contraseña.  
Si abre sin error, MySQL está funcionando.

> ⚠️ El usuario por defecto de MySQL es `root`, no `postgres` como en PostgreSQL.  
> ⚠️ El puerto de MySQL es `3306`, no `5432`.

---

## 5. Cómo instalar y ejecutar el proyecto

### Requisitos previos
| Programa | Versión | Descarga |
|---|---|---|
| Node.js | 20 LTS | https://nodejs.org |
| MySQL | 8.x | https://dev.mysql.com/downloads/installer/ |
| MySQL Workbench | 8.x | Incluido en el instalador de MySQL |
| Git | 2.x | https://git-scm.com |
| VS Code | Última | https://code.visualstudio.com |

Extensiones de VS Code:
- **Live Server** (Ritwick Dey)

---

### Paso 1 — Clonar el repositorio
```bash
cd C:\Proyectos
git clone https://github.com/TU_USUARIO/sia.git
cd sia
```

### Paso 2 — Crear el archivo .env
```bash
copy .env.example .env
```
Abre `.env` y llena los valores:
```env
DB_HOST=localhost
DB_PORT=3306
DB_NAME=sia_db
DB_USER=root
DB_PASSWORD=la_contraseña_que_pusiste_al_instalar_mysql
JWT_SECRET=cualquier_texto_largo_y_secreto_minimo_32_caracteres
JWT_EXPIRES_IN=8h
PORT=3000
CORS_ORIGIN=http://127.0.0.1:5500
EMAIL_USER=sia.sena.2025@gmail.com
EMAIL_PASS=contraseña_de_aplicacion_gmail
SUPERADMIN_EMAIL=sia.sena.2025@gmail.com
```

### Paso 3 — Crear la base de datos en MySQL Workbench
1. Abre MySQL Workbench
2. Doble clic en "Local instance MySQL" → ingresa contraseña
3. Clic en el ícono de hoja nueva (New SQL Tab) o **Ctrl+T**
4. Pega y ejecuta esto primero para crear la base:
```sql
CREATE DATABASE IF NOT EXISTS sia_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```
5. Presiona **Ctrl+Shift+Enter** para ejecutar
6. Abre `database/01_sia_base.sql`:
   - Menú **File → Open SQL Script** → selecciona el archivo
   - Presiona **Ctrl+Shift+Enter**
   - Espera a que diga "OK" abajo
7. Repite con `database/02_sia_v2.sql`

### Paso 4 — Instalar dependencias
Abre la terminal en VS Code (**Ctrl+ñ**), selecciona **Command Prompt**:
```bash
npm install
```

### Paso 5 — Arrancar el servidor
```bash
npm run dev
```
Debe aparecer:
```
🚀 SIA corriendo en http://localhost:3000
✅ Conectado a MySQL — sia_db
```

### Paso 6 — Abrir el frontend
Clic derecho sobre `frontend/login.html` → **Open with Live Server**

### Paso 7 — Credenciales iniciales
```
Correo:     admin@sia.edu.co
Contraseña: Admin2025!
Rol:        superadmin
```

---

## 6. Ver registros en tiempo real

En MySQL Workbench, abre una pestaña SQL (Ctrl+T) y ejecuta:

**Ver todos los usuarios:**
```sql
USE sia_db;
SELECT nombres, apellidos, email, rol, activo, created_at
FROM usuarios
ORDER BY created_at DESC;
```

**Ver solicitudes de instituciones:**
```sql
USE sia_db;
SELECT nombre, admin_nombre, admin_email, estado, created_at
FROM solicitudes_instituciones
ORDER BY created_at DESC;
```

**Ver solicitudes de docentes:**
```sql
USE sia_db;
SELECT nombres, apellidos, email, estado, created_at
FROM solicitudes_docentes
ORDER BY created_at DESC;
```

Presiona **Ctrl+Shift+Enter** para ejecutar. Cada vez que alguien se registre, vuelve a ejecutar la consulta y verás el nuevo registro.

---

## 7. Estructura de archivos

```
SIA/
├── frontend/
│   ├── login.html
│   ├── registro-institucion.html
│   ├── registro-docente.html
│   ├── panel-superadmin.html
│   ├── panel-admin.html
│   └── dashboard.html
├── src/
│   ├── app.js                      ← Servidor Express
│   ├── config/
│   │   └── db.js                   ← Conexión MySQL con mysql2
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── institucion.controller.js
│   │   └── docente.controller.js
│   ├── middleware/
│   │   └── auth.middleware.js      ← Verifica JWT y roles
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── institucion.routes.js
│   │   └── docente.routes.js
│   └── services/
│       ├── email.service.js        ← Nodemailer
│       └── notificacion.service.js
├── database/
│   ├── 01_sia_base.sql             ← Tablas principales
│   └── 02_sia_v2.sql               ← Solicitudes y notificaciones
├── .env                            ← NO subir a GitHub
├── .env.example
├── .gitignore
└── package.json
```

---

## 8. Diferencias entre MySQL y PostgreSQL

| Aspecto | PostgreSQL (antes) | MySQL (ahora) |
|---|---|---|
| Driver Node.js | `pg` | `mysql2` |
| Parámetros en queries | `$1, $2, $3` | `?, ?, ?` |
| Resultado de query | `{ rows }` | `[rows, fields]` |
| UUID automático | `uuid_generate_v4()` | `UUID()` o `randomUUID()` en Node |
| Hash en BD | `crypt()` de pgcrypto | bcrypt en Node.js |
| Zona horaria | `TIMESTAMPTZ` | `DATETIME` |
| Esquemas | `CREATE SCHEMA sia` | `CREATE DATABASE sia_db` |
| Transacciones | `pool.connect()` → `BEGIN/COMMIT` | `pool.getConnection()` → `beginTransaction()/commit()` |
| Puerto | 5432 | 3306 |
| Usuario por defecto | `postgres` | `root` |

---

## 9. Solución de errores frecuentes

| Error | Causa | Solución |
|---|---|---|
| `Cannot find module 'mysql2'` | No corriste npm install | Corre `npm install` |
| `Access denied for user 'root'` | Contraseña incorrecta en .env | Revisa `DB_PASSWORD` |
| `Unknown database 'sia_db'` | No creaste la base de datos | Ejecuta el CREATE DATABASE en Workbench |
| `Table doesn't exist` | No ejecutaste los SQL | Ejecuta 01 y 02 en Workbench |
| `port 3000 already in use` | Servidor ya corriendo | Cierra la otra terminal |
| Scripts deshabilitados | Restricción Windows | Usa Command Prompt, no PowerShell |
| Correo no llega | EMAIL_PASS incorrecto | Genera nueva contraseña de aplicación Google |

---

## Rutina de trabajo en equipo

```bash
git pull origin main
git checkout -b feature/nombre-funcionalidad
git add .
git commit -m "feat: descripción"
git push origin feature/nombre-funcionalidad
```

---

*SIA — Proyecto SENA Ficha 3407184 · Colombia*