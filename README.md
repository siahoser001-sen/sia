# SIA — Sistema de Información Académica

> Proyecto académico SENA · Ficha 3407184 · Teleinformática y Bases de Datos  
> Autores: Oscar Andrés Navarro Ochoa - Juan Sebastian Calderon - Giovanny Esteban Reyes Rodriguez - Jhon Harold Hoyos Pacheco - Romel Sneider Toquica Corredor 

---

## Índice

1. [Cómo funciona el sistema](#1-cómo-funciona-el-sistema)
2. [Cómo se redirige según el rol](#2-cómo-se-redirige-según-el-rol)
2.1. [Cuentas de prueba precargadas](#21-cuentas-de-prueba-precargadas)
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

**Backend** — carpeta `src/`, corre con Node.js en el puerto 3000. Recibe peticiones del frontend, consulta MySQL y devuelve JSON.

**Frontend** — carpeta `frontend/`, archivos HTML. El propio backend los sirve como archivos estáticos en `http://localhost:3000/frontend/...`, así que no hace falta Live Server ni el puerto 5500. Se comunican con el backend usando `fetch()`, siempre contra el mismo origen desde el que se cargaron (ver sección 9.5 para acceso desde el celular).

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

### 2.1 Cuentas de prueba precargadas

Para **no crear roles sueltos cada vez** que se va a probar, el proyecto trae
un set fijo de cuentas, una por rol (el `superadmin` ya existía; las demás las
crea la migración `database/18_usuarios_prueba.sql`, que se ejecuta como las
demás: File → Open SQL Script → Ctrl+Shift+Enter, después de las 01–17).

Todas entran por `login.html` usando el **correo** o el **número de documento**
junto con la contraseña. **La contraseña es por rol, no por persona** (los 2
docentes, los 2 estudiantes y los 2 acudientes comparten la de su rol):

| Rol | Correo | Documento | Contraseña |
|---|---|---|---|
| `superadmin` | `admin@sia.edu.co` | `1000000001` | `Admin2025!` |
| `admin` | `administrador@sia.edu.co` | `1000000002` | `Admin2026!` |
| `docente` (1) | `docente1@sia.edu.co` | `2000000001` | `Docente2026!` |
| `docente` (2) | `docente2@sia.edu.co` | `2000000002` | `Docente2026!` |
| `estudiante` (1) | `estudiante1@sia.edu.co` | `3000000001` | `Estudiante2026!` |
| `estudiante` (2) | `estudiante2@sia.edu.co` | `3000000002` | `Estudiante2026!` |
| `acudiente` (1) | `acudiente1@sia.edu.co` | `4000000001` | `Acudiente2026!` |
| `acudiente` (2) | `acudiente2@sia.edu.co` | `4000000002` | `Acudiente2026!` |

¿A qué institución pertenecen?
- **`superadmin`** es global: no pertenece a ninguna institución (es quien
  aprueba el registro de instituciones desde `panel-superadmin.html`).
- **Todos los demás** viven en la *"Institución de Prueba SIA"*, creada por la
  misma migración con id `11111111-1111-4111-8111-111111111101`. El `admin` es
  el admin de esa institución.
- La migración también deja listo el curso **Décimo 1001** con los **dos
  estudiantes matriculados** (año 2026, estado `activa`), y el **vínculo
  acudiente ↔ estudiante**: `acudiente1` → `estudiante1` (Padre) y
  `acudiente2` → `estudiante2` (Madre). Con eso entran al dashboard sin
  "banner para unirse a un curso" y los acudientes ya ven a su acudido.

Cosas a tener en cuenta:
- La migración es **idempotente** (`INSERT IGNORE`): se puede repetir sin
  duplicar. Si un correo/documento ya existía (p. ej. un estudiante que se
  registró antes con ese documento), **no se sobrescribe** — se conserva la
  cuenta existente y esa no tendrá la contraseña de la tabla. Al final de la
  migración hay un `SELECT` de verificación para confirmar.
- El `superadmin` se creó en la migración **01**; la 18 lo vuelve a incluir
  como salvaguarda pero no cambia su contraseña si ya existe.
- Si se cambia la contraseña de alguna cuenta (por el panel, por
  "olvidé mi contraseña" o directo en MySQL), esta tabla deja de ser válida
  para esa cuenta. Para probar, es mejor volver a crearla o usar el botón
  "Nueva contraseña" del admin.
- El correo es solo para los docentes/estudiantes/acudientes de la institución
  de prueba: para entrar al `admin` usa `administrador@sia.edu.co`.

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

> **💡 Alternativa (recomendada): en lugar de ejecutar los SQL a mano uno a uno en
> Workbench, puedes usar el runner desde la terminal.** Solo asegúrate de que la base
> `sia_db` ya exista, y luego:
> ```bash
> npm run migrate:seed   # 1ª vez SOLO: marca 01..19 como aplicadas (las que ya corriste)
> npm run migrate        # a partir de ahí, aplica solo las migraciones nuevas (20+)
> ```
> El runner usa la misma config de `.env`, lee `database/NN_*.sql` en orden, ejecuta
> solo las pendientes y las registra en la tabla `schema_migrations`. Cuando crees un
> cambio de esquema nuevo como `database/20_...`, basta `npm run migrate` (sin
> `:seed`). Ver `migrate.js` para detalles.

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

Después de ejecutar las migraciones (hasta la **18** inclusive), ya existen
cuentas fijas para probar todos los roles. La principal:

```
Correo:     admin@sia.edu.co
Contraseña: Admin2025!
Rol:        superadmin
```

Todas las cuentas (superadmin, admin, 2 docentes, 2 estudiantes y 2
acudientes, con sus contraseñas y documentos) están en la
[sección 2.1](#21-cuentas-de-prueba-precargadas). Entran por `login.html`
con el correo o el documento.

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

## 9.5 Acceso desde otros dispositivos (celular, tablet, otra PC)

Desde esta actualización, el propio backend sirve el frontend (ya no hace
falta Live Server ni el puerto 5500). El sistema completo vive en un solo
puerto: `http://localhost:3000` (o el que pongas en `PORT`).

### Pasos

1. Levanta el backend normalmente: `npm start` (o `npm run dev`).
2. Abre `http://localhost:3000` en el navegador de la misma PC — te
   redirige automáticamente al login.
3. Para entrar desde el **celular** o cualquier otro dispositivo, este debe
   estar conectado al **mismo Wi-Fi / red** que el equipo donde corre el
   servidor. Averigua la IP local del equipo servidor:
   - **Windows**: `ipconfig` → busca "Dirección IPv4" (algo como `192.168.1.10`)
   - **Mac/Linux**: `ifconfig` o `ip a` → busca `inet` en tu interfaz de red (wlan0/en0)
4. En el celular, abre el navegador y entra a:
   `http://<ESA-IP>:3000` (ejemplo: `http://192.168.1.10:3000`)
5. Si no carga, revisa el **firewall** de Windows/Mac: la primera vez que
   corres `node`, el sistema puede preguntar si permites conexiones
   entrantes — di que sí (redes privadas).

### Notas técnicas
- El servidor ahora escucha en `0.0.0.0` (todas las interfaces de red),
  no solo en `127.0.0.1`/`localhost`, que es lo que bloqueaba el acceso
  externo antes.
- El frontend ya no tiene la URL `http://localhost:3000` quemada en el
  código: cada página usa `window.location.origin`, es decir, "el mismo
  origen desde el que se cargó la página". Así, si entras desde el celular
  vía `http://192.168.1.10:3000`, el frontend llama automáticamente a
  `http://192.168.1.10:3000/api/...` en vez de a `localhost` (que en el
  celular no existiría, sería el propio celular).
- Esto sirve para la **misma red local**. Si necesitas acceso desde
  internet (fuera de la red), hay que desplegar el backend en un hosting
  (Railway, Render, VPS, etc.) — es un paso aparte, avísame si lo quieres.

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

## 10. Acciones para mejorar el flujo de interacción con el sistema

| Acción | Código |
|---|---|
| `Subir importaciones a MySQL workbench desde la consola` | `npm run migrate` |


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

*SIA — Proyecto SENA Ficha 3407184 · Bogotá Colombia*
*Hecho por: Oscar Andd*