# PRUEBAS MANUALES — End-to-end contra la BD real

> Estas son las verificaciones que **solo se pueden hacer con MySQL corriendo** y el
> servidor levantado (en este entorno de trabajo no hay BD accesible, por eso quedan
> pendientes). Son el cierre del ROADMAP actual (ver
> `docs/modulos/actualizaciones/ROADMAP.md`, sección 0 → "Cierre del ROADMAP actual").
>
> **Cómo probar:** `npm start` (o `npm run dev`), MySQL activo, entrar por
> `http://localhost:3000/frontend/login.html`.

## Cuentas de prueba (migración 18)

| Rol | Correo | Contraseña |
|---|---|---|
| Superadmin | `admin@sia.edu.co` | `Admin2025!` |
| Admin | `administrador@sia.edu.co` | `Admin2026!` |
| Docente | `docente1@sia.edu.co` / `docente2@sia.edu.co` | `Docente2026!` |
| Estudiante | `estudiante1@sia.edu.co` / `estudiante2@sia.edu.co` | `Estudiante2026!` |
| Acudiente | `acudiente1@sia.edu.co` / `acudiente2@sia.edu.co` | `Acudiente2026!` |

---

## A. Plan de evaluación (endpoints en `/api/plan-evaluacion`)

Contexto: la plantilla por materia+periodo con % de peso es la base del futuro módulo de
Evaluaciones. Verifica el CRUD y la hoja de calificación.

1. Entra como **admin** → Gestión académica → pestaña **Plan de evaluación** (o la hoja
   desde "Trabajos" → "Realizar evaluación").
2. Crea una materia y confirma que aparece su plan.
3. Añade varios ítems con distinto `peso_pct` (verifica que no se pueda superar el 100%).
4. Abre la **hoja de calificación** (`GET /api/plan-evaluacion/materia/:materiaId/hoja`):
   - confirma que cada estudiante tiene su fila.
   - guarda una nota de un estudiante (`PUT /api/plan-evaluacion/celda`).
   - recarga: la nota debe persistir.
5. Edita y elimina un ítem (`PUT` / `DELETE /api/plan-evaluacion/:id`).
6. Valida que el **promedio ponderado** y el **boletín** reflejen los pesos.
7. Como **docente1** que dirige un curso: repite 3–6 sobre una materia que NO dicta
   (debe poder ver la hoja, pero guardar notas solo si es co-docente/admin — confirmar
   el comportamiento actual y anotarlo).

> ✅ Cuándo dar por cerrado: crear/listar/editar/eliminar ítems, ver la hoja con todos
> los estudiantes, persistencia de celdas y % sin superar 100.

---

## B. Calendario (endpoints en `/api/calendario`)

1. Entra como **admin** → y ve una de estas pantallas: `calendario.html`, `dashboard.html`
   (menú "Calendario").
2. Crea un evento general (sin curso) y uno de un curso (`POST /api/calendario/eventos`).
3. Lista por rango de fechas (`GET /api/calendario/eventos`):
   - el evento general aparece siempre.
   - el de curso aparece para el docente director y para el estudiante de ese curso.
4. Edita el evento (`PUT /api/calendario/eventos/:id`) y asígnale un cierre de periodo
   (`tipo='cierre_periodo'`).
5. Elimínalo (`DELETE /api/calendario/eventos/:id`).
6. Verifica permisos: un **docente que no dirige** el curso NO puede crear eventos de él;
   un **acudiente** solo los ve.

> ✅ Cuándo dar por cerrado: crear/listar/editar/eliminar funcionando, visibilidad por rol
> correcta.

---

## C. Acudientes y recuperación de contraseña (SMTP)

Requiere **correo configurado** (SMTP en `.env` — Gmail u otro). Verifica el flujo completo.

1. **Vincular acudiente** (`POST /api/acudientes/estudiantes`): como admin, vincula
   `acudiente1` con `estudiante1`.
2. Entra como **acudiente1@sia.edu.co** y confirma que ve los cursos/notas/asistencia de
   sus estudiantes vinculados (dashboard).
3. **Recuperación de contraseña:**
   - `POST /api/auth/olvide-password` con `estudiante2@sia.edu.co` → debe llegar un
     correo con token/enlace (revisa la bandeja real; si es Gmail usa la app, no el
     navegador, para verlo entrar).
   - `POST /api/auth/reestablecer-password` con ese token → cambia la contraseña.
   - Intenta entrar con la nueva contraseña → debe funcionar.
4. **Restablecer por admin** (`POST /api/auth/restablecer`, admin o superadmin): fuerza
   un reset y verifica que el usuario reciba el correo.
5. Confirma que, tras cambiar la contraseña, **se invalidaron otras sesiones** del usuario
   (punto 3 de la auditoría de login: revocación por `token_version`).

> ✅ Cuándo dar por cerrado: el correo llega, el token funciona una sola vez, la nueva
> contraseña entra, y se revocan sesiones viejas.

---

## D. Regresión rápida de lo recién tocado (2026-09-02)

Verifica que estos cambios nuevos no rompieron nada:

1. **Horas semanales derivadas:** en la pestaña **Materias** de Gestión académica, al
   seleccionar un curso, la columna **"Horas sem."** debe mostrar la suma de horas de las
   franjas del horario (o "—" si el curso no tiene horario aún).
2. **Traslape de periodos:** intenta crear un periodo cuyas fechas se traslapen con otro
   existente → debe **rechazarse** (mensaje de error), y ya **no** crearse con solo un aviso.
3. **Horario por curso:** sigue funcionando crear/editar/eliminar franjas (pestaña
   "Horario"). Al agregar/editar el horario de una materia, **"Horas sem."** debe
   actualizarse al recargar materias.

> Regla (del propio ROADMAP): no dar nada por "✅ hecho" sin verlo correr contra la BD
> real. Marca abajo qué probaste.

---

## Registro de resultados

| # | Prueba | Resultado | Fecha | Cómo se probó |
|---|---|---|---|---|
| A | Plan de evaluación CRUD + hoja | ☐ | | |
| B | Calendario CRUD + permisos | ☐ | | |
| C | Acudientes + recuperación SMTP | ☐ | | |
| D1 | Horas semanales derivadas | ☐ | | |
| D2 | Traslape de periodos bloqueado | ☐ | | |
| D3 | Horario por curso (regresión) | ☐ | | |

Cuando marques cada una como ✅, actualiza `docs/modulos/actualizaciones/ROADMAP.md`
(tachando el pendiente correspondiente en la sección 8).