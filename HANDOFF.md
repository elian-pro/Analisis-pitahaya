# Zebra Reports — Documento de Handoff (Arquitectura y Operación)

> Servicio que genera **reportes PDF de desempeño de asesores de ventas** a partir de
> transcripciones de llamadas almacenadas en **Google Sheets**, usando **Claude (Anthropic)**
> para el análisis cualitativo y **Google Drive** para la entrega. Incluye un dashboard web
> (SPA) con métricas agregadas y exportación a PDF, y un programador de automatizaciones.

Este documento describe **cómo funciona el proyecto por dentro**: arquitectura, modelo de
datos, persistencia, integración con Google y Claude, el pipeline de generación, el dashboard
y las automatizaciones. Omite deliberadamente lo puramente visual (design system, animaciones).

---

## 1. Resumen en una frase

Por cada **cliente** configurado, el sistema lee las llamadas de un **Google Sheet**, las
agrupa por **asesor**, manda cada grupo a **Claude** (que devuelve un análisis estructurado vía
*tool use*), renderiza un **PDF por asesor** + un **PDF ejecutivo del equipo**, los **fusiona en
un solo documento** y lo **sube a Google Drive**. Puede dispararse **manualmente** desde el
dashboard o **automáticamente** por un programador interno.

---

## 2. Stack tecnológico

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 20, TypeScript (compilado con `tsc` a `dist/`) |
| Servidor HTTP | Express 4 |
| Validación | Zod (env, bodies de API, y **salida de Claude**) |
| IA | `@anthropic-ai/sdk` · modelo **`claude-sonnet-4-6`** · *tool use* forzado |
| Google | `googleapis` (Sheets v4, Drive v3, Chat v1) con **Service Account (JWT)** |
| PDF | **Plantillas Eta** (HTML) → **Playwright/Chromium** (`page.pdf`) → **pdf-lib** (merge) |
| Persistencia | **PostgreSQL** (`pg`) **o** archivos JSON (fallback) |
| Frontend | **`index.html`** — SPA estática de un solo archivo (sin framework, sin build) |

Scripts (`package.json`):
- `npm run dev` — `tsx watch src/server.ts` (desarrollo)
- `npm run build` — `tsc` → `dist/`
- `npm start` — `node dist/server.js` (producción)
- `npm run dry-run -- <client_id> <YYYY-MM> [asesor]` — prueba de lectura/análisis sin subir a Drive
- `npm run migrate:db` — migra JSON → Postgres (idempotente)
- `npm run type-check` — `tsc --noEmit`
- `npm test` — `tsx --test src/**/*.test.ts` (test runner nativo de Node, sin dependencia nueva;
  hoy solo cubre `src/metrics/aggregate.ts`)

---

## 3. Arquitectura general

```
┌─────────────────────────────────────────────────────────────────────┐
│  index.html (SPA)  ── fetch ──►  Express API  (/api/*)                │
│   · Reportes        POST /api/report → { job_id } → poll GET /:jobId  │
│   · Ajustes         CRUD /api/clients                                 │
│   · Automatización  CRUD /api/schedules  (+ POST /:id/run)            │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                    Job runner (asíncrono, en proceso)
                                  │
   1) Google Sheets  ─────────────┤  lee llamadas del periodo
   2) Agrupa por asesor           │
   3) Claude (tool use) ──────────┤  análisis individual por asesor (concurrencia 5)
   4) Claude (tool use) ──────────┤  reporte ejecutivo del equipo
   5) Eta + Chromium  ────────────┤  HTML → PDF por reporte
   6) pdf-lib  ───────────────────┤  fusiona todos los PDFs en uno
   7) Google Drive  ──────────────┤  sube el PDF combinado a la carpeta del cliente
   8) Sidecars  ──────────────────┤  escribe métricas por asesor (Drive .txt + tabla DB)
   9) Token log + estado del job  ┘  registra consumo y marca el job 'done'

   Scheduler interno (cada 60s) ── dispara jobs automáticamente cuando "toca"
```

**Punto de entrada:** `src/server.ts`. Monta los routers bajo `/api/*`, sirve `index.html`
como estática (con catch‑all `*` → SPA), corre el `bootstrap()` (DB + seeds + carga de jobs)
y arranca el scheduler tras `app.listen`.

---

## 4. Requisitos y variables de entorno

Validadas con Zod en `src/config/env.ts`. **Faltar una requerida aborta el arranque.**

| Variable | Requerida | Descripción |
|---|---|---|
| `GOOGLE_SA_JSON` | **Sí** | JSON **completo** de la Service Account de Google, en una sola línea. |
| `ANTHROPIC_API_KEY` | **Sí** | API key de Anthropic. |
| `PORT` | No (def. `3000`) | Puerto del servidor. |
| `DATABASE_URL` | Recomendada | URL de PostgreSQL. Si está, persiste en Postgres; si no, usa archivos JSON. |
| `DATABASE_SSL` | No | `true` solo para conexiones externas que requieren SSL. |
| `DATA_DIR` | No | Carpeta de los JSON (modo sin DB). Default `./data`. Montar volumen en prod. |
| `CHROMIUM_PATH` | No | Override opcional del ejecutable de Chromium. Sin definir, Playwright usa su Chromium propio (recomendado). El Dockerfile ya no lo define. |

Variables de override de rutas de archivo (opcionales): `SCHEDULES_FILE`, `JOBS_FILE`,
`TOKEN_LOG_FILE`, `CLIENTS_FILE` (ver `src/config/paths.ts`).

**Permisos de Google que necesita la Service Account:**
- Scopes Sheets/Drive: `spreadsheets.readonly` + `drive` (`src/google/auth.ts`).
- Scope Chat (cliente JWT separado): `chat.bot`.
- Cada **carpeta de Drive** del cliente debe estar compartida con el email de la SA como
  **Editor**, y preferentemente en una **Unidad Compartida** (la SA no tiene cuota propia de
  almacenamiento en "Mi Unidad" → ver el manejo de error `storageQuota` en `drive.ts`).
- Cada **Spreadsheet** compartido con la SA (Viewer o Editor).

---

## 5. Configuración de clientes

Un "cliente" describe **dónde** están los datos y **cómo** analizarlos. Definido por
`ClientConfig` (`src/clients/manager.ts`) y validado en `src/routes/clients.ts`.

| Campo | Uso |
|---|---|
| `id` | Slug único (autogenerado al crear desde la UI: `slug_xxxxxx`). |
| `name` | Nombre visible; aparece en el PDF y en los nombres de archivo. |
| `folder_id` | Carpeta de Drive donde se sube el PDF combinado. |
| `sidecar_folder_id` | (Opcional) Carpeta de sidecars. Si falta, se crea/usa `_Sidecars` dentro de `folder_id`. |
| `spreadsheet_id` | ID del Google Sheet con los datos. |
| `data_sheet_name` | Nombre de la **pestaña** con las llamadas (ej. `"Analisis"`). |
| `advisors_sheet_name` | (Opcional) Pestaña con la lista de asesores (fallback cuando no se pasa `month`). |
| `col_fecha` / `col_asesor` / `col_calif` / `col_analisis` / `col_transcripcion` | Nombres de columnas (se buscan por encabezado, *case-insensitive*). |
| `col_duracion` | (Opcional) Si está, las llamadas < 90s se descartan. |
| `col_record` | (Opcional) Link de grabación; si está, el reporte incluye "Escuchar grabación" en la mejor llamada. |
| `excluded_phrases` | Si una frase aparece en la transcripción, esa llamada se excluye. |
| `transcripcion_max_chars` | Trunca la transcripción antes de mandarla a Claude (controla costo/tokens). |
| `prompt_individual` | **Prompt de sistema** para el análisis por asesor. |
| `prompt_general` | **Prompt de sistema** para el reporte ejecutivo del equipo. |

> Los **prompts viven por cliente**, así cada cuenta puede tener su propia rúbrica de
> evaluación sin tocar código. En JSON, los saltos de línea deben ir como `\n` escapado.

---

## 6. Persistencia y base de datos

El sistema funciona en **dos modos**, decididos por la presencia de `DATABASE_URL`
(`src/config/db.ts`, `dbEnabled`):

- **Con `DATABASE_URL` → PostgreSQL.** Los datos sobreviven a los redeploys.
- **Sin `DATABASE_URL` → archivos JSON** en `DATA_DIR` (`schedules.json`, `jobs.json`,
  `token_log.json`) y `clients.json` en la raíz. Útil para desarrollo; **se pierden en cada
  rebuild del contenedor** salvo que montes un volumen.

`clients/manager.ts`, `schedules/store.ts`, `jobs/store.ts` y `tokens/store.ts` implementan la
misma API pública con ambos backends de forma transparente.

> ⚠️ **`metrics/store.ts` es la excepción: es DB-only, no tiene fallback a JSON.** Cada función
> empieza con `if (!dbEnabled) return …` (array vacío o `null` según el caso), así que sin
> `DATABASE_URL` el módulo es un no-op silencioso. Esto es intencional: `report_metrics` es un
> dato **redundante y de mejora** (acelera el comparativo periodo-a-periodo y alimenta el
> dashboard de métricas), nunca la única fuente de verdad — los sidecars `.txt` en Drive siguen
> siendo el fallback real para el comparativo, y sin DB el dashboard de métricas simplemente no
> tiene datos que mostrar (ver §11.1). *(Corregido en un repaso del código: una versión anterior
> de este documento implicaba que `metrics/store.ts` seguía el mismo patrón dual que los demás
> stores; no es así.)*

### 6.1 Tablas (creadas automáticamente en el arranque por `ensureSchema()`)

| Dato | Tabla | Forma | Notas |
|---|---|---|---|
| Clientes | `clients` | `id TEXT PK` + `data JSONB` | Objeto completo por fila. |
| Automatizaciones | `schedules` | `id TEXT PK` + `data JSONB` | Objeto completo por fila. |
| Historial de jobs | `jobs` | `id TEXT PK` + `data JSONB` | **Caché en memoria** + escritura a DB (ver 6.2). |
| Consumo de tokens | `token_log` | Columnas reales (`ts`, `input`, `output`, `advisors`, …) | Data analítica, se agrega por fecha. |
| Métricas por reporte | `report_metrics` | Columnas reales: `client_id TEXT`, `advisor TEXT`, `period_key TEXT`, `period_start DATE`, `avg_score INTEGER`, `pct_siguiente INTEGER`, `talk_ratio INTEGER`, `sidecar_text TEXT`, `created_at TIMESTAMPTZ`. | PK `(client_id, advisor, period_key)`. **No existen** `call_count`, `min`, `max` ni `sigma` como columnas — esas métricas se calculan en memoria por reporte (§9) pero no se persisten aquí. Índices: `(client_id, advisor, period_start)` y `(client_id, period_start)` (este último agregado para el dashboard, §11.1). DB-only, ver arriba. |

El patrón "objeto en columna `jsonb`" (clients/schedules/jobs) evita mantener un esquema
por campo: agregar un campo nuevo al objeto TypeScript **persiste solo**, sin migración SQL.
(Así se agregaron, por ejemplo, los campos de salud de las automatizaciones.)

### 6.2 Jobs: caché en memoria + durabilidad

`jobs/store.ts` mantiene un `Map` en memoria como **fuente de verdad para lecturas** (el
runner consulta el estado del job muy seguido, p. ej. para detectar cancelación). Las
escrituras van a Postgres (o al JSON) de forma **fire‑and‑forget** para durabilidad. En el
arranque, `initJobs()` recarga los jobs y **marca como `error`** cualquiera que quedó en
`pending`/`running` (interrumpido por un reinicio).

### 6.3 Migración automática JSON → Postgres

En el **primer arranque con `DATABASE_URL`**, si una tabla está vacía pero existe el JSON
legacy, se **copia** automáticamente (`seedClientsFromFileIfEmpty`, `seedSchedulesFromFileIfEmpty`,
`seedTokenLogFromFileIfEmpty`, y el seed de jobs en `initJobs`). También existe `npm run migrate:db`
para hacerlo manualmente (idempotente, upsert por `id`).

---

## 7. Lectura de Google Sheets (cómo se leen los archivos)

Todo en `src/google/sheets.ts`. Se lee con la API de Sheets v4:

```
sheets.spreadsheets.values.get({
  range: <data_sheet_name>,           // pestaña completa
  valueRenderOption: 'UNFORMATTED_VALUE',
  dateTimeRenderOption: 'SERIAL_NUMBER',
})
```

- **Fila 0 = encabezados.** Las columnas se localizan por **nombre** (`headerIndex`,
  *case-insensitive*, trim), no por posición. Si renombras una columna en el sheet, actualiza
  el `col_*` del cliente.
- **Parsing de fecha** (`parseSheetDate`) acepta: número serial de Sheets, `dd/mm/yyyy`,
  `dd-mm-yyyy`, `yyyy-mm-dd`, o cualquier cosa que `new Date()` entienda.
- **Filtro de periodo:** si el job trae `date_from`/`date_to` (semanal) filtra por **rango**;
  si no, por **mes** (`matchesMonth`).
- **Exclusiones:** si la transcripción contiene alguna `excluded_phrase`, la llamada se salta.
- **Duración mínima:** si hay `col_duracion`, las llamadas **< 90s** (`MIN_CALL_DURATION_SECONDS`)
  se descartan.
- **Truncado:** la transcripción se corta a `transcripcion_max_chars`.

Funciones públicas:
- `getCallData(...)` → lista de `CallRow` del periodo (lo que alimenta el pipeline).
- `getAdvisorsForMonth(...)` → asesores únicos **de la hoja de datos** para un mes (preferido,
  garantiza que los nombres coincidan con las llamadas).
- `getAdvisors(...)` → asesores desde la **hoja de apoyo** (fallback cuando no hay `month`).

---

## 8. El pipeline de generación (Job runner)

`src/jobs/runner.ts` → `runJob(job)`. Pasos (con logs `[runner] Step N`):

1. **Cargar cliente** y construir el `periodLabel`/`periodKey` (mensual o semanal).
2. **Leer llamadas** del sheet (`getCallData`). Si 0 → error explicativo.
3. **Agrupar por asesor**; calcular cuáles de los `job.advisors` tienen datos.
4. **Análisis individual con Claude**, en lotes de **concurrencia 5** (`runBatch`). Por asesor:
   - Busca el **reporte del periodo anterior** (primero DB `report_metrics`, luego sidecar de
     Drive) para el comparativo.
   - `processAdvisor(...)` llama a Claude (tool use) → `IndividualReportData` → **renderiza PDF**.
   - Actualiza `progress.completed`. Cada job consulta `getJob().status` para abortar si se canceló.
5. **Reporte ejecutivo del equipo** (solo si `job.type === 'general'`): `processGeneralReport(...)`
   → PDF de portada con ranking y KPIs.
6. **Merge** de todos los PDFs (general primero, luego cada asesor) con `pdf-lib`.
7. **Subir** el PDF combinado a `client.folder_id` (`uploadPdf` → `webViewLink`).
8. **Sidecars:** por asesor, escribe un `.txt` en `_Sidecars` **y** una fila en `report_metrics`
   (DB). Esto es lo que habilita el comparativo del próximo periodo. Un fallo aquí **no** rompe
   el reporte (se degrada a "Primer periodo" la próxima vez).
9. **Finalizar:** suma tokens, registra en `token_log` (`recordTokens`), marca el job `done` con
   `results.combined.driveUrl`. Si hubo fallos parciales (algún asesor o sidecar), van en `error`.

**Cancelación:** `POST /api/report/:jobId/cancel` pone el estado en `cancelled`; el runner lo
detecta entre pasos y se detiene limpio (`CancelledError`).

**Modos de reporte:**
- `type: "general"` → reportes individuales **+ portada ejecutiva del equipo**.
- `type: "selected"` → solo reportes individuales.
- (Resultado actual: se entrega **un solo PDF combinado** en `results.combined.driveUrl`.)

---

## 9. Integración con Claude

Dos módulos espejo: `src/claude/individual.ts` (por asesor) y `src/claude/general.ts` (equipo).

- **Modelo:** `claude-sonnet-4-6`, `max_tokens: 8192`.
- **Tool use forzado:** se define una herramienta con `input_schema` JSON estricto
  (`enviar_reporte_individual` / `enviar_reporte_general`) y `tool_choice: { type: 'tool', name }`.
  Claude **debe** responder llamando la herramienta → output estructurado, no prosa libre.
- **Validación:** el `tool_use.input` se valida con **Zod** (`schemas/individual.ts`,
  `schemas/general.ts`). Si no valida → reintenta.
- **Reintentos:** hasta **3** (`MAX_RETRIES`). Acumula tokens de todos los intentos.
- **Prompt de sistema:** el `prompt_individual`/`prompt_general` del cliente + una instrucción
  fija anti em‑dash y pro‑acentos/ñ.
- **Métricas deterministas:** el código calcula directamente (no Claude) `avg_score`, `min`,
  `max`, `sigma`, `call_count` desde la columna de calificación. Los **deltas vs periodo
  anterior** también se calculan en código a partir del sidecar previo. **Importante:** de todo
  esto, solo `avg_score`, `pct_logra_siguiente_paso` (como `pct_siguiente`) y `talk_ratio` se
  persisten en `report_metrics` (§6.1) — `min`, `max`, `sigma` y `call_count` viven únicamente en
  el PDF/sidecar del periodo y **no son consultables históricamente** (por eso el dashboard de
  métricas, §11.1, solo puede graficar esas 3).
- **Mejor llamada:** Claude devuelve un índice 1‑based; si está fuera de rango se cae a la
  llamada de mayor `calif`. De ahí sale el link de grabación opcional.

### Sidecars y comparativo periodo‑a‑periodo
`buildSidecar()` produce un texto con un bloque `=== METRICAS_JSON === {avg_score, pct_logra_
siguiente_paso, talk_ratio}`. `parseSidecarMetrics()` lo vuelve a leer el próximo periodo. La
búsqueda del periodo anterior toma **el sidecar más reciente estrictamente anterior** al actual
(resiliente a semanas no contiguas y a cambios mensual↔semanal). Orden de resolución:
**DB `report_metrics` → fallback Drive `_Sidecars`**.

---

## 10. Generación de PDF

`src/pdf/renderer.ts` + `src/pdf/templates/*.eta` + `src/pdf/merge.ts`.

- Las plantillas **Eta** (`individual.eta`, `general.eta`, `dashboard.eta`) reciben datos y
  producen HTML. El logo se inyecta como base64 (`_logoB64`). Ninguna plantilla ejecuta
  `<script>`/JS: cualquier gráfica se construye con CSS puro o se inyecta como `<img>` ya
  renderizada (ver `dashboard.eta`, §11.1).
- **Playwright/Chromium** (`page.setContent` + `page.pdf`, formato A4, `printBackground`,
  márgenes 0) convierte el HTML a PDF. El **browser se reutiliza** entre renders
  (singleton `_browser`). En Docker usa `CHROMIUM_PATH=/usr/bin/chromium` con `--no-sandbox`.
- `pdf-lib` (`mergePdfs`) une los buffers en un solo documento.

> En Docker las plantillas se copian a `dist/pdf/templates` (ver `Dockerfile`), no se compilan
> con TS. Si agregas/renombras una plantilla, asegúrate de que el Dockerfile la copie.

---

## 11. El dashboard (SPA `index.html`)

Un **único archivo** servido como estático; sin framework ni build. Cuatro pestañas
(`setTab`): **Reportes**, **Dashboard**, **Ajustes**, **Automatización**. Habla con la API por
`fetch`.

- **Reportes:** elige cliente + mes/semana + asesores → modal de confirmación
  (consulta `GET /api/report/previous` para avisar si hay periodo anterior comparable) →
  `POST /api/report` → **polling** de `GET /api/report/:jobId` mostrando progreso paso a paso →
  links a los PDFs. Incluye el panel **"Consumo de tokens · IA"** que consulta `GET /api/stats`.
- **Dashboard:** ver §11.1.
- **Ajustes:** CRUD de clientes (`/api/clients`) — incluye los prompts por cliente.
- **Automatización:** CRUD de automatizaciones (`/api/schedules`), disparo manual
  (`POST /api/schedules/:id/run`), indicador de salud (verde/rojo/gris) y, mientras la pestaña
  está abierta, **polling cada 3.5s** para reflejar corridas en progreso.

Carga de asesores: `GET /api/advisors?client_id=&month=`. Espacios de Google Chat (para
notificaciones de automatizaciones): `GET /api/chat/spaces`.

### 11.1 Dashboard de métricas

Vista de rendimiento agregado por cliente sobre `report_metrics`, con exportación a PDF.
Construido en 4 sprints (`DASHBOARD_METRICAS_PLAN.md` tiene la traza completa de decisiones).

- **Backend (`src/metrics/aggregate.ts` + `src/routes/metrics.ts`):**
  - `queryReportMetrics(clientId, from, to, advisor?)` (`metrics/store.ts`) lee filas crudas de
    `report_metrics` por `client_id` y rango de `period_start`, filtrando **solo periodos
    mensuales** (`period_key` con forma `YYYY-MM`). Esto evita doble conteo si algún día coexisten
    filas semanales y mensuales para el mismo cliente y rango (nada en el sistema lo impide hoy).
  - `aggregateMetrics(rows, granularity)` (función pura, con tests) agrupa por bucket temporal en
    6 granularidades (`weekly`, `monthly`, `bimonthly`, `quarterly`, `semiannual`, `annual`) con
    **promedio simple** (no hay `call_count` para ponderar), generando una serie de equipo y una
    serie por asesor.
  - `GET /api/metrics?client_id=&from=&to=&granularity=&advisor=` devuelve
    `{ advisors, buckets, team, by_advisor }` para esos filtros.
  - `POST /api/metrics/pdf` recibe los mismos filtros más dos imágenes PNG (base64, ya
    renderizadas por el navegador) y devuelve el PDF como descarga directa (no sube a Drive: es un
    export ad-hoc sin job ni carpeta asociados).
- **Frontend:** controles de cliente/rango/granularidad + toggle Vista equipo / Vista asesor.
  Gráficas con **Chart.js cargado vía CDN** (`<script src="cdn.jsdelivr.net/npm/chart.js@4">`,
  sin build nuevo — consistente con que el resto del SPA ya depende de CDNs para iconos y
  tipografía). Vista de equipo: tendencia (línea) + ranking de asesores del último periodo del
  rango (barras). Vista de asesor: serie histórica + línea de referencia del promedio del equipo
  + delta vs periodo anterior (misma lógica de resta simple que `delta_score`/
  `delta_siguiente_paso` en `claude/individual.ts`, recalculada sobre los dos últimos puntos de la
  serie del asesor).
- **PDF (`src/pdf/templates/dashboard.eta`):** portada + gráfica de tendencia + gráfica de ranking
  + tabla resumen por asesor y periodo. Las gráficas se generan **en el navegador** y se inyectan
  como `<img>` (igual que el logo `_logoB64`), **no** se ejecuta Chart.js dentro de Chromium
  durante el render del PDF — las plantillas `.eta` de este proyecto nunca han ejecutado JS, así
  que esto evita introducir esa dependencia nueva (y la incertidumbre de si el contenedor de
  producción permite esa salida de red durante el render).
- **Pendiente de validar en producción** (no se pudo verificar en el entorno donde se construyó
  esta feature, que no tenía `DATABASE_URL` ni Docker disponibles): el query real contra
  `report_metrics` con datos reales, y la generación del PDF dentro del contenedor Docker
  (`CHROMIUM_PATH=/usr/bin/chromium`) en vez de con el Chromium de Playwright usado en desarrollo.

---

## 12. Automatizaciones (scheduler interno)

`src/schedules/store.ts` (modelo + persistencia) y `src/schedules/runner.ts` (motor).

### 12.1 Modelo `Schedule`
Campos clave: `client_id`, `enabled`, `frequency` (`weekly`|`monthly`|`once`), día/hora
(`day_of_week`/`day_of_month`/`run_date`, `hour`, `minute`, `timezone`), `report_type`,
`include_general`, `advisors` (`'all'` o lista), modo `notify_only`, datos de Google Chat
(`chat_space_id`, `chat_message`, `error_notify_enabled`, `error_chat_space_id`).
Campos de **salud** (transitorios/históricos): `last_run`, `last_attempt`, `last_status`
(`'ok'`|`'error'`), `last_error`.

### 12.2 Motor
- `startScheduler()` corre un check **cada 60s** (más un check inmediato al arrancar para
  ponerse al día tras un deploy).
- `isDue(schedule)` decide si "toca": día/hora correctos en la **timezone** del schedule,
  con semántica de **catch‑up** (dispara si la hora ya pasó hoy) y guarda "ya corrió hoy"
  vía `last_run`.
- `fireSchedule(schedule)` calcula el periodo a analizar (semana anterior / mes anterior /
  periodo elegido para `once`), resuelve asesores (`'all'` los lee del sheet), crea el **job**
  (mismo runner del pipeline), notifica por Google Chat al terminar, y para `once` se
  autodesactiva. Devuelve un `FireResult` (`ok`/`job_id`/`error`).
- **Disparo manual:** `runScheduleNow(id)` llama a `fireSchedule` **saltándose `isDue`**
  (funciona incluso si está pausada). Expuesto en `POST /api/schedules/:id/run`.
- **Salud:** `markRan` (ok) / `markFailed` (error, con motivo) registran el resultado de cada
  corrida sin tocar la lógica de reintento. El dashboard lo pinta como indicador verde/rojo.
- **Estado "running":** un `Set` en memoria (`runningScheduleIds()`) marca qué automatizaciones
  tienen un job en vuelo; se expone como `running: true` en `GET /api/schedules` (transitorio:
  un reinicio lo limpia, así nunca queda "pegado").
- **Notificaciones:** al terminar manda un mensaje al `chat_space_id`; ante fallo, si está
  configurado, avisa al `error_chat_space_id` (`src/google/chat.ts`).

---

## 13. Referencia de API

Base: `/api`. Todas devuelven JSON; errores como `{ "error": "..." }`.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | `{ status, ts, build }`. Usado por el healthcheck de Docker. |
| GET | `/advisors?client_id=&month=YYYY-MM` | Asesores del periodo (de la hoja de datos; sin `month` usa la hoja de apoyo). |
| POST | `/report` | Encola un job. Body: `client_id, month, type('selected'|'general'), advisors[], period_type, date_from?, date_to?`. → `202 { job_id }`. |
| GET | `/report/:jobId` | Estado del job (`pending`→`running`→`done`|`error`|`cancelled`), `progress`, `results`. |
| POST | `/report/:jobId/cancel` | Cancela un job en curso. |
| GET | `/report/previous?client_id=&month=&period_type=&date_from=&advisors=` | ¿Hay periodo anterior comparable? (hint para la UI). |
| GET | `/stats?from=YYYY-MM-DD&to=YYYY-MM-DD&client_id?` | Consumo de tokens agregado (input/output/costo/jobs/por día). |
| GET | `/metrics?client_id=&from=YYYY-MM-DD&to=YYYY-MM-DD&granularity=&advisor?` | Métricas agregadas del dashboard (§11.1). `granularity` ∈ `weekly\|monthly\|bimonthly\|quarterly\|semiannual\|annual`. |
| POST | `/metrics/pdf` | Genera el PDF del dashboard. Body: mismos filtros que el GET + `team_trend_image`, `ranking_image` (PNG en base64, o `null`). Devuelve el PDF como descarga directa. |
| GET/POST/PUT/DELETE | `/clients` · `/clients/:id` | CRUD de clientes. |
| GET/POST/PUT/DELETE | `/schedules` · `/schedules/:id` | CRUD de automatizaciones. GET incluye `running`. |
| POST | `/schedules/:id/run` | Dispara manualmente (bypassa día/hora). `202 { ok, job_id }` o `422 { ok:false, error }`. |
| GET | `/chat/spaces` | Lista de espacios de Google Chat visibles para el bot. |

**Costo de tokens:** se calcula con `INPUT_CPM = 3.0` y `OUTPUT_CPM = 15.0` USD por millón
(precios Sonnet) en `tokens/store.ts` y en el resumen del job.

---

## 14. Despliegue (Docker / EasyPanel)

- **Dockerfile** multi‑stage: *builder* (compila TS) + *runtime* (instala `chromium` del
  sistema, copia `dist/`, plantillas, `index.html`, `clients.json`, assets y `fixtures/`).
  `ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` + `CHROMIUM_PATH=/usr/bin/chromium`. Expone `3000`.
  Healthcheck → `GET /api/health`.
- **EasyPanel:** crear App desde el repo (Dockerfile, puerto 3000), setear las env vars, y
  **crear un servicio Postgres en el mismo proyecto** para `DATABASE_URL` (usar la *Internal
  Connection URL*, sin SSL en red privada). Sin Postgres, los datos no sobreviven a redeploys.
- **Persistencia sin DB:** montar un volumen y apuntar `DATA_DIR` (y/o `CLIENTS_FILE`) a él.

---

## 15. Desarrollo local

```bash
cp .env.example .env         # completar GOOGLE_SA_JSON y ANTHROPIC_API_KEY
npm install
npm run dev                  # http://localhost:3000

# Probar lectura + análisis SIN subir a Drive:
npm run dry-run -- <client_id> 2026-05
npm run dry-run -- <client_id> 2026-05 <Asesor>
```

En local, Playwright descarga Chromium la primera vez (en Docker usa el del sistema).

---

## 16. Estructura del proyecto (orientación rápida)

```
src/
  server.ts              Entry point: monta rutas, bootstrap DB/seeds/jobs, arranca scheduler
  config/
    env.ts               Validación de env (Zod) + getGoogleServiceAccount()
    db.ts                Pool de Postgres, ensureSchema(), helpers jsonb genéricos
    paths.ts             Rutas de los JSON (modo sin DB) + init de archivos
  clients/manager.ts     ClientConfig + CRUD (DB o JSON)
  google/
    auth.ts              Clientes JWT (Sheets/Drive y Chat por separado)
    sheets.ts            Lectura de llamadas/asesores, parsing de fechas, filtros
    drive.ts             Upload de PDF, sidecars, lookup de periodo anterior, labels
    chat.ts              listSpaces(), sendChatMessage()
  claude/
    individual.ts        Análisis por asesor (tool use, retries, métricas, sidecar)
    general.ts           Reporte ejecutivo del equipo (tool use, ranking, KPIs)
  schemas/               Zod schemas del output de Claude (individual/general)
  pdf/
    renderer.ts          Eta → Chromium → PDF (browser singleton)
    merge.ts             pdf-lib merge
    templates/*.eta      Plantillas HTML de los PDFs (individual, general, dashboard)
  jobs/
    store.ts             Job model, caché en memoria + persistencia, initJobs()
    runner.ts            runJob(): orquesta el pipeline de 9 pasos
  schedules/
    store.ts             Schedule model, CRUD, markRan/markFailed
    runner.ts            isDue(), fireSchedule(), runScheduleNow(), running set, scheduler 60s
  metrics/
    store.ts            report_metrics (DB-only, sin fallback JSON): comparativo periodo
                         anterior + queryReportMetrics() para el dashboard (§11.1)
    aggregate.ts         aggregateMetrics(): bucketing puro por granularidad (con tests)
    aggregate.test.ts    tests (node:test, via `npm test`)
  tokens/store.ts       token_log: registro y agregación de consumo
  routes/               health, advisors, report, stats, metrics, clients, schedules, chat
  cli/
    dry-run.ts           Prueba sin Drive
    migrate-to-db.ts     Migración manual JSON → Postgres
index.html               Dashboard (SPA de un archivo)
clients.json             Config de clientes (modo sin DB; seed inicial con DB)
Dockerfile · .env.example
```

---

## 17. Notas de operación y puntos sensibles

- **Sin `DATABASE_URL` los datos no persisten** entre redeploys (clientes/automatizaciones/jobs).
  Para producción, usar Postgres.
- **Coincidencia exacta de nombres:** los `col_*` deben coincidir con los encabezados del sheet,
  y los nombres de asesor deben coincidir (mayúsculas/espacios) entre la lista y la columna de
  datos. Por eso `getAdvisorsForMonth` lee de la **hoja de datos**.
- **Drive en Unidad Compartida:** si la carpeta está en "Mi Unidad" de un usuario, la SA puede
  fallar por cuota (`storageQuota`). Usar Unidad Compartida con la SA como miembro.
- **Jobs interrumpidos:** un reinicio marca como `error` lo que estuviera `running`/`pending`
  (no hay reanudación de jobs a medias).
- **Estado "running" de automatizaciones es en memoria:** correcto para una sola instancia; con
  múltiples réplicas no se comparte (cada proceso ve su propio set).
- **Costo:** cada corrida consume tokens de Claude **y** publica en el Google Chat del cliente
  (en automatizaciones y en disparo manual). El disparo manual pide confirmación en la UI.
- **`claude-sonnet-4-6`** está fijado en `claude/individual.ts` y `claude/general.ts`; cambiar el
  modelo es editar esas dos constantes `MODEL`.
- **Dashboard de métricas sin `DATABASE_URL`:** como `metrics/store.ts` es DB-only (ver §6),
  `GET /api/metrics` responde `200` con arrays vacíos en vez de fallar, y el dashboard muestra el
  estado "sin datos" en vez de romperse. Es el comportamiento esperado en desarrollo local sin DB,
  no un bug.

---

## 18. Cómo extender (recetas comunes)

- **Nuevo campo de cliente:** agrégalo a `ClientConfig`, al Zod de `routes/clients.ts` y úsalo
  donde corresponda. Persiste solo (columna `jsonb`).
- **Nuevo campo de automatización:** agrégalo a `Schedule` y al Zod de `routes/schedules.ts`.
- **Nuevo dato en el PDF:** amplía el `input_schema` de la herramienta de Claude **y** el Zod
  schema correspondiente **y** la plantilla `.eta`.
- **Nuevo endpoint:** crea un router en `src/routes/`, móntalo en `server.ts`.
- **Cambiar concurrencia del análisis:** parámetro `5` en `runBatch(advisorsWithData, 5, …)`
  (`jobs/runner.ts`).
```
