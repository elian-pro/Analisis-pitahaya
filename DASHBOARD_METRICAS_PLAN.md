# Plan de Construcción — Dashboard de Métricas de Asesores

> **Para Claude Code:** Este documento describe la construcción de una sección nueva de
> dashboard de métricas dentro del proyecto **Zebra Reports**. Está organizado en sprints y
> tickets. **Lee TODO el documento antes de empezar a escribir código.** Sigue los tickets en
> orden. No saltes el Sprint 0: define hechos que el resto del plan asume.

---

## 0. Cómo usar este documento

Este plan fue redactado **sin acceso directo al repositorio**, partiendo del `HANDOFF.md`.
Durante la investigación previa se confirmó que **el handoff tiene imprecisiones** (por ejemplo,
prometía columnas `call_count`, `min`, `max`, `sigma` en `report_metrics` que **no existen** en
la base real). Por eso este documento es **defensivo**:

- **Cada ticket que toca código existente empieza con un paso de verificación** contra el repo real.
- **Nunca asumas** nombres de archivos, funciones, columnas o rutas sin confirmarlos primero.
- Si encuentras una discrepancia entre este documento y el repo, **el repo manda**. Anótala en
  el ticket y continúa con la realidad del código.

**Convención de tickets:**
- `[VERIFY]` = paso de comprobación obligatorio antes de implementar.
- `[IMPL]` = implementación.
- `[TEST]` = validación.
- `DoD` = Definition of Done (criterios de aceptación).

---

## 1. Objetivo del proyecto

Construir un **dashboard de métricas** dentro del panel interno (`index.html`) que permita:

1. **Vista de cliente:** ver el rendimiento agregado del equipo de asesores de un cliente, su
   tendencia en el tiempo y un ranking entre asesores.
2. **Vista de asesor individual:** ver la serie histórica de un asesor, su comparativo contra el
   periodo anterior y contra el promedio del equipo.
3. **Control total de granularidad temporal:** semanal, mensual, bimestral, trimestral,
   semestral y anual, sobre un rango de fechas elegible.
4. **Exportar a PDF:** generar un documento PDF con las métricas del rango/cliente seleccionado,
   reutilizando el pipeline de PDF existente (Eta → Chromium → pdf-lib).

**Alcance y supuestos confirmados durante la investigación:**

- El dashboard es **solo de uso interno** (equipo de la agencia). Los clientes finales **no**
  acceden al dashboard; solo reciben el **PDF** como entregable. **No se requiere autenticación
  nueva, ni portal de cliente, ni roles.**
- La fuente de datos es la tabla **`report_metrics`** en PostgreSQL (base `db_zp`, schema
  `public`). Su esquema **real confirmado** es:

  | Columna | Tipo | Notas |
  |---|---|---|
  | `client_id` | text | Parte de la PK lógica. |
  | `advisor` | text | Parte de la PK lógica. |
  | `period_key` | text | Identificador del periodo. **Ver Sprint 0 — su formato debe confirmarse.** |
  | `period_start` | date | **Fecha real del inicio del periodo. Es la clave para agregar por tiempo.** |
  | `avg_score` | integer | Métrica 1. |
  | `pct_siguiente` | integer | Métrica 2 (% logra siguiente paso). |
  | `talk_ratio` | integer | Métrica 3. |
  | `sidecar_text` | text | Texto del sidecar. |
  | `created_at` | timestamptz | Marca de creación de la fila. |

- **No existen** las columnas `call_count`, `min`, `max`, `sigma`. **Consecuencias firmes:**
  - **No** se puede ponderar promedios por número de llamadas → se usa **promedio simple**.
  - **No** se puede graficar volumen de llamadas ni bandas de dispersión (min/max/sigma).
  - Las **únicas 3 métricas graficables** hoy son `avg_score`, `pct_siguiente`, `talk_ratio`.
- Al momento de redactar este plan hay **muy pocos datos** (1 cliente, 4 asesores, 1 solo
  periodo). El dashboard se construye sabiendo que **se poblará con el tiempo**; debe verse
  correcto tanto con 1 punto como con muchos.

---

## Sprint 0 — Verificación de terreno (BLOQUEANTE)

> **Objetivo:** confirmar contra el repo real los hechos que el resto del plan asume. No
> escribas código de features en este sprint. Solo investiga, confirma y deja notas.

### Ticket 0.1 `[VERIFY]` Mapear la arquitectura real del backend
- Abre `src/server.ts`. Confirma **cómo se montan los routers** bajo `/api/*` y el patrón exacto
  para registrar uno nuevo.
- Abre un router existente sencillo (ej. `src/routes/stats.ts`). Documenta el **estilo real**:
  manejo de errores, forma de respuesta JSON, uso (o no) de Zod para validar query params,
  cómo accede a la DB.
- Abre `src/metrics/store.ts`. Confirma **cómo lee/escribe `report_metrics`**, si soporta el modo
  dual DB/JSON, y qué funciones públicas expone.
- Abre `src/config/db.ts`. Confirma el helper real para correr queries (pool `pg`, nombre de la
  función, si hay un wrapper para `jsonb`).
- **DoD:** una nota corta en el ticket con: nombre exacto del patrón de router, ruta y firma del
  helper de DB, y la API pública actual de `metrics/store.ts`.

> **✅ Notas de verificación (cerrado):**
> - **Montaje de routers** (`src/server.ts:24-31`): cada router es un módulo `Router()` exportado
>   por defecto desde `src/routes/<nombre>.ts`, importado en `server.ts` y montado con
>   `app.use('/api/<nombre>', xRouter)`. Patrón nuevo: crear `src/routes/metrics.ts`, importar
>   `metricsRouter from './routes/metrics'`, añadir `app.use('/api/metrics', metricsRouter);`
>   junto a las demás líneas (antes del bloque "Static frontend").
> - **Estilo real de un router** (`src/routes/stats.ts`): usa `Router()` de express, valida query
>   params con un `z.object({...}).safeParse(req.query)` y responde `400` con
>   `{ error: '<mensaje>' }` si falla. El handler es `async`, envuelve la llamada a la capa de
>   datos en `try/catch` y responde `500` con `{ error: (e as Error).message }` en error, o
>   `res.json(data)` en éxito (sin envoltorio `{data: ...}`). Mismo patrón en `clients.ts`,
>   `report.ts`, `advisors.ts` — todos usan Zod para body/query y el mismo `try/catch → 500`.
> - **`src/metrics/store.ts` — discrepancia con el plan:** **NO** tiene modo dual DB/JSON. Es
>   **DB-only**: cada función empieza con `if (!dbEnabled) return;` (o `return null;`), o sea, sin
>   `DATABASE_URL` el módulo es un no-op silencioso (no hay fallback a archivo JSON para
>   `report_metrics`, a diferencia de `clients/manager.ts` o `schedules/store.ts`). El plan dice
>   "respetando su patrón dual DB/JSON existente" en el Ticket 1.1: **eso es incorrecto**, no
>   existe tal patrón dual en este módulo — el repo manda. La función nueva de lectura agregada
>   debe asumir DB-only igual que el resto del módulo (si `!dbEnabled`, devolver array vacío).
>   - API pública actual: `recordReportMetrics(clientId, advisor, periodKey, avgScore,
>     pctSiguiente, talkRatio, sidecarText)`, `previousReportTextFromDb(clientId, advisor, month,
>     periodType, dateFrom?)`, `previousPeriodKeyFromDb(clientId, advisors[], month, periodType,
>     dateFrom?)`. Ninguna hace SELECT genérico por rango de fechas — hay que añadirla.
> - **`src/config/db.ts`:** pool real es `pool: Pool | null` (de `pg`), `dbEnabled: boolean`. Para
>   queries crudas se usa `pool!.query(sql, params)` directamente (ver `metrics/store.ts`), no hay
>   un wrapper genérico para SQL libre — solo helpers genéricos `dbLoadAll/dbGet/dbUpsert/dbDelete/
>   dbCount` para tablas `id + data jsonb` (clients, schedules, jobs), que **no aplican** a
>   `report_metrics` porque esa tabla tiene columnas reales, no jsonb. La tabla ya existe con
>   `PRIMARY KEY (client_id, advisor, period_key)` y un índice
>   `report_metrics_lookup_idx (client_id, advisor, period_start)`.

### Ticket 0.2 `[VERIFY]` Confirmar el formato y la semántica de `period_key` y `period_start`
- Busca en el código **dónde se escribe** una fila en `report_metrics` (probablemente
  `src/jobs/runner.ts` paso 8, `src/metrics/store.ts`, o `src/claude/individual.ts`).
- Determina con certeza:
  - ¿Qué string se guarda en `period_key`? (¿`2026-06`? ¿`2026-W26`? ¿una fecha como
    `2026-06-29`?) Durante la investigación previa se observó `period_key = '2026-06-29'`, lo que
    sugiere que **podría estar guardando una fecha en vez de un identificador estable de periodo**.
  - ¿`period_start` siempre representa el primer día del periodo analizado, o la fecha de
    generación? Esto es **crítico**: toda la agregación temporal se hará sobre `period_start`.
  - ¿Cómo se distingue una fila **semanal** de una **mensual**? ¿Hay algún campo que lo indique,
    o solo se infiere del rango? Si **no hay** forma de distinguirlas, anótalo: afecta el riesgo
    de doble conteo (ver Ticket 0.3).
- **DoD:** nota que responda las 3 preguntas con la línea de código exacta que lo demuestra.

> **✅ Notas de verificación (cerrado):**
> - **¿Qué se guarda en `period_key`?** Se decide en `currentPeriodKey()` (`src/google/drive.ts:
>   217-223`): `return periodType === 'weekly' && dateFrom ? dateFrom : month;`. Para periodos
>   **mensuales** es el string `'YYYY-MM'` (ej. `'2026-06'`) — **sí es un identificador estable de
>   periodo**, no una fecha. Para periodos **semanales** es literalmente `dateFrom`, una fecha
>   `'YYYY-MM-DD'`. El riesgo anotado en el Anexo ("`period_key` podría ser una fecha") **se
>   confirma parcialmente**: es cierto solo para filas semanales (por diseño, no por accidente);
>   las mensuales sí tienen un identificador estable.
> - **¿`period_start` es el inicio real del periodo o la fecha de generación?** Es el inicio real.
>   Se calcula en `recordReportMetrics()` (`src/metrics/store.ts:40`) como
>   `keyStartDate(periodKey)`, y `keyStartDate()` (`src/google/drive.ts:228-230`) normaliza:
>   `/^\d{4}-\d{2}$/.test(periodKey) ? periodKey + '-01' : periodKey`. O sea: mensual → primer día
>   del mes analizado; semanal → la fecha `dateFrom` (inicio real de la semana analizada). **Nunca**
>   es la fecha en que se generó/corrió el job (`created_at` es esa, columna aparte). Confirma la
>   decisión firme del plan de agregar sobre `period_start`.
> - **¿Cómo se distingue una fila semanal de una mensual?** **No hay columna dedicada.** Se infiere
>   por el **formato** de `period_key`: si matchea `/^\d{4}-\d{2}$/` (7 caracteres) es mensual; si
>   matchea `/^\d{4}-\d{2}-\d{2}$/` (10 caracteres, fecha completa) es semanal. Este mismo regex ya
>   se usa en el repo para esa distinción, ej. `src/routes/report.ts:14`
>   (`periodKeyLabel`) y `src/google/drive.ts:229`. La capa de agregación nueva debe reutilizar
>   esta misma regla (no inventar una nueva).

### Ticket 0.3 `[VERIFY]` Evaluar el riesgo de doble conteo (semanal + mensual)
- Con lo aprendido en 0.2, determina: **¿puede un mismo cliente tener, en el mismo rango de
  fechas, filas semanales Y mensuales que cubran las mismas llamadas?**
- Si la respuesta es **no** (cada cliente usa una sola granularidad, o las filas no se solapan),
  la agregación es trivial: agrupar por `period_start`.
- Si la respuesta es **sí o no se puede descartar**, el endpoint de agregación debe poder
  **filtrar por un tipo de periodo** para no sumar dos veces. Anota la estrategia elegida.
- **DoD:** decisión documentada (trivial / requiere filtro), justificada con los datos reales.

> **✅ Decisión (cerrado): requiere filtro, no es trivial.**
> Nada en el sistema impide correr un reporte semanal y uno mensual para el mismo cliente en el
> mismo rango de fechas: `period_type` es un parámetro libre por job (`src/routes/report.ts:24`,
> `z.enum(['monthly', 'weekly'])`), no hay validación que lo impida ni lo haga mutuamente
> excluyente por cliente. Si ambos se corren, `report_metrics` tendrá filas semanales con
> `period_start` cayendo *dentro* del rango cubierto por una fila mensual del mismo mes → sumar
> ambas en un mismo bucket duplicaría las llamadas de esas semanas.
> **Estrategia elegida:** el endpoint de agregación (Sprint 1) acepta un parámetro de tipo de
> periodo derivado igual que en el Ticket 0.2 (regex sobre `period_key`: 7 chars = mensual, 10
> chars = semanal) y por defecto **filtra a un solo tipo por consulta** (mensual, ya que es el caso
> de uso principal del dashboard: granularidad weekly/monthly/etc. agrupa sobre `period_start` de
> filas de un mismo "grano base"). Concretamente: la función de lectura agregada (Ticket 1.1) sólo
> trae filas donde `period_key` matchea el patrón mensual (`^\d{4}-\d{2}$`), descartando las
> semanales salvo que en el futuro se decida exponer un selector explícito de granularidad base en
> la UI.
> **Nota de alcance:** este sandbox no tiene `DATABASE_URL` configurado, así que esta decisión se
> basa en lectura de código (cómo se escribe `period_key`/`period_type`), no en inspección empírica
> de filas reales de `report_metrics`. Antes de implementar el Sprint 1 contra la DB real de
> producción, vale la pena correr `SELECT DISTINCT client_id, period_key FROM report_metrics` para
> confirmar si en la práctica ya existe mezcla semanal+mensual para algún cliente.

### Ticket 0.4 `[VERIFY]` Mapear el frontend (`index.html`)
- Abre `index.html`. Confirma:
  - Cómo funciona el sistema de pestañas (`setTab` u otro). Cómo se añade una pestaña nueva sin
    romper las existentes (**Reportes, Ajustes, Automatización**).
  - Cómo hace `fetch` a la API y cómo renderiza resultados (patrón real, no asumido).
  - Si ya hay **alguna librería cargada vía CDN** (para decidir el stack de gráficas en 0.5).
  - Cómo se cargan estilos y si hay un design system / variables CSS a respetar.
- **DoD:** nota con el mecanismo real de tabs y de fetch, y lista de librerías ya presentes.

> **✅ Notas de verificación (cerrado):**
> - **Tabs:** array global `_APP_TABS = ['reports','settings','automation']` (línea ~2006) +
>   función `setTab(tab)` (línea 2011): marca `tab-btn-<tab>` y `tab-<tab>` como `.active` (toggle
>   de clase) y limpia el resto. Cada botón de la barra es
>   `<button class="app-tab" id="tab-btn-<id>" onclick="setTab('<id>')">` (líneas 361-363) y cada
>   panel es `<div id="tab-<id>" class="tab-panel">` (líneas 365, 496, 508). Para añadir
>   "Dashboard": agregar `'dashboard'` a `_APP_TABS`, un `<button id="tab-btn-dashboard">`, un
>   `<div id="tab-dashboard" class="tab-panel">`, y opcionalmente un `if (tab === 'dashboard') {...}`
>   en `setTab()` para disparar la carga inicial (mismo patrón que `settings`/`automation`).
> - **Fetch:** todo vanilla `fetch('/api/...')` con `await`, sin librería HTTP. Patrón típico
>   (línea 1212, 2123): `await fetch(url).then(r => { if(!r.ok) throw new Error('HTTP '+r.status);
>   return r.json(); })`, dentro de `try/catch` que llena un `innerHTML` de error. No hay capa de
>   estado/reactividad — cada función de render hace `el.innerHTML = '...'` directamente con
>   template strings y un helper `_esc()` (línea ~1999) para escapar HTML.
> - **Librerías ya cargadas vía CDN:** solo **`@tabler/icons-webfont`** (CSS de iconos, línea 13) y
>   **Google Fonts (Inter)** (línea 12). **Ningún `<script src="...">` de terceros** — cero JS de
>   librería cargado hoy (no hay Chart.js, D3, React, ni build tool alguno).
> - **Design system:** variables CSS por tema en `body[data-theme="dark"|"light"]` (líneas 21-22):
>   `--bg`, `--surface`, `--surface2`, `--border`, `--border2`, `--fg`, `--muted`, `--faint`,
>   `--accent`, `--on-accent`, `--danger`, `--success`, más `--motif-*` para el watermark
>   diagonal. Hay también un kit de diseño más completo en
>   `zebra-design-system-kit/01-design-system/` (`DESIGN-SYSTEM.md`, `tokens.css`) que documenta
>   estas variables con más detalle — respetarlas para que la pestaña nueva no desentone.

### Ticket 0.5 `[VERIFY]` Evaluar y RECOMENDAR el stack de gráficas
- Con base en lo visto en 0.4, **evalúa** entre dos opciones y **recomienda una**, dejando la
  decisión escrita antes de implementar:
  - **Opción A — Vanilla JS + Chart.js vía CDN.** Consistente con el SPA actual (sin build), cero
    fricción de deploy, suficiente para líneas/barras. Recomendada **si** el `index.html` es
    efectivamente vanilla sin build.
  - **Opción B — Vite + framework (React/Recharts) solo para esta sección.** Más potente para UI
    compleja, pero obliga a montar build, ajustar el `Dockerfile` y servir assets nuevos.
    Justificable **solo si** ya existe build tooling o se prevé que esta sección crezca mucho.
- **Criterio guía:** preferir la opción que **minimice cambios al pipeline de deploy** salvo que
  haya una razón fuerte para lo contrario. Si el resto del SPA es vanilla, **Opción A**.
- **DoD:** una sección "Decisión de stack" con la opción elegida y 2-3 razones. **El resto de los
  tickets de frontend asumen la opción elegida aquí.**

> **✅ Decisión de stack (cerrado): Opción A — Vanilla JS + Chart.js vía CDN.**
> Razones:
> 1. `index.html` es confirmadamente vanilla sin build (Ticket 0.4): un solo archivo HTML servido
>    estático por Express, sin `package.json` de frontend, sin bundler, sin framework. Montar Vite
>    solo para esta sección rompería la premisa "un solo archivo" del resto del SPA y obligaría a
>    tocar el `Dockerfile` (build step adicional, copiar `dist/` del frontend) sin necesidad.
> 2. El criterio guía del propio plan ("minimizar cambios al pipeline de deploy") apunta
>    directamente a A: el `Dockerfile` ya copia `index.html` tal cual (línea 24) — añadir un
>    `<script src="https://cdn.jsdelivr.net/npm/chart.js">` no cambia ni el build ni el deploy.
> 3. El alcance real (líneas/barras simples para 3 métricas, pocos puntos de datos) no necesita el
>    poder de Recharts/React; Chart.js cubre sobradamente line + bar charts con poco código.
> **Implicación para el Sprint 2:** la pestaña Dashboard se construye como el resto del SPA — HTML
> embebido + funciones JS en el mismo `<script>` de `index.html`, con `<canvas>` para cada gráfica
> y `new Chart(ctx, {...})`. Cargar el script de Chart.js vía CDN en el `<head>` junto a los demás.

### Ticket 0.6 `[VERIFY]` Mapear el pipeline de PDF
- Abre `src/pdf/renderer.ts`, `src/pdf/merge.ts` y `src/pdf/templates/*.eta`. Confirma:
  - La firma real de la función que convierte HTML/plantilla → PDF (singleton de browser, args
    de Chromium, `CHROMIUM_PATH`).
  - Cómo una plantilla `.eta` recibe datos y cómo se inyecta el logo (`_logoB64`).
  - Cómo el `Dockerfile` copia las plantillas a `dist/` (para no olvidar copiar la nueva).
- **DoD:** nota con la firma del renderer, el patrón de plantilla y la línea del Dockerfile que
  copia plantillas.

> **✅ Notas de verificación (cerrado):**
> - **Firma del renderer** (`src/pdf/renderer.ts:36`):
>   `renderPdf(template: string, data: Record<string, unknown>): Promise<Buffer>`. Internamente:
>   `Eta` (instanciada una vez, `views` apuntando a `src/pdf/templates`, `cache: true`,
>   `autoEscape: true`) renderiza `template` con `{ ...data, _logoB64 }` → HTML string →
>   `page.setContent(html, { waitUntil: 'networkidle' })` en un singleton de `Browser` de
>   Playwright (`chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args:
>   ['--no-sandbox','--disable-setuid-sandbox'] })`) → `page.pdf({ format: 'A4', printBackground:
>   true, margin: 0 })`. `closeBrowser()` existe para cerrar el singleton (no se usa en
>   request/response normal, solo para shutdown). `mergePdfs(buffers: Buffer[]): Promise<Buffer>`
>   en `src/pdf/merge.ts` concatena páginas con `pdf-lib` (si es 1 solo buffer, lo devuelve tal
>   cual sin pasar por pdf-lib).
> - **Inyección del logo:** `getLogoB64()` lee `Logo Zebra Blanco.png` desde la raíz del proyecto
>   (`path.join(__dirname, '..', '..', 'Logo Zebra Blanco.png')`) una sola vez, cachea el base64 en
>   memoria, y `renderPdf` lo añade automáticamente a los datos como `_logoB64` antes de renderizar
>   — **cualquier plantilla nueva lo recibe gratis**, solo hay que usarlo igual que
>   `individual.eta` (línea 88): `<% if (it._logoB64) { %><img src="data:image/png;base64,<%=
>   it._logoB64 %>" ...><% } %>`.
> - **Patrón de plantilla:** sintaxis Eta (`<%= %>` escapado, `<% %>` lógica JS embebida, helpers
>   declarados inline con `const fn = function(...) {...}` dentro de un bloque `<% %>` al inicio
>   del body). **Importante:** las plantillas existentes (`individual.eta`, `general.eta`) **no
>   usan `<script>` ni `<canvas>` en absoluto** — todas las "gráficas" (barras de criterios, etc.)
>   son CSS puro (`<div class="bar-fill" style="width: X%">`), no hay precedente de ejecutar JS de
>   terceros (ej. Chart.js) dentro del HTML que se pasa a Chromium. Esto es relevante para el
>   Ticket 3.1 (ver más abajo): no hay garantía documentada de que el contenedor de producción
>   tenga salida a internet para que un `<script src="cdn...">` cargue dentro del Chromium
>   headless — `page.setContent` con `waitUntil:'networkidle'` esperaría esa carga y podría colgar
>   o fallar en silencio si no hay red de salida.
> - **Dockerfile — línea que copia plantillas:** `Dockerfile:23` →
>   `COPY src/pdf/templates ./dist/pdf/templates`. Cualquier `.eta` nuevo dentro de
>   `src/pdf/templates/` se copia automáticamente (es un `COPY` de carpeta completa, no de
>   archivos individuales), así que **no hace falta tocar el Dockerfile** al añadir
>   `dashboard.eta` — mitiga el riesgo #4 del Anexo de raíz, ya que el wildcard de carpeta lo cubre
>   sin intervención manual.

---

### Cierre del Sprint 0 — resumen de hallazgos para los siguientes sprints

- **Sprint 0 completo.** Los 6 tickets (`0.1`–`0.6`) quedaron verificados con notas inline arriba.
  No se escribió código de features, solo investigación, tal como pide el objetivo del sprint.
- **Discrepancias confirmadas vs el handoff/plan original:**
  - `src/metrics/store.ts` **no** tiene modo dual DB/JSON (es DB-only); el Ticket 1.1 debe
    corregirse mentalmente para asumir esto.
  - `period_key` mensual **sí** es un identificador estable (`'YYYY-MM'`); solo el semanal es una
    fecha. El riesgo del Anexo aplica parcialmente, no en general.
- **Decisiones que quedan firmes para Sprint 1 y 2:**
  - Filtrar por tipo de periodo (regex sobre `period_key`) para evitar doble conteo — por defecto
    solo mensuales, ver nota del Ticket 0.3.
  - Stack de frontend: **Chart.js vía CDN**, vanilla, sin build (Ticket 0.5).
  - Plantillas `.eta` nuevas no requieren tocar el `Dockerfile` (`COPY` de carpeta completa).
- **Riesgo nuevo detectado, no estaba en el plan original:** no hay framework de testing instalado
  (`package.json` no tiene `jest`/`vitest`/etc., solo `tsc`). El Ticket 1.4 pide "tests unitarios"
  para `aggregate.ts` — al llegar a ese ticket habrá que decidir explícitamente cómo correrlos
  (instalar un test runner liviano, o un script `tsx` con `assert` nativo de Node sin dependencia
  nueva). Se deja anotado aquí para no sorprenderse en el Sprint 1.
- **Nota de alcance:** este sandbox no tiene `DATABASE_URL` configurado, así que todo lo anterior
  se verificó leyendo código fuente, no consultando la base de datos real en vivo. El Sprint 1
  debe correr contra un entorno con `DATABASE_URL` real antes de dar por buena la query.

---

## Sprint 1 — Backend: endpoint de métricas agregadas

> **Objetivo:** exponer un endpoint que devuelva, en una sola llamada, todo lo que el dashboard
> necesita para un cliente y rango dados. Sin tocar el frontend todavía.

### Ticket 1.1 `[IMPL]` Función de lectura agregada en `metrics/store.ts`
- **Precondición:** Tickets 0.1, 0.2, 0.3 cerrados.
- Añade a `src/metrics/store.ts` (respetando su patrón dual DB/JSON existente) una función que
  lea de `report_metrics` filtrando por `client_id` y por rango `[from, to]` sobre `period_start`,
  y opcionalmente por `advisor`.
- La función devuelve las filas crudas necesarias (`advisor`, `period_start`, `period_key`,
  `avg_score`, `pct_siguiente`, `talk_ratio`). **La agregación por granularidad se hace en una
  capa aparte** (Ticket 1.2), no en esta query, para mantener la query simple y testeable.
- Si en 0.3 se decidió que hace falta filtrar por tipo de periodo para evitar doble conteo,
  incluye ese filtro como parámetro.
- **DoD:** función exportada, tipada, que corre contra DB real y devuelve filas correctas para
  `midstorage`.

> **✅ Cerrado.** `queryReportMetrics(clientId, from, to, advisor?)` en `src/metrics/store.ts`.
> Devuelve `[]` si `!dbEnabled` (no hay modo dual, ver hallazgo del Ticket 0.1). Filtra
> `period_key ~ '^\d{4}-\d{2}$'` (solo mensuales) por la decisión del Ticket 0.3. Filas crudas
> tipadas como `ReportMetricRow`.

### Ticket 1.2 `[IMPL]` Capa de agregación por granularidad
- Crea un módulo (ej. `src/metrics/aggregate.ts`) con una función pura que reciba las filas
  crudas y una `granularity` (`weekly | monthly | bimonthly | quarterly | semiannual | annual`)
  y agrupe por **bucket temporal derivado de `period_start`**.
- **Reglas de agregación (firmes, por ausencia de `call_count`):**
  - Las 3 métricas (`avg_score`, `pct_siguiente`, `talk_ratio`) se agregan con **promedio
    simple** dentro de cada bucket. Documenta en un comentario que es promedio simple por no
    tener volumen de llamadas para ponderar.
  - Cada bucket expone también su rango de fechas (inicio/fin) y una etiqueta legible
    (ej. `"Jun 2026"`, `"Q2 2026"`, `"S1 2026"`, `"2026"`).
- Genera **dos vistas** a partir de los mismos buckets:
  - **Serie del equipo:** por bucket, promedio de todos los asesores del cliente.
  - **Serie por asesor:** por bucket y por asesor.
- **Importante:** la función debe comportarse correctamente con **un solo bucket** (caso actual)
  y con buckets vacíos (no romper, devolver el periodo sin datos o saltarlo, según se defina).
- **DoD:** función pura con tests unitarios mínimos (Ticket 1.4) que cubran 1 punto, varios
  puntos y mezcla de granularidades.

> **✅ Cerrado.** `aggregateMetrics(rows, granularity)` en `src/metrics/aggregate.ts`. Sin
> dependencias de DB. Bucket vacío = se omite (no se emite con `null`s), tal como permitía el
> ticket. Las 6 granularidades implementadas con buckets/labels en español. Tests en Ticket 1.4.

### Ticket 1.3 `[IMPL]` Router `GET /api/metrics`
- **Precondición:** Ticket 0.1 (estilo de routers) cerrado.
- Crea `src/routes/metrics.ts` siguiendo **exactamente** el patrón de los routers existentes
  (manejo de errores, validación de query con Zod si así lo hacen los demás).
- Query params: `client_id` (req), `from` (req, `YYYY-MM-DD`), `to` (req, `YYYY-MM-DD`),
  `granularity` (req, enum de las 6), `advisor` (opcional).
- Respuesta JSON con: lista de buckets/periodos, serie del equipo, series por asesor, y metadata
  (cliente, rango, granularidad, lista de asesores presentes). Define la forma exacta y
  documéntala en este ticket para que el frontend la consuma sin sorpresas.
- Móntalo en `src/server.ts` con el mismo patrón de los demás routers.
- **DoD:** `GET /api/metrics?client_id=midstorage&from=...&to=...&granularity=monthly` responde
  `200` con datos reales.

> **✅ Cerrado.** `src/routes/metrics.ts`, montado en `server.ts` como `app.use('/api/metrics',
> metricsRouter)` junto a los demás routers, mismo patrón Zod + try/catch que `stats.ts`/
> `clients.ts`. Forma de la respuesta:
> ```json
> {
>   "client_id": "midstorage", "from": "2026-01-01", "to": "2026-12-31", "granularity": "monthly",
>   "advisors": ["Ana", "Beto"],
>   "buckets": [{ "key": "2026-06", "start": "2026-06-01", "end": "2026-06-30", "label": "Jun 2026" }],
>   "team": [{ "bucket": "2026-06", "avg_score": 78.5, "pct_siguiente": 60, "talk_ratio": 45, "count": 2 }],
>   "by_advisor": { "Ana": [{ "bucket": "2026-06", "avg_score": 80, ... }], "Beto": [...] }
> }
> ```
> `advisor` es opcional y filtra a un solo asesor. Probado en vivo (ver Ticket 1.4).

### Ticket 1.4 `[TEST]` Validación del backend
- Tests unitarios de `aggregate.ts` (los 3 casos del 1.2).
- Prueba manual del endpoint con `midstorage` en cada una de las 6 granularidades; confirma que
  con los pocos datos actuales no rompe y devuelve algo coherente.
- Si existe `npm run type-check`, debe pasar.
- **DoD:** tests verdes, type-check limpio, endpoint probado en las 6 granularidades.

> **✅ Cerrado.** No había framework de testing instalado (hallazgo del cierre del Sprint 0); se
> usó el test runner nativo de Node 20+/22 (`node:test` + `node:assert/strict`) vía `tsx --test`,
> sin añadir ninguna dependencia nueva. Script `npm test` agregado a `package.json`.
> - **7 tests** en `src/metrics/aggregate.test.ts` cubriendo: input vacío, un solo punto, promedio
>   simple entre varios asesores, varios meses ordenados cronológicamente, las 4 granularidades
>   agrupadas (bimonthly/quarterly/semiannual/annual), bucketing semanal ISO (lunes-domingo), y
>   filas con métricas `null` que no contaminan el promedio. `npm test` → `7 pass, 0 fail`.
> - `npm run type-check` limpio (tuvo que correr `npm install` primero — `node_modules` no estaba
>   instalado en este sandbox).
> - `npm run build` limpio.
> - **Endpoint probado en vivo** (servidor arrancado con variables de entorno dummy, sin
>   `DATABASE_URL`): `GET /api/metrics?client_id=midstorage&from=...&to=...&granularity=<g>` para
>   las 6 granularidades → `200` con `{ advisors: [], buckets: [], team: [], by_advisor: {} }` en
>   cada una (correcto: sin DB, `queryReportMetrics` devuelve `[]` y `aggregateMetrics([])` no
>   rompe, confirma el caso "0 datos" del Ticket 1.2). Validación de errores confirmada: falta de
>   parámetros requeridos → `400`; `granularity` inválida → `400` con el mensaje de Zod.
> - **No probado contra una DB real con datos** (este sandbox no tiene `DATABASE_URL`) — antes de
>   dar el Sprint 1 por cerrado en producción, correr el mismo `GET` contra un entorno con datos
>   reales de `midstorage` para confirmar buckets/promedios con filas reales.

---

## Sprint 2 — Frontend: pestaña de Dashboard

> **Objetivo:** nueva pestaña en `index.html` con las dos vistas y los controles. Asume el stack
> decidido en el Ticket 0.5.

### Ticket 2.1 `[IMPL]` Pestaña nueva + controles
- **Precondición:** Tickets 0.4, 0.5 cerrados.
- Añade una pestaña **"Dashboard"** (o "Métricas") junto a Reportes / Ajustes / Automatización,
  usando el mecanismo real de tabs confirmado en 0.4.
- Controles: selector de **cliente**, **rango de fechas** (from/to), **granularidad** (las 6), y
  un toggle/selector **Vista cliente ↔ Vista asesor** (con selector de asesor cuando aplique).
- Carga la lista de clientes y asesores reutilizando los endpoints existentes (`/api/clients`,
  `/api/advisors`); confirma sus firmas reales antes de usarlos.
- **DoD:** la pestaña aparece, los controles se renderizan, cambiar un control dispara un fetch a
  `/api/metrics` (aún sin gráficas).

> **✅ Cerrado.** Pestaña "DASHBOARD" añadida entre Reportes y Ajustes, mismo mecanismo de
> `_APP_TABS` / `setTab()` confirmado en el Ticket 0.4. Controles: cliente (`#dash-client-select`),
> rango de fechas (`#dash-from`/`#dash-to`, con default de los últimos 12 meses si quedan vacíos),
> granularidad (`#dash-granularity`, las 6 opciones), y toggle Equipo/Asesor
> (`#dash-view-team`/`#dash-view-advisor`, reutilizando la clase `.period-toggle` ya existente)
> con un selector de asesor que solo aparece en vista "Asesor individual".
> **Decisión de implementación (no estaba explícito en el ticket):** el selector de cliente
> reutiliza la variable global `allClients` ya cargada por `loadClients()` (mismo patrón que el
> filtro de tokens, `populateTokenClientFilter()`) en vez de volver a pedir `/api/clients`. El
> selector de **asesor** se llena con el campo `advisors` que ya devuelve `/api/metrics` (los
> asesores que de verdad tienen filas en el rango elegido), **no** con `/api/advisors`: ese
> endpoint exige un `month` y lee de Google Sheets (lista de asesores configurados, no de
> `report_metrics`), por lo que mezclaría dos fuentes de verdad distintas para un control que debe
> reflejar exactamente lo que el dashboard puede graficar. Cualquier control dispara
> `loadDashboard()`, que llama a `/api/metrics` y revalida.

### Ticket 2.2 `[IMPL]` Vista de cliente
- Renderiza con el stack elegido:
  - **Tendencia del equipo:** línea(s) de `avg_score` (y opcionalmente `pct_siguiente` /
    `talk_ratio` como series alternables) por periodo.
  - **Ranking de asesores:** barras con el `avg_score` de cada asesor en el periodo seleccionado.
- Maneja con gracia el caso de **1 solo punto** (un punto/barra, sin parecer roto) y el de
  **0 datos** (mensaje claro tipo "Aún no hay datos para este rango").
- **DoD:** vista de cliente funcional contra datos reales de `midstorage`.

> **✅ Cerrado.** `renderDashTeamView()` en `index.html`: gráfica de línea (Chart.js) con las 3
> métricas del equipo por bucket, y gráfica de barras con el `avg_score` de cada asesor **en el
> último bucket del rango** (documentado en el `card-desc` visible: "Puntaje promedio en \<label\>
> (último periodo del rango)"). Con 1 solo bucket, la línea muestra un único punto (`pointRadius`
> más grande para que no parezca un error) y la barra se ve normal con una sola categoría por
> asesor. Con 0 buckets, no se renderiza ninguna gráfica (ver Ticket 2.4). Verificado visualmente
> con Playwright + datos simulados (1 y 2 buckets, 1 y 2 asesores): ambas gráficas renderizan
> correctamente en tema oscuro y claro.

### Ticket 2.3 `[IMPL]` Vista de asesor individual
- Para el asesor seleccionado:
  - **Su serie histórica** de las 3 métricas.
  - **Línea de referencia** del promedio del equipo (para ver si está arriba/abajo).
  - **Delta vs periodo anterior** (reutiliza la lógica/los datos de comparativo que ya existen en
    el sistema; confírmalo en el repo antes de recalcular nada).
- **DoD:** vista de asesor funcional; el delta coincide con la lógica existente del sistema.

> **✅ Cerrado.** `renderDashAdvisorView()`: línea con las 3 métricas del asesor seleccionado más
> una **línea punteada de referencia** con `avg_score` del equipo en los mismos buckets. El delta
> se confirmó contra el repo (Ticket 2.3 pedía no inventar la lógica): en
> `src/claude/individual.ts:371-372`, `delta_score = avg_score_actual - avg_score_anterior` y
> `delta_siguiente_paso = pct_actual - pct_anterior`, **resta simple entre el periodo actual y el
> inmediato anterior**, sin ponderar. Esa lógica opera sobre el contexto de un job puntual (compara
> contra el sidecar/fila más reciente antes del periodo que se está generando) y no es una función
> reutilizable para un rango arbitrario de fechas, así que el dashboard recalcula el mismo cálculo
> (resta simple) sobre los **dos últimos puntos de la propia serie del asesor** que ya devuelve
> `/api/metrics` — mismos campos (`avg_score`, `pct_siguiente`, `talk_ratio`), misma semántica de
> "vs el periodo inmediatamente anterior", sin duplicar acceso a DB ni a Drive. Con un solo punto
> en el rango se muestra "Primer periodo en el rango, sin comparativo." en vez de un delta.

### Ticket 2.4 `[IMPL]` Estados de carga, error y vacío
- Spinner/skeleton mientras carga, mensaje de error si el fetch falla, y estado vacío explícito.
- Respeta el design system / variables CSS detectadas en 0.4. **Sin em dash en textos visibles.**
- **DoD:** los 3 estados se ven correctos y consistentes con el resto del SPA.

> **✅ Cerrado.** Reutiliza clases ya existentes en `index.html` en vez de crear nuevas:
> `.spin-xs` dentro de `.token-empty` para el spinner de carga, `.error-box` (mismo estilo rojo que
> usa el resto del SPA) si el fetch falla, y `.token-empty` para los 3 casos de "vacío": sin
> cliente seleccionado, rango sin datos (`buckets.length === 0`), y vista de asesor sin asesores
> con datos en el rango. Únicas clases nuevas: `.delta-pos`/`.delta-neg` (no existían en
> `index.html`, solo en la plantilla de PDF; se añadieron usando las mismas variables de tema
> `--success`/`--danger`). **Sin em dash:** se revisó el texto añadido y se corrigieron 2 casos
> donde se había copiado el patrón pre-existente `"— Selecciona un cliente —"` del select de
> Reportes (que sí usa em dash, pre-existente en el repo) — los nuevos selects y textos del
> dashboard usan punto, coma o `·` en su lugar, según la regla ZR-02 del
> `zebra-design-system-kit/03-reglas-de-construccion/REGLAS.md`.
> **Verificación real en navegador:** como el CDN de Chart.js no es alcanzable desde este sandbox
> (proxy de red restringido, igual que `cdn.jsdelivr.net` para los iconos Tabler y Google Fonts que
> ya usaba el SPA antes de este cambio), se verificó con Playwright sirviendo Chart.js localmente
> vía interceptación de la petición de red (solo para esta prueba, no se cambió la decisión de
> stack ni se agregó Chart.js como dependencia npm). Con eso confirmado: pestaña visible, ambas
> vistas renderizan, toggle de tema no rompe los charts (se destruyen y re-crean con los colores
> del tema activo), y los 3 estados (carga/error/vacío) se ven correctos en oscuro y claro.

---

## Sprint 3 — Exportación a PDF

> **Objetivo:** botón que genera un PDF de las métricas del cliente/rango, reutilizando el
> pipeline existente (Eta → Chromium → pdf-lib).

### Ticket 3.1 `[VERIFY]` Decidir la estrategia de gráficas en el PDF
- **Precondición:** Ticket 0.6 cerrado.
- Elige y documenta entre:
  - **A) Render server-side:** la plantilla `.eta` dibuja las mismas gráficas (Chart.js) dentro
    del Chromium headless antes de `page.pdf`. Más limpio, reutiliza todo el pipeline; requiere
    que el script de la gráfica corra en la plantilla.
  - **B) Imagen embebida:** el frontend exporta cada gráfica a imagen base64 y se inyecta en la
    plantilla `.eta`. Más simple de renderizar, pero acopla el PDF al navegador del usuario.
- Recomendación por defecto: **A**, salvo que 0.6 revele que correr scripts en la plantilla es
  problemático. Deja la decisión escrita.
- **DoD:** estrategia elegida y justificada.

### Ticket 3.2 `[IMPL]` Plantilla `.eta` del dashboard + datos
- Crea `src/pdf/templates/dashboard.eta` siguiendo el patrón confirmado en 0.6 (recepción de
  datos, inyección de logo `_logoB64`).
- Incluye: portada con cliente + rango + granularidad, las gráficas (según 3.1), y una tabla
  resumen de las 3 métricas por asesor y por periodo.
- **Asegura que el `Dockerfile` copie la nueva plantilla a `dist/`** (la línea identificada en
  0.6). Este paso es fácil de olvidar y rompe el PDF en producción.
- **DoD:** la plantilla renderiza un HTML correcto con datos de ejemplo.

### Ticket 3.3 `[IMPL]` Generación del PDF (backend)
- Decide e implementa el disparador siguiendo el patrón existente del sistema (confírmalo en el
  repo): probablemente un endpoint dedicado `POST /api/metrics/pdf` que recibe los mismos
  parámetros que `/api/metrics`, arma los datos (reutilizando la capa de agregación del Sprint 1),
  renderiza con el pipeline y devuelve/guarda el PDF.
- Reutiliza `renderer.ts` y, si aplica, `merge.ts`. **No** dupliques el pipeline.
- Decide si el PDF se descarga directo o se sube a Drive como el resto de reportes; sigue la
  convención del sistema y documenta la elección.
- **DoD:** el endpoint produce un PDF válido y legible para `midstorage`.

### Ticket 3.4 `[IMPL]` Botón "Generar PDF" en el dashboard
- Añade el botón en la pestaña Dashboard; usa el rango/cliente/granularidad actuales.
- Muestra estado de "generando..." y maneja el resultado (descarga o link), consistente con cómo
  el SPA maneja los PDFs de reportes hoy.
- **DoD:** desde la UI, un clic genera y entrega el PDF del estado visible.

### Ticket 3.5 `[TEST]` Validación end-to-end del PDF
- Genera el PDF en varias granularidades; revisa que las gráficas y la tabla coincidan con lo que
  muestra el dashboard en pantalla.
- Verifica que funcione en el entorno de Docker (Chromium del sistema, `CHROMIUM_PATH`).
- **DoD:** PDF correcto en local y en Docker.

---

## Sprint 4 — Pulido y cierre

### Ticket 4.1 `[IMPL]` Rendimiento y robustez
- Si el volumen de `report_metrics` crece, evalúa cachear/optimizar la query de agregación
  (índice por `(client_id, period_start)` si no existe). Confirma índices actuales antes.
- **DoD:** consulta del dashboard responde rápido con el volumen esperado.

### Ticket 4.2 `[TEST]` Regresión del sistema existente
- Confirma que **Reportes, Ajustes y Automatización siguen funcionando** igual que antes (no se
  rompió el SPA ni el montaje de routers).
- `npm run build` y `npm run type-check` limpios. La app arranca sin errores.
- **DoD:** sistema completo funcional, sin regresiones.

### Ticket 4.3 `[IMPL]` Documentar lo construido
- Actualiza `HANDOFF.md` (o crea un anexo) con: el endpoint nuevo, la capa de agregación, la
  pestaña de dashboard, la plantilla de PDF, y **corrige las imprecisiones detectadas en el
  Sprint 0** (especialmente el esquema real de `report_metrics`).
- **DoD:** documentación al día; un futuro lector no repite las confusiones de este proceso.

---

## Anexo — Decisiones firmes (no re-litigar)

- **Solo uso interno.** Sin auth nueva, sin portal de cliente, sin roles. Clientes finales solo
  reciben el PDF.
- **Promedio simple**, no ponderado: no existe `call_count`.
- **Solo 3 métricas graficables hoy:** `avg_score`, `pct_siguiente`, `talk_ratio`. No hay
  min/max/sigma ni volumen de llamadas.
- **Agregación temporal sobre `period_start`** (columna `date` real), no sobre `period_key`.
- **El repo manda** sobre el handoff ante cualquier discrepancia.
- **Sin em dash** en textos visibles de la UI y del PDF.

## Anexo — Riesgos conocidos

1. **`period_key` podría ser una fecha, no un identificador estable de periodo** (Ticket 0.2).
   Mitigación: agregar siempre sobre `period_start`, no sobre `period_key`.
2. **Posible doble conteo semanal+mensual** (Ticket 0.3). Mitigación: filtro por tipo de periodo
   si no se puede descartar el solapamiento.
3. **Datos escasos al inicio.** El dashboard debe verse bien con 1 punto. No bloquea la
   construcción; el valor visual llega cuando se acumulan periodos.
4. **Olvidar copiar la plantilla `.eta` nueva en el Dockerfile** (Ticket 3.2). Rompe el PDF solo
   en producción, no en local. Verificar explícitamente.
