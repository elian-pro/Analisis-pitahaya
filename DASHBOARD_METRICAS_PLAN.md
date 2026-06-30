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

### Ticket 0.3 `[VERIFY]` Evaluar el riesgo de doble conteo (semanal + mensual)
- Con lo aprendido en 0.2, determina: **¿puede un mismo cliente tener, en el mismo rango de
  fechas, filas semanales Y mensuales que cubran las mismas llamadas?**
- Si la respuesta es **no** (cada cliente usa una sola granularidad, o las filas no se solapan),
  la agregación es trivial: agrupar por `period_start`.
- Si la respuesta es **sí o no se puede descartar**, el endpoint de agregación debe poder
  **filtrar por un tipo de periodo** para no sumar dos veces. Anota la estrategia elegida.
- **DoD:** decisión documentada (trivial / requiere filtro), justificada con los datos reales.

### Ticket 0.4 `[VERIFY]` Mapear el frontend (`index.html`)
- Abre `index.html`. Confirma:
  - Cómo funciona el sistema de pestañas (`setTab` u otro). Cómo se añade una pestaña nueva sin
    romper las existentes (**Reportes, Ajustes, Automatización**).
  - Cómo hace `fetch` a la API y cómo renderiza resultados (patrón real, no asumido).
  - Si ya hay **alguna librería cargada vía CDN** (para decidir el stack de gráficas en 0.5).
  - Cómo se cargan estilos y si hay un design system / variables CSS a respetar.
- **DoD:** nota con el mecanismo real de tabs y de fetch, y lista de librerías ya presentes.

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

### Ticket 0.6 `[VERIFY]` Mapear el pipeline de PDF
- Abre `src/pdf/renderer.ts`, `src/pdf/merge.ts` y `src/pdf/templates/*.eta`. Confirma:
  - La firma real de la función que convierte HTML/plantilla → PDF (singleton de browser, args
    de Chromium, `CHROMIUM_PATH`).
  - Cómo una plantilla `.eta` recibe datos y cómo se inyecta el logo (`_logoB64`).
  - Cómo el `Dockerfile` copia las plantillas a `dist/` (para no olvidar copiar la nueva).
- **DoD:** nota con la firma del renderer, el patrón de plantilla y la línea del Dockerfile que
  copia plantillas.

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

### Ticket 1.4 `[TEST]` Validación del backend
- Tests unitarios de `aggregate.ts` (los 3 casos del 1.2).
- Prueba manual del endpoint con `midstorage` en cada una de las 6 granularidades; confirma que
  con los pocos datos actuales no rompe y devuelve algo coherente.
- Si existe `npm run type-check`, debe pasar.
- **DoD:** tests verdes, type-check limpio, endpoint probado en las 6 granularidades.

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

### Ticket 2.2 `[IMPL]` Vista de cliente
- Renderiza con el stack elegido:
  - **Tendencia del equipo:** línea(s) de `avg_score` (y opcionalmente `pct_siguiente` /
    `talk_ratio` como series alternables) por periodo.
  - **Ranking de asesores:** barras con el `avg_score` de cada asesor en el periodo seleccionado.
- Maneja con gracia el caso de **1 solo punto** (un punto/barra, sin parecer roto) y el de
  **0 datos** (mensaje claro tipo "Aún no hay datos para este rango").
- **DoD:** vista de cliente funcional contra datos reales de `midstorage`.

### Ticket 2.3 `[IMPL]` Vista de asesor individual
- Para el asesor seleccionado:
  - **Su serie histórica** de las 3 métricas.
  - **Línea de referencia** del promedio del equipo (para ver si está arriba/abajo).
  - **Delta vs periodo anterior** (reutiliza la lógica/los datos de comparativo que ya existen en
    el sistema; confírmalo en el repo antes de recalcular nada).
- **DoD:** vista de asesor funcional; el delta coincide con la lógica existente del sistema.

### Ticket 2.4 `[IMPL]` Estados de carga, error y vacío
- Spinner/skeleton mientras carga, mensaje de error si el fetch falla, y estado vacío explícito.
- Respeta el design system / variables CSS detectadas en 0.4. **Sin em dash en textos visibles.**
- **DoD:** los 3 estados se ven correctos y consistentes con el resto del SPA.

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
