# Zebra Reports — Servicio de Análisis Comercial

Genera reportes PDF de desempeño de asesores a partir de transcripciones de llamadas almacenadas en Google Sheets, usando Claude (Anthropic) para el análisis cualitativo y Google Drive para la entrega.

## Arquitectura

```
index.html  (SPA estática)
    │
    ├── GET  /api/advisors?client_id=   ← lista asesores desde Google Sheets
    ├── POST /api/report                ← encola job, devuelve { job_id }
    └── GET  /api/report/:jobId         ← polling de estado

Job runner (async):
  Google Sheets → Claude (tool use) → Playwright PDF → Google Drive
```

---

## Despliegue en EasyPanel

### 1. Crear el servicio

1. En EasyPanel → **Create Service → App**
2. Source: **Git** → apunta a este repositorio, branch `claude/setup-html-project-6wZQX`
3. Build: **Dockerfile** (detectado automáticamente)
4. Port: `3000`

### 2. Variables de entorno

Ve a **Service → Environment** y agrega:

| Variable | Descripción |
|---|---|
| `GOOGLE_SA_JSON` | JSON completo de la cuenta de servicio de Google (ver abajo) |
| `ANTHROPIC_API_KEY` | API key de Anthropic (console.anthropic.com) |
| `PORT` | Puerto del servidor (default: `3000`, normalmente no cambiar) |
| `DATABASE_URL` | (Recomendado) URL de PostgreSQL para persistir clientes y automatizaciones (ver sección **Base de datos PostgreSQL**) |
| `DATABASE_SSL` | (Opcional) `true` solo si conectas por un host externo que requiere SSL |

#### Obtener `GOOGLE_SA_JSON`

1. Ve a [Google Cloud Console](https://console.cloud.google.com) → **IAM & Admin → Service Accounts**
2. Crea una cuenta de servicio (o usa una existente)
3. **Actions → Manage keys → Add key → JSON** → descarga el archivo
4. Abre el archivo JSON descargado y copia **todo su contenido en una sola línea** (sin saltos de línea)
5. Pégalo como valor de `GOOGLE_SA_JSON`

> El JSON se ve así (abreviado):
> ```
> {"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...@....iam.gserviceaccount.com",...}
> ```

#### Permisos de Google Drive y Sheets

La cuenta de servicio debe tener acceso a los recursos de cada cliente:

- **Google Drive**: comparte la carpeta del cliente con el email de la cuenta de servicio (`...@....iam.gserviceaccount.com`) con rol **Editor**
- **Google Sheets**: comparte la hoja de cálculo con el mismo email con rol **Viewer** (o Editor)

### 3. Verificar el deploy

Después del primer build exitoso, visita:

```
https://tu-dominio.easypanel.host/api/health
```

Debe responder:
```json
{"status":"ok","ts":"2026-..."}
```

---

## Base de datos PostgreSQL (persistencia que sobrevive a redeploys)

Por defecto, los **clientes** y las **automatizaciones** se guardan en archivos JSON
dentro del contenedor. Esos archivos forman parte de la imagen Docker, así que **cada
redeploy los sobrescribe** y se pierde lo que hayas creado o editado desde la interfaz.

Para que la información sea **editable y persistente**, configura una base de datos
PostgreSQL. Cuando defines `DATABASE_URL`, la app guarda clientes y automatizaciones en
Postgres en lugar de los archivos JSON. Si **no** defines `DATABASE_URL`, sigue usando
los archivos JSON (útil para desarrollo local).

### 1. Crear el servicio Postgres en EasyPanel

1. Abre tu **proyecto** en EasyPanel (el mismo que contiene la app).
2. **Create Service → Postgres**.
3. Ponle un nombre, por ejemplo `db`, y elige una contraseña (o usa la autogenerada).
4. **Create**. EasyPanel levanta el contenedor de Postgres con un volumen persistente
   (sus datos sí sobreviven a los redeploys de la app).

### 2. Copiar la URL de conexión interna

1. Abre el servicio Postgres que acabas de crear.
2. En la pestaña **Credentials** verás los datos de conexión. Usa la **Internal
   Connection URL** (host interno del proyecto, no la externa). Tiene esta forma:

   ```
   postgres://postgres:TU_PASSWORD@<proyecto>_<servicio>:5432/postgres
   ```

   > El host interno (`<proyecto>_<servicio>`) solo es accesible dentro de la red privada
   > del proyecto y **no necesita SSL**. Por eso ambos servicios deben estar en el mismo
   > proyecto de EasyPanel.

### 3. Configurar la app

1. Ve al servicio de la **app** → **Environment**.
2. Agrega la variable:

   ```
   DATABASE_URL=postgres://postgres:TU_PASSWORD@<proyecto>_<servicio>:5432/postgres
   ```

3. Guarda y haz **Deploy**.

### 4. Migración automática

En el **primer arranque con `DATABASE_URL` configurada**, la app:

1. Crea las tablas `clients` y `schedules` automáticamente (no necesitas correr ningún SQL).
2. Si las tablas están vacías, **copia** los clientes de `clients.json` y las
   automatizaciones existentes a Postgres.

En los logs del servicio verás algo como:

```
🗄️  DATABASE_URL detected — using PostgreSQL for clients & schedules
[db] Schema ready (clients, schedules)
[clients] Seeded 5 client(s) from clients.json into Postgres
```

A partir de ahí, todo lo que crees o edites desde la interfaz se guarda en Postgres y
**sobrevive a los redeploys**.

> **Migración manual (opcional):** si prefieres ejecutarla a mano (por ejemplo desde tu
> máquina apuntando a la base de datos de producción):
> ```bash
> DATABASE_URL=postgres://... npm run migrate:db
> ```
> Es idempotente: puedes correrla varias veces sin duplicar datos (hace upsert por `id`).

### Modelo de datos

Cada cliente/automatización se guarda como una fila con su objeto completo en una columna
`jsonb`, identificada por `id`:

```sql
CREATE TABLE clients   (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ);
CREATE TABLE schedules (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ);
```

Con `DATABASE_URL` configurada, **cuatro** conjuntos de datos viven en PostgreSQL y
sobreviven a los redeploys:

| Dato | Tabla | Forma |
|---|---|---|
| Clientes | `clients` | `id` + objeto `jsonb` |
| Automatizaciones | `schedules` | `id` + objeto `jsonb` |
| Historial de reportes | `jobs` | `id` + objeto `jsonb` (caché en memoria con escritura a DB) |
| Consumo de tokens | `token_log` | columnas reales (`ts`, `input`, `output`, …) para sumar por fecha |

> El historial de reportes (`jobs`) usa una caché en memoria para las lecturas frecuentes
> del runner (estado/cancelación) y escribe a Postgres en paralelo para durabilidad. El
> log de tokens usa columnas reales porque es data analítica que se agrega por fecha.

---

## Configuración de clientes (`clients.json`)

Cada entrada en `clients.json` define un cliente. Campos:

| Campo | Descripción |
|---|---|
| `id` | Identificador único (slug, sin espacios) |
| `name` | Nombre del cliente (aparece en la UI) |
| `folder_id` | ID de la carpeta de Google Drive donde se suben los PDFs |
| `spreadsheet_id` | ID de la hoja de cálculo de Google Sheets |
| `sheet_id` | GID numérico de la pestaña (legacy, ya no se usa para leer datos) |
| `data_sheet_name` | Nombre de la pestaña con los datos de llamadas (e.g. `"Analisis"`) |
| `advisors_sheet_name` | Nombre de la pestaña con la lista de asesores (e.g. `"Hoja Apoyo"`) |
| `col_fecha` | Nombre de la columna de fecha en la hoja de datos |
| `col_asesor` | Nombre de la columna de asesor |
| `col_calif` | Nombre de la columna de calificación (número 0-100) |
| `col_analisis` | Nombre de la columna de análisis previo (puede estar vacía) |
| `col_transcripcion` | Nombre de la columna de transcripción |
| `col_record` | (Opcional) Nombre de la columna con el link de la grabación. Si se define, el reporte individual incluye un botón "Escuchar grabación" en la mejor llamada de cada asesor |
| `excluded_phrases` | Frases que, si aparecen en la transcripción, excluyen esa llamada |
| `transcripcion_max_chars` | Máximo de caracteres de transcripción enviados a Claude |
| `prompt_individual` | Prompt del sistema para el análisis individual de cada asesor |
| `prompt_general` | Prompt del sistema para el reporte ejecutivo del equipo |

> **Nota sobre saltos de línea en JSON:** los prompts deben usar `\n` (escaped) dentro de las cadenas JSON, no saltos de línea literales.

---

## API

### `GET /api/health`
```json
{"status":"ok","ts":"2026-05-21T10:00:00.000Z"}
```

### `GET /api/advisors?client_id=<id>`
Devuelve la lista de asesores de la hoja de apoyo del cliente.
```json
[{"asesor":"Felipe","row_number":2},{"asesor":"Ana","row_number":3}]
```

### `POST /api/report`
```json
{
  "client_id": "pitahaya-investments",
  "month": "2026-05",
  "type": "general",
  "advisors": ["Felipe", "Ana", "Carlos"]
}
```
Respuesta `202`:
```json
{"job_id":"550e8400-e29b-41d4-a716-446655440000"}
```

- `type: "general"` → genera reportes individuales **+ reporte ejecutivo del equipo**
- `type: "selected"` → solo reportes individuales de los asesores listados

### `GET /api/report/:jobId`
```json
{
  "id": "550e8400...",
  "status": "done",
  "progress": {"completed": 3, "total": 3},
  "results": {
    "individual": [
      {"asesor": "Felipe", "driveUrl": "https://drive.google.com/file/d/.../view"},
      {"asesor": "Ana",    "driveUrl": "https://drive.google.com/file/d/.../view"}
    ],
    "general": {"driveUrl": "https://drive.google.com/file/d/.../view"}
  }
}
```

Estados posibles: `pending` → `running` → `done` | `error`

---

## Desarrollo local

```bash
cp .env.example .env
# Edita .env con tus credenciales reales

npm install
npm run dev          # servidor en http://localhost:3000

# Probar lectura de sheets sin subir nada:
npm run dry-run -- pitahaya-investments 2026-05
npm run dry-run -- pitahaya-investments 2026-05 Felipe
```

> Para el dry-run local, Playwright descargará Chromium automáticamente la primera vez.  
> En producción (Docker), se usa el Chromium del sistema (`/usr/bin/chromium`).

---

## Estructura del proyecto

```
├── index.html              SPA frontend
├── clients.json            Configuración de clientes
├── src/
│   ├── server.ts           Express entry point (bootstrap de DB + scheduler)
│   ├── config/env.ts       Validación de variables de entorno (Zod)
│   ├── config/db.ts        Conexión a PostgreSQL + helpers (clients, schedules)
│   ├── google/
│   │   ├── auth.ts         JWT service account
│   │   ├── sheets.ts       getAdvisors(), getCallData()
│   │   └── drive.ts        uploadPdf(), findPreviousReport()
│   ├── claude/
│   │   ├── individual.ts   Análisis individual (tool use, 3 retries)
│   │   └── general.ts      Reporte ejecutivo del equipo
│   ├── pdf/
│   │   ├── renderer.ts     Playwright HTML → PDF
│   │   └── templates/
│   │       ├── individual.eta
│   │       └── general.eta
│   ├── schemas/
│   │   ├── individual.ts   Zod schema para output de Claude
│   │   └── general.ts
│   ├── jobs/
│   │   ├── store.ts        Caché en memoria + persistencia (PostgreSQL o jobs.json)
│   │   └── runner.ts       Orquestador del pipeline completo
│   ├── routes/
│   │   ├── health.ts
│   │   ├── advisors.ts
│   │   └── report.ts
│   └── cli/
│       ├── dry-run.ts      CLI para pruebas sin Drive upload
│       └── migrate-to-db.ts  Migración manual JSON → PostgreSQL
├── fixtures/               Outputs del dry-run (gitignored en producción)
├── Dockerfile              Multi-stage: Node 20 builder + runtime con Chromium
└── .env.example            Plantilla de variables de entorno
```
