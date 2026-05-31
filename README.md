# SIA — Sistema de Información Académica

> Proyecto académico SENA · Ficha 3407184 · Teleinformática y Bases de Datos  
> Autores: Oscar Andrés Navarro Ochoa - Juan Sebastian Calderon - Giovanny Esteban Reyes Rodriguez - Jhon Harold Hoyos Pacheco - Romel Sneider Toquica Corredor 

Sistema web para gestión académica de instituciones educativas colombianas (Preescolar – 7°).

---

## Índice

1. [Cómo funciona el sistema por dentro](#1-cómo-funciona-el-sistema-por-dentro)
2. [Cómo se redirige según el rol](#2-cómo-se-redirige-según-el-rol)
3. [Cómo están conectadas las pantallas](#3-cómo-están-conectadas-las-pantallas)
4. [Flujos completos del sistema](#4-flujos-completos-del-sistema)
5. [Cómo instalar y ejecutar](#5-cómo-instalar-y-ejecutar)
6. [Estructura de archivos](#6-estructura-de-archivos)
7. [Stack tecnológico](#7-stack-tecnológico)
8. [Solución de errores frecuentes](#8-solución-de-errores-frecuentes)

---

## 1. Cómo funciona el sistema por dentro

El SIA tiene dos partes que trabajan juntas:

### Backend (el cerebro)
Vive en la carpeta `src/` y corre con Node.js en el puerto 3000.
Es un servidor que recibe peticiones, consulta la base de datos PostgreSQL y devuelve respuestas en formato JSON.
**Nunca lo ve el usuario directamente** — trabaja en segundo plano.

```
Usuario hace clic → Frontend envía petición → Backend procesa → Base de datos responde → Frontend muestra resultado
```

### Frontend (lo que ve el usuario)
Son archivos HTML en la carpeta `frontend/`.
Se abren en el navegador con Live Server (puerto 5500).
Usan `fetch()` para comunicarse con el backend.

### Por qué se abre en la misma pestaña
Cuando el login es exitoso, el frontend ejecuta:
```javascript
window.location.href = rutas[rol];
```
`window.location.href` es una instrucción de JavaScript que cambia la URL de la pestaña actual — no abre una nueva. Es el comportamiento estándar de cualquier sistema web (igual que Google, Gmail, etc.).

---

## 2. Cómo se redirige según el rol

Esta es la parte más importante del sistema de autenticación.

### Paso a paso del login

**1.** El usuario escribe su correo y contraseña y hace clic en "Iniciar sesión"

**2.** El frontend envía una petición al backend:
```javascript
fetch('http://localhost:3000/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password })
})
```

**3.** El backend busca al usuario en PostgreSQL y verifica la contraseña con bcrypt

**4.** Si todo está bien, genera un JWT (token) que contiene el rol del usuario

**5.** El frontend recibe el token, lo guarda en localStorage y lee el rol:
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

### Roles y sus permisos

| Rol | Pantalla inicial | Qué puede hacer |
|---|---|---|
| `superadmin` | panel-superadmin.html | Aprobar/rechazar instituciones, ver todo el sistema |
| `admin` | panel-admin.html | Aprobar/rechazar docentes de su institución |
| `docente` | dashboard.html | Notas, asistencia, tareas |
| `estudiante` | dashboard.html | Ver sus notas y tareas |
| `acudiente` | dashboard.html | Ver información de su acudido |

---

## 3. Cómo están conectadas las pantallas

```
login.html
  ├── superadmin  → panel-superadmin.html
  ├── admin       → panel-admin.html
  └── otros roles → dashboard.html

registro-institucion.html  (público)
  └── Solicitud → superadmin la aprueba en panel-superadmin.html

registro-docente.html  (público)
  └── Solicitud → admin la aprueba en panel-admin.html

panel-superadmin.html  (solo superadmin)
  ├── Aprobar institución → crea colegio + admin + envía correo
  └── Rechazar → envía correo con motivo

panel-admin.html  (solo admin institucional)
  ├── Aprobar docente → crea cuenta + envía correo
  └── Rechazar → envía correo con motivo

dashboard.html  (todos los roles)
  ├── Menú adaptado según rol
  ├── Notificaciones internas
  └── Accesos rápidos según permisos
```

---

## 4. Flujos completos del sistema

### Registrar un colegio nuevo
```
1. Rector → registro-institucion.html → llena el formulario
2. Backend guarda solicitud con estado "pendiente"
3. Backend envía correo al superadmin
4. Superadmin → panel-superadmin.html → aprueba
5. Backend crea: institución + configuración + cuenta del rector
6. Rector recibe correo y puede iniciar sesión
```

### Registrar un docente
```
1. Docente → registro-docente.html → busca su colegio y llena sus datos
2. Backend guarda solicitud con estado "pendiente"
3. Admin del colegio recibe correo y notificación interna
4. Admin → panel-admin.html → aprueba o rechaza
5. Docente recibe correo con el resultado
6. Si aprobado: puede iniciar sesión
```

---

## 5. Cómo instalar y ejecutar

### Requisitos previos
| Programa | Versión | Descarga |
|---|---|---|
| Node.js | 20 LTS | https://nodejs.org |
| PostgreSQL | 16 | https://www.postgresql.org/download |
| Git | 2.x | https://git-scm.com |
| VS Code | Última | https://code.visualstudio.com |

### Extensiones de VS Code necesarias
- **Live Server** (Ritwick Dey) — para abrir los HTML
- **PostgreSQL** (Chris Kolkman) — opcional

### Pasos

**1. Clonar**
```bash
cd C:\Proyectos
git clone https://github.com/TU_USUARIO/sia.git
cd sia
```

**2. Crear el .env**
```bash
copy .env.example .env
```
Abre `.env` y llena `DB_PASSWORD`, `EMAIL_USER`, `EMAIL_PASS` y `SUPERADMIN_EMAIL`.

**3. Crear la base de datos en pgAdmin**
- Crea la base: `sia_db`
- Abre Query Tool y ejecuta en orden:
  - `database/01_sia_base.sql` → F5
  - `database/02_sia_v2.sql` → F5

**4. Instalar y ejecutar** (usar Command Prompt, no PowerShell)
```bash
npm install
npm run dev
```
Debe aparecer:
```
🚀 SIA corriendo en http://localhost:3000
✅ Conectado a PostgreSQL — sia_db
```

**5. Abrir el frontend**
Clic derecho sobre `frontend/login.html` → **Open with Live Server**

**6. Credenciales de prueba**
```
Correo:     admin@sia.edu.co
Contraseña: Admin2025!
Rol:        superadmin
```

---

## 6. Estructura de archivos

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
│   ├── app.js
│   ├── config/db.js
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── institucion.controller.js
│   │   └── docente.controller.js
│   ├── middleware/auth.middleware.js
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── institucion.routes.js
│   │   └── docente.routes.js
│   └── services/
│       ├── email.service.js
│       └── notificacion.service.js
├── database/
│   ├── 01_sia_base.sql
│   └── 02_sia_v2.sql
├── .env              ← NO subir a GitHub
├── .env.example      ← Sí subir
├── .gitignore
└── package.json
```

---

## 7. Stack tecnológico

| Tecnología | Versión | Uso |
|---|---|---|
| Node.js | 20 LTS | Runtime del backend |
| Express | 4.18 | Framework web |
| PostgreSQL | 16 | Base de datos |
| JWT | 9.0 | Autenticación |
| bcrypt | 5.1 | Hash de contraseñas |
| Nodemailer | 6.9 | Correos automáticos |
| pg | 8.11 | Conexión a PostgreSQL |

---

## 8. Solución de errores frecuentes

| Error | Causa | Solución |
|---|---|---|
| `Cannot find module` | No corriste `npm install` | Corre `npm install` |
| `password authentication failed` | Contraseña PostgreSQL incorrecta | Revisa `DB_PASSWORD` en `.env` |
| `port 3000 already in use` | Servidor ya corriendo | Cierra la otra terminal |
| `relation does not exist` | No ejecutaste los SQL | Ejecuta los dos `.sql` en pgAdmin |
| Frontend no carga datos | Backend no está corriendo | Corre `npm run dev` |
| Correo no llega | `EMAIL_PASS` incorrecto | Genera nueva contraseña de aplicación en Google |
| Scripts deshabilitados | Restricción de Windows | Usa Command Prompt en lugar de PowerShell |

---

## Rutina de trabajo en equipo

```bash
git pull origin main
git checkout -b feature/nombre-funcionalidad
# ... trabajas ...
git add .
git commit -m "feat: descripción"
git push origin feature/nombre-funcionalidad
# Abre Pull Request en GitHub
```

---

*SIA — Proyecto SENA Ficha 3407184 · Colombia*
