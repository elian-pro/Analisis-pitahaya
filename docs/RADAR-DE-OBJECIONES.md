# Radar de Objeciones — guía completa de la pestaña

Documento de referencia para rediseñar la pestaña **RADAR** de la app. Explica
qué es el reporte, qué produce, de dónde salen los datos, qué hace cada campo y
qué contratos hay que respetar para que un rediseño no rompa el backend.

Todo lo que se describe aquí sale del código: la pestaña vive en `index.html`
(marcado ~L696-790, lógica ~L3049-3250), y el motor en `src/radar/`,
`src/claude/radar.ts`, `src/ingest/radarMarkdown.ts` y `src/routes/report.ts`.

---

## 1. Qué es el Radar de Objeciones

Es un **reporte PDF por cliente y por periodo** (no por asesor) que responde a
tres preguntas:

1. **Qué preguntan los prospectos** en las llamadas del periodo, agrupado por
   intención semántica aunque cambie el fraseo.
2. **Cómo responde el equipo comercial** hoy a cada una de esas preguntas, y si
   esa respuesta está `bien`, `mejorable` o es `critico`.
3. **Qué cambió respecto al periodo anterior** y qué hacer al respecto.

La unidad de análisis es el **cliente completo**, no el asesor: el reporte habla
del equipo de forma agregada y el prompt por defecto prohíbe expresamente
mencionar asesores por su nombre, porque es un PDF que se comparte con el dueño
del negocio.

Se diferencia del otro reporte del sistema, el **Análisis de Llamadas**, en tres
cosas: unidad (cliente vs. asesor), carpeta de Drive (`radar_folder_id` vs.
`folder_id`) y en que el Radar mantiene memoria entre periodos mediante un
archivo *sidecar* (§5).

---

## 2. Qué produce

Cada ejecución genera dos archivos:

| Archivo | Qué es | Dónde va |
|---|---|---|
| **PDF del reporte** | El entregable para el cliente | Carpeta de Radar en Drive (`radar_folder_id`) + descarga en el navegador |
| **`radar-YYYY-MM.json`** (sidecar) | Memoria del periodo: taxonomía, resumen y recomendaciones | Subcarpeta **`_Sidecars`** dentro de la carpeta de Radar, igual que en Análisis de Llamadas |

### Secciones del PDF

Plantilla: `src/pdf/templates/radar.eta`. En orden:

1. **Portada / cabecera (membrete)** — el tipo de reporte en mono, blanco pleno
   y 11 pt (`.tipo-line`) sobre el nombre del cliente, más periodo, fecha de
   generación y los tres contadores: llamadas totales, analizadas y excluidas.
   Esa línea es lo único que distingue este membrete del de Análisis de
   Llamadas, que es idéntico en todo lo demás: si se toca, los dos reportes
   vuelven a confundirse de un vistazo.
2. **Resumen ejecutivo** — narrativa de la IA.
3. **Preguntas más frecuentes** — tabla: pregunta, frecuencia, nº de llamadas,
   evaluación.
4. **Detalle por pregunta** — por cada una: `Respuesta típica ·`,
   `Observación ·` y, si existe, una cita textual corta.
5. **Patrones detectados** — de los **prospectos** (perfil, objeciones
   dominantes) y del **equipo comercial** (fortalezas / áreas de mejora).
6. **Línea base** *(primer periodo)* o **Comparativo vs `<periodo anterior>`**
   *(a partir del segundo)* — subieron / bajaron / sin cambios / nuevas / se
   fueron, más la narrativa comparativa de la IA.
7. **Recomendaciones** — máximo 6, priorizadas alta / media / baja.

### Nombre del archivo en Drive

Se construye con `radarFilename()` de `src/google/drive.ts`, que **no** pasa por
`reportFilename()` (ese es el del Análisis de Llamadas):

- Mensual: `Sofia Fractional | Radar de Objeciones | Junio 2026.pdf`
- Quincenal: `Sofia Fractional | Radar de Objeciones | 1ª quincena · Junio 2026.pdf`

La etiqueta del periodo es lo que evita que los dos cortes de un mismo mes se
pisen en la carpeta.

La descarga en el navegador usa otro nombre, más simple:
`Radar_<cliente_saneado>_<YYYY-MM>.pdf`.

---

## 3. De dónde salen los datos

Hay **dos flujos de entrada** que convergen en el mismo motor
(`processRadarReport`, en `src/radar/process.ts`). La pestaña expone los dos,
uno por tarjeta.

### Flujo A — desde un cliente de la base

Cadena completa (`src/radar/dbFlow.ts`):

```
Hoja de Google del cliente
  → filtro por periodo (mes completo, o rango de fechas si es quincenal)
  → filtro por roster: solo llamadas de los asesores registrados del cliente
  → filtro por duración mínima (default 200 s)
  → recorte de transcripción (default 8000 chars) y frases excluidas
  → + sidecar del periodo anterior (si existe)
  → Claude (tool use forzado)
  → reconciliación de taxonomía + comparativo determinista
  → PDF (Playwright) + sidecar
  → Drive
```

Lo que aporta cada pieza de la configuración del cliente:

| Campo del cliente | Para qué lo usa el Radar |
|---|---|
| `spreadsheet_id`, `data_sheet_name` | La hoja y pestaña de donde lee las llamadas |
| `col_fecha`, `col_asesor`, `col_transcripcion`, `col_duracion`, … | Mapeo de columnas de esa hoja |
| **Roster de asesores** (Ajustes → asesores) | Define qué filas de la hoja pertenecen a este cliente |
| `excluded_phrases` | Descarta llamadas cuya transcripción contenga alguna |
| `radar_min_duration_seconds` | Umbral de duración (default **200 s**) |
| `radar_transcripcion_max_chars` | Recorte por llamada (default **8000**) |
| `prompt_radar` | System prompt; si está vacío se usa `DEFAULT_RADAR_PROMPT` |
| `radar_folder_id` | Carpeta de entrega del PDF. **Obligatoria** en este flujo |
| `radar_sidecar_folder_id` | Carpeta base del sidecar; si falta (lo normal, ya no se expone en el formulario) se usa la de Radar. El JSON acaba en su subcarpeta `_Sidecars` |

Dos reglas del filtrado que importan para la UI:

- **El roster es obligatorio.** Sin asesores registrados el backend aborta con un
  error explícito: sin él no puede saber qué llamadas de una hoja compartida son
  de este cliente, y subiría a la carpeta de A un PDF hecho con llamadas de B.
- **Una llamada sin duración legible (0) se incluye**, no se descarta. El
  contador `total_calls` que sale en el PDF es el del **equipo del cliente**, no
  el de la hoja entera.

### Flujo B — desde un archivo `.md`

`src/ingest/radarMarkdown.ts`. Sirve para clientes que aún no están en la base o
para transcripciones que no viven en una hoja. Formato esperado:

```markdown
---
client_name: Sofia Fractional
period_label: Junio 2026
date_from: 2026-06-01
date_to: 2026-06-30
contexto_negocio: >
  Venta de residencias fraccionales a inversionistas...
---

LLAMADAS:

[1] Fecha: 2026-06-03 | Asesor: Ana Ruiz | Duración: 7:42
(transcripción…)
---
[2] Fecha: 2026-06-04 | Asesor: Luis Paz | Duración: 5:10
(transcripción…)
```

- El frontmatter es **opcional**; el marcador `LLAMADAS:` es **obligatorio**.
- Los bloques se separan con una línea `---` sola.
- Se aplican **los mismos filtros** que en el flujo A (duración, frases
  excluidas, recorte). Si hay `client_id`, toma sus umbrales; si no, los
  defaults.
- Los índices `[n]` se **renumeran** de forma determinista sobre las llamadas
  que sobreviven al filtro; si los del archivo no eran consecutivos, sale un
  warning.
- Prioridad de los metadatos: **overrides del formulario > frontmatter >
  default** (mes en curso).

---

## 4. La pestaña, campo por campo

Nav: `RADAR`. Un solo panel (`#tab-radar`) con dos tarjetas. Al entrar en la
pestaña se dispara `populateRadarSelectors()`, que carga `GET /api/clients` y
llena los dos selectores de cliente.

### Tarjeta 1 — "Generar desde un cliente"

| Campo | ID | Qué hace |
|---|---|---|
| **Cliente** | `#radar-client-select` | Todos los clientes de la base. Al cambiar dispara `onRadarClientChange()`, que muestra la carpeta de Drive o el aviso de que falta, y actualiza la nota con el umbral de duración **de ese cliente** |
| **Mes de reporte** | `#radar-month-select` | Últimos **12 meses**, valor `YYYY-MM`, etiqueta en español (`Junio 2026`). Arranca en el **mes anterior**, que es el periodo que de verdad se reporta |
| **Corte** | `#radar-half-full` · `#radar-half-q1` · `#radar-half-q2` | Mes completo (default) o una de las dos quincenas de ese mes. El estado vive en `_radarHalf` (`''` \| `'Q1'` \| `'Q2'`) y viaja al backend como `half` |
| **Generar Radar** | `#radar-gen-btn` | No genera: abre el modal de confirmación y lanza el pre-vuelo |

Debajo, tres elementos de estado mutuamente excluyentes:

- `#radar-drive-wrap` — bloque enlazado a la carpeta de Radar del cliente.
  Visible solo si el cliente tiene `radar_folder_id`.
- `#radar-drive-missing` — aviso rojo cuando falta. A diferencia de la pestaña
  Reportes, aquí **no se oculta en silencio**: sin carpeta no hay entrega.
- `#radar-client-status` — resultado o error de la última generación.

#### Modal de confirmación (`#radar-confirm-backdrop`)

Se abre antes de generar y hace un **pre-vuelo** contra
`GET /api/report/radar-preflight`. Muestra:

| Fila | ID | Contenido |
|---|---|---|
| Cliente | `#rconf-client` | Nombre elegido |
| Período | `#rconf-period` | Etiqueta del mes |
| Asesores registrados | `#rconf-advisors` | `N asesor(es)` o `Ninguno` |
| Badge periodo anterior | `#rconf-prev-badge` | ✅ hay sidecar previo → habrá comparativa · ⚠️ no hay → será línea base · ℹ️ no se pudo verificar |
| Badge carpeta | `#rconf-folder-badge` | 📁 configurada (con enlace) o falta |

Reglas de habilitación del botón `#rconf-ok-btn`:

- **Deshabilitado** si `advisor_count === 0` o `has_folder === false`. Son los
  dos casos en que el backend fallaría seguro.
- Si el pre-vuelo **falla por red**, el botón se **rehabilita**: el pre-vuelo es
  informativo, no una compuerta.
- Las respuestas viejas se descartan con un contador de secuencia
  (`_radarPreflightSeq`): si el usuario cambia de cliente rápido, no se pinta el
  resultado de la petición anterior.

Al confirmar, `confirmAndGenerateRadar()` llama al endpoint síncrono y espera
**~1 minuto** con el botón bloqueado y un spinner. No hay barra de progreso ni
polling: es una sola llamada a Claude.

### Tarjeta 2 — "Radar desde archivo (.md)"

| Campo | ID | Obligatorio | Qué hace |
|---|---|---|---|
| **Archivo .md** | `#radar-md-file` | Sí | Máx. **2 MB**, extensión `.md`, **UTF-8** estricto |
| **Cliente** | `#radar-upload-client` | No | Si se elige, aporta prompt, umbrales, frases excluidas y carpeta de Drive. `— Sin cliente —` usa los defaults |
| **Entrega** | `#radar-deliver` | Sí (default) | `download` · `drive` · `both`. Sin `client_id` el default es `download`; con cliente, `both` |
| **Nombre del cliente (override)** | `#radar-ov-name` | No | Gana sobre el frontmatter. Con `client_id`, **el nombre del cliente en base gana sobre ambos** |
| **Periodo (override)** | `#radar-ov-period` | No | Etiqueta legible, ej. `Junio 2026` |
| **Contexto del negocio (override)** | `#radar-ov-contexto` | No | Reemplaza `{contexto}` en el prompt: giro, tipo de llamada y objetivo |
| **Sidecar anterior (.json)** | `#radar-prev-sidecar` | No | Habilita el comparativo. Si no se puede leer, degrada a línea base con warning |
| **Generar desde archivo** | `#radar-upload-btn` | — | Envía todo como `multipart/form-data` |

Al terminar descarga **PDF y sidecar** (si aplica), enlaza el archivo en Drive
cuando lo hubo, y pinta los `warnings` del parseo en gris bajo el mensaje de
éxito.

Si se pide subir a Drive sin cliente, el destino es la carpeta de staging
`RADAR_UPLOAD_STAGING_FOLDER_ID` (variable de entorno). Si tampoco existe, se
degrada a descarga con warning.

### Campos relacionados que NO viven en esta pestaña

Se configuran en **Ajustes → Clientes** y condicionan todo lo anterior:

- **Paso 1 · Datos** → la carpeta de Radar (`radar_folder_id`), gestionada junto
  a la de análisis.
- **Paso 3 · Análisis → "Radar de Objeciones (opcional)"** → el toggle de
  activación, `prompt_radar`, `radar_min_duration_seconds` (placeholder 200) y
  `radar_transcripcion_max_chars` (placeholder 8000).
- **Automatización** → `report_kind: 'radar'` programa el Radar por su cuenta,
  con frecuencia `monthly`, `biweekly` (quincenal) o `once`.

---

## 5. Cómo funciona por dentro (lo que la UI debe reflejar)

### Reparto IA / código

Un principio de diseño que conviene no romper en un rediseño: **la IA no calcula
números**.

| Lo produce Claude | Lo calcula el código |
|---|---|
| Resumen ejecutivo, preguntas canónicas, respuesta típica, evaluación, observaciones, citas, patrones, recomendaciones y la narrativa comparativa | Contadores de llamadas, deltas de frecuencia, cambios de evaluación, nuevas / desaparecidas |

Claude responde con **tool use forzado** (`entregar_reporte_radar`), validado
contra Zod. Modelo `claude-sonnet-4-6`, `max_tokens` 16384, **3 reintentos**.
Además de Zod hay una validación anti-alucinación: `frecuencia` tiene que ser
igual al número de índices de llamada declarados, y todos los índices deben
existir. Si no cuadra, se reintenta.

### El sidecar y la taxonomía

El comparativo cruza periodos por `categoria_id`, un slug estable. Hay **dos
defensas** para que ese slug no se mueva:

1. El prompt inyecta la taxonomía del periodo anterior y obliga a reutilizar
   slugs.
2. `reconcileTaxonomy()` (`src/radar/compare.ts`) detecta por parecido léxico
   (Jaccard sobre palabras de contenido + Levenshtein, umbral **0.62**) cuando
   la IA inventó un slug nuevo para una pregunta que ya existía, y lo re-mapea.
   Sin esto, el comparativo se llenaría de falsas "nuevas" y "desaparecidas".

### Dónde vive el sidecar

`_Sidecars`, dentro de la carpeta de Radar. La subcarpeta se crea sola al subir
el primer sidecar (`ensureSidecarFolder`), no en el alta del cliente.

Los clientes anteriores a esa subcarpeta tienen sus JSON sueltos en la raíz de
la carpeta de Radar, así que:

- **Lectura** (`findRadarSidecar`): busca primero en `_Sidecars` y, si no está,
  en la raíz. Un cliente sin migrar nunca pierde su comparativo.
- **Escritura** (`uploadRadarSidecar`): antes de subir, arrastra a `_Sidecars`
  todos los `radar-*.json` que encuentre sueltos. Cada cliente se limpia solo
  en su siguiente reporte; no hay que mover nada a mano.

### Estados posibles del reporte

- **Primer periodo** (`is_first_period: true`): no hay sidecar previo → sección
  "Línea base", sin comparativo ni `analisis_comparativo`.
- **Con comparativo**: sidecar previo encontrado y legible.
- **Sidecar corrupto**: `parseRadarSidecar` devuelve `null` y degrada a primer
  periodo en vez de romper.

---

## 6. Contratos de la API

Todo lo que el frontend de esta pestaña consume.

### `GET /api/clients`
Lista completa de clientes. La pestaña usa `id`, `name` y `radar_folder_id`.

### `GET /api/report/radar-preflight?client_id=&month=YYYY-MM[&half=Q1|Q2]`
Informativo, nunca devuelve 500 por fallos de Drive. Con `half`, el periodo
anterior que busca es la **quincena** previa (Q1 ↔ Q2 del mes anterior), no el
mes previo.

```jsonc
{
  "client_name":   "Sofia Fractional",
  "has_folder":    true,
  "folder_url":    "https://drive.google.com/drive/folders/…",  // null si no hay
  "advisor_count": 7,
  "has_previous":  true,
  "period_key":    "2026-05",       // solo si has_previous
  "period_label":  "Mayo 2026",     // solo si has_previous
  "unknown":       false,           // true si no se pudo verificar
  "reason":        "…"              // solo si unknown
}
```
`400` si falta `client_id` o `month` no es `YYYY-MM`; `404` si el cliente no existe.

### `POST /api/report/radar`
Body: `{ "client_id": "...", "month": "YYYY-MM", "half": "Q1" }`. `half` es
opcional: sin él, el periodo es el mes completo; con él, esa quincena
(`fortnightFor()` en `src/radar/dbFlow.ts`). **Síncrono**, ~1 min.

```jsonc
{
  "reportData":    { /* RadarReportData completo */ },
  "driveUrl":      "https://drive.google.com/…",
  "pdfBase64":     "JVBERi0…",
  "input_tokens":  123456,
  "output_tokens": 7890
}
```
`400` si el cliente no tiene `radar_folder_id`; `404` si no existe; `500` con
`{ error }` legible para el usuario (roster vacío, sin llamadas en el periodo,
etc.).

### `POST /api/report/radar-upload`
`multipart/form-data`. Campos: `file` (requerido), `prev_sidecar`, `client_id`,
`client_name`, `period_label`, `date_from`, `date_to`, `contexto_negocio`,
`deliver`.

```jsonc
{
  "reportData":    { /* … */ },
  "warnings":      ["Los índices [n] del archivo no eran consecutivos; …"],
  "driveUrl":      "https://…",     // solo si se subió
  "pdfBase64":     "…",             // si deliver incluye descarga, o si no hubo Drive
  "sidecarBase64": "…",
  "input_tokens":  0,
  "output_tokens": 0
}
```
`400` sin archivo o extensión inválida · `422` no es UTF-8, falta `LLAMADAS:`, o
no quedaron llamadas tras el filtro · `500` fallo del motor.

---

## 7. Guía para un rediseño

### Lo que se puede cambiar libremente

Todo el marcado y el CSS de `#tab-radar`, la distribución de las dos tarjetas, el
modal de confirmación, la copia de los textos y los estados visuales. Nada del
backend depende del layout.

### Lo que hay que preservar

**IDs que la lógica lee o escribe por `getElementById`.** Si se renombra alguno,
hay que actualizar `index.html` en los puntos correspondientes:

```
#radar-client-select  #radar-month-select   #radar-gen-btn
#radar-half-full      #radar-half-q1        #radar-half-q2
#radar-drive-wrap     #radar-drive-link     #radar-drive-client
#radar-drive-missing  #radar-client-status  #radar-source-note
#radar-md-file        #radar-upload-client  #radar-deliver
#radar-ov-name        #radar-ov-period      #radar-ov-contexto
#radar-prev-sidecar   #radar-upload-btn     #radar-upload-status
#radar-confirm-backdrop  #rconf-client  #rconf-period  #rconf-advisors
#rconf-prev-badge     #rconf-folder-badge   #rconf-ok-btn
```

Los badges esperan dentro un `.conf-prev-icon` y un `.conf-prev-text`
(`setRadarBadge()` los busca por clase). Los `<input type="file">` usan los
helpers compartidos `_fpOpen` / `_fpUpdate` / `_fpClear`, que asumen la
estructura `.file-picker` con `.file-picker-name`.

**Funciones que no deben perder su nombre** mientras los `onclick` inline sigan
existiendo: `onRadarClientChange`, `onRadarPeriodChange`, `setRadarHalf`,
`generateRadarFromClient`, `confirmAndGenerateRadar`, `closeRadarConfirm`,
`uploadRadarFile`, `populateRadarSelectors`.

**Comportamientos que son requisitos, no decoración:**

1. El botón de generar **no debe disparar directamente**: el modal de
   confirmación existe porque la operación cuesta ~1 minuto y tokens de API.
2. El botón de confirmar debe seguir **bloqueado sin roster o sin carpeta**, y
   desbloquearse si el pre-vuelo falla por red.
3. El aviso de carpeta faltante debe seguir siendo **visible y explicativo**, no
   un estado silencioso.
4. Mientras se genera, el botón se bloquea: no puede haber dos ejecuciones
   simultáneas del mismo Radar.
5. Los `warnings` del flujo por archivo deben mostrarse: son la única señal de
   que el parseo tuvo que corregir algo.

### Deudas conocidas

- El flujo A **no muestra los contadores** del resultado (llamadas analizadas /
  excluidas) aunque `reportData` los trae; solo dice "generado y descargado".
- No hay **historial**: no se puede ver qué Radares se generaron ya sin abrir
  Drive.
- El modal de confirmación todavía usa emojis (⚠️ 📁 ✅) en los badges, que el
  DS pide sustituir por iconos monolínea.
