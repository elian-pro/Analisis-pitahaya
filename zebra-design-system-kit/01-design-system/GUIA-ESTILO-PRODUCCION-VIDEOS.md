# Guía de Estilo de Producción de Vídeos

> Página interna del sitio ZEBRA. Herramienta-wizard para definir, junto al cliente,
> todas las variables de **producción y postproducción** de un video **antes de grabar**,
> y generar una guía de estilo imprimible/aprobable.

## Dónde vive

- **Archivo:** [`public/guia-estilo-produccion-videos/index.html`](public/guia-estilo-produccion-videos/index.html)
- **URL (dev y producción):** `/guia-estilo-produccion-videos/`
  (Astro sirve `public/` tal cual en `astro dev` y lo copia a `dist/` en build.)
- Es **un solo archivo HTML autocontenido**. No depende del pipeline de Astro ni de
  assets relativos: todo va embebido o por CDN. Se puede abrir incluso con doble clic.

## Stack (importante)

- **HTML único + React 18 (UMD vía unpkg) + Babel Standalone en el navegador.** NO hay build,
  NO es un componente Astro/React del proyecto. El JSX se transpila en el cliente
  (`<script type="text/babel">`).
- **CSS-in-JS inline** dentro de una constante `CSS` (template string) inyectada en `<style>`.
- **Assets en base64** embebidos en la constante `ASSETS` (logo, fotos de referencia, RAW neutral).
  Son las líneas largas al inicio del archivo (~líneas 28-42); no editarlas a mano.
- Fuentes: **Inter** (rsms.me) + **JetBrains Mono** (Google Fonts), cargadas vía `<link>` en `<head>`.

## Cómo editarlo

- Todo el código real está fuera de las líneas base64. Estructura del `<script type="text/babel">`:
  - `ASSETS` / `MEDIA` — medios (base64 + URLs opcionales editables).
  - `CSS` — todos los estilos (tokens del DS + componentes).
  - Primitivas: `Lightbox`, `PhotoBox`, `Frame916`, `SubtitleRender`, `LowerThird`,
    `MoveDemo`, `TransitionDemo`, `DofPhoto`, `BeforeAfter`.
  - `STEPS` — **configuración de los 8 pasos** (data-driven; aquí se agregan/editan pasos y opciones).
  - `App` — el wizard (estado, validación, header, nav, render de pasos).
  - `Summary` — el documento imprimible.
- **QA sin navegador:** se puede validar que el JSX transpila y montar los estados con
  `@babel/standalone` + `react-dom/server` (renderToStaticMarkup) en Node. Útil antes de entregar.

## Design System (alineado a ZEBRA)

Sigue el DS del sitio (ver [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md)):

- **Monocromático:** ink `#0A0A0A`, blancos/ink-50, bordes ink-200/300. El **acento es negro**
  (selección, "Preferir", botón primario), NO amarillo.
- **Tipografía:** Inter (cuerpo + títulos) + JetBrains Mono (eyebrows, números, índices de paso).
- **Forma:** botones **pill**, cards redondeadas (~20px), sombras duales (shadow-card), easing
  firma `cubic-bezier(.16,1,.3,1)`.
- **El amarillo `#ffce00` solo sobrevive como CONTENIDO** de los demos audiovisuales
  (opción de subtítulo amarillo, caja, lower-thirds), nunca como chrome de la UI.

## Funcionalidad

- **8 pasos:** 4 de Producción (formato/tomas, ángulo, movimiento, iluminación+profundidad) y
  4 de Postproducción (subtítulos, color, ritmo+transiciones, gráficos+audio) + **resumen imprimible**.
- **Tri-estado** Preferir / Neutral / Evitar en los pasos de preferencia; single/multi/music en otros.
- **Validación:** cada grupo exige al menos una elección; "Siguiente" se deshabilita y muestra
  qué falta hasta completar el paso.
- **Header anclado full-bleed** en bandas (marca + número/título), **nav anclada** abajo en todos
  los estados (welcome, pasos, resumen).
- Demos en vivo: movimientos de cámara y transiciones animadas, sliders antes/después
  (iluminación y color), mockups verticales 9:16 de subtítulos y lower-thirds, lightbox de referencias.
- **Accesibilidad:** contraste AA verificado, foco visible, navegación por teclado en tarjetas,
  `prefers-reduced-motion`, labels asociados, `autocomplete`.
- **Responsive:** en pantallas chicas el header apila marca y paso centrados; nav adaptada.

## Decisiones de craft registradas

- Sin em dash en copy (regla de marca): se usan coma o middot.
- Body en escala compacta (12–16px) por densidad — desviación consciente del DS (que sugiere 15px base).
- El amarillo de los demos es intencional (representa decisiones audiovisuales reales).

## Pendientes / ideas

- (Opcional) Enlazar la guía desde la navegación del sitio o desde `/proceso`.
- (Opcional) Hooks de medios reales: la constante `MEDIA` permite reemplazar las fotos/clips
  embebidos por URLs de assets reales de Zebra por tipo de toma/ángulo/movimiento/transición.

---

_Origen: desarrollada de forma iterativa con feedback visual (Agentation) sobre una copia de trabajo;
esta versión integrada está **limpia de Agentation** y de dependencias de `localhost`._
