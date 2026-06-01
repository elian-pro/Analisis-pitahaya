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
│   ├── server.ts           Express entry point
│   ├── config/env.ts       Validación de variables de entorno (Zod)
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
│   │   ├── store.ts        In-memory + /tmp/jobs.json
│   │   └── runner.ts       Orquestador del pipeline completo
│   ├── routes/
│   │   ├── health.ts
│   │   ├── advisors.ts
│   │   └── report.ts
│   └── cli/
│       └── dry-run.ts      CLI para pruebas sin Drive upload
├── fixtures/               Outputs del dry-run (gitignored en producción)
├── Dockerfile              Multi-stage: Node 20 builder + runtime con Chromium
└── .env.example            Plantilla de variables de entorno
```
