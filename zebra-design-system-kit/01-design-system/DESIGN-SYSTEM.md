# ZEBRA Design System — Atomic Reference

> **Kit descargable:** este doc es la pieza `01` del kit portable. Vive en
> **https://zebra.lopezulloa.com** (`/design-system`). Para construir cualquier formato (web, PDF,
> deck, documento) baja `zebra-design-system-kit.zip` con el botón "Descargar el kit" o
> `curl -O https://zebra.lopezulloa.com/zebra-design-system-kit.zip`, y empieza por
> `00-EMPIEZA-AQUI`. El kit incluye: **Design System**
> (este doc + tokens), **Memoria** (el porqué), **Reglas de construcción** (`ZR-##`) y **Flujos**.
> Reconstruir el zip: `bash scripts/build-kit.sh`. Fuentes autorales en `kit/`.
>
> v2.0 · Virtual Stripes 26 — Actualizado 2026-06-20. Fuente de tokens portable: `src/styles/tokens.css` + `ds-tokens.json` (DTCG).
>
> **Fuente de verdad:** `tailwind.config.mjs` + `src/styles/global.css`. Este doc refleja
> esos archivos. Si hay conflicto, gana el código y este doc se corrige.
>
> **Showcase vivo:** [Virtual Stripes](src/pages/design-system.astro) en `/design-system` —
> sistema navegable (sidebar + ⌘K + light/dark + drawer de detalle) con los 8 grupos
> (Fundaciones · Base · Compuestos · Navegación · Patrones · Audiovisual · Sistema). La
> versión previa quedó archivada en `src/pages/_archive/design-system-v1.astro`.
>
> **2026-06-20 · Theme-aware showcase:** los grupos Navegación, Patrones, Audiovisual y
> Sistema migraron su chrome (superficies, bordes, textos, radios, sombras) a tokens
> `--vs-*`, así funcionan en light y dark. Se conservan literales intencionales: el
> amarillo audiovisual `#ffce00`/`#16150f`, las paletas de color grading, los swatches de
> industria (oro/rojo/teal), los semánticos de estado, y las muestras deliberadamente
> oscuras (Footer ink, CTA band, tarjeta énfasis de Stats). Fundaciones: la lámina "Escala
> tipográfica" ahora renderiza cada token con su tamaño y line-height reales (Display hasta
> 4.5rem) y separa "Aplicaciones" (card title, eyebrow); Motion mantiene el easing único
> `cubic-bezier(.16,1,.3,1)`. Los ordinales `#CBD5E1` de Industry anatomy pasaron a
> `--vs-text-2`.
>
> **2026-06-20 · Librería de tokens unificada + refinamiento high-end.** Fuente única en
> [`src/styles/tokens.css`](src/styles/tokens.css) que consumen **sitio (Tailwind) y Virtual
> Stripes** — cambiar un token ahí propaga a todo:
> - **Borde:** `--border` = `rgba(10,10,10,.10)` light / `rgba(255,255,255,.10)` dark (hairline
>   whisper, profundidad por sombra no por línea). `--border-strong` = `.12`/`.14` solo para
>   chips/tags pequeños. Tailwind: `border-ink-200` → `var(--border)`.
> - **Borde de selección/activo = hairline con contraste (NUNCA engrosar).** El grosor del borde
>   es **siempre 1px**, en todos los estados. El estado seleccionado/activo se comunica cambiando el
>   **color** del borde a `--accent` (= `--text`, contraste pleno) y sumando sombra/relleno, **no**
>   subiendo a 1.5/2px. Engrosar el borde produce un salto de layout y un look pesado anti-DS.
>   Reposo: `1px var(--border)`. Seleccionado: `1px var(--accent)`. Foco: anillo `box-shadow`
>   adicional, no más grosor de borde.
> - **Tarjeta blanca NUNCA sobre fondo blanco (contraste de superficie).** Una `--surface` (#fff en
>   light) no luce sobre `--bg` (#fff): se pierde el borde de la tarjeta. El fondo **detrás de
>   tarjetas** debe ser el gris tenue `--surface-2` (#F9FAFB / `ink-50`), así la tarjeta blanca
>   resalta. Regla de capas: el contenedor de cards usa `--surface-2`; las cards usan `--surface`
>   (más claro = más cercano, PCB R57). En **dark** se cumple solo (card `--surface #161616` sobre
>   `--bg #0A0A0A`, card más clara). En **light** hay que recesar el fondo a `--surface-2`
>   explícitamente; nunca dejar cards blancas sobre página blanca.
> - **Texto siempre theme-aware (NUNCA color fijo).** Todo color usado para **texto/foreground**
>   debe resolverse por tema: usar `--text`, `--text-muted` o `--accent` (o un token con override en
>   dark). **Prohibido** pintar texto con un hex fijo o un token compat sin override (ej. un viejo
>   `--gold-text: #0A0A0A`): se vuelve **invisible en dark**. Si creas un token de color, dale su
>   valor en `:root` **y** en `[data-ds-theme="dark"]`, o no lo uses para texto.
> - **Impresión = siempre light mode.** Cualquier vista imprimible (resumen, factura, guía) se
>   imprime en **claro**, sin importar el tema activo en pantalla. En `@media print` se fuerzan los
>   tokens a sus valores light (`--bg/--surface/--text/--border…`) aunque `data-ds-theme="dark"` esté
>   puesto, y se anulan filtros de dark (ej. el logo invertido vuelve a su color original). El papel
>   es blanco; nunca gastar tinta en fondos oscuros ni arriesgar texto claro sobre claro.
> - **Radio:** `--r-card 12 · --r-input 10 · --r-control 8 · --r-chip 6 · --r-btn 10 · --r-pill`.
>   Botones ya no pill (10px).
> - **Sombras:** `--shadow-card/soft/elevated/inset`.
> - **Pesos:** headings y card titles en **semibold (600)**; `strong/b` global a 600; ≥700 solo
>   para cifras/stat.
> - **Foco:** anillo fino animado `box-shadow:0 0 0 1px var(--vs-accent)` + transición .18s
>   `cubic-bezier(.16,1,.3,1)` (no outline 2px duro). Default del showcase: **dark**. Toggle sol/luna.
> - **Iconos:** `stroke-width 1.5` (checks chicos 1.75).
> - **Sidebar del DS:** fondo `--vs-surface-2` para distinguirlo del body.
> - **Industria (apagado, AA):** oro `#7C6A3E` (5.27:1) · rojo `#A85A4C` (4.96:1) · teal
>   `#46807C` (4.53:1) — menos vivos, siguen distintos y separados del rojo de error `#B91C1C`.

## 1. Color Tokens

### Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `ink` | `#0A0A0A` | Primary text, buttons, dark backgrounds |
| `ink-900` | `#0F172A` | Reserved (near-black alt, slate-tinted) |
| `ink-700` | `#262626` | Hover states, secondary emphasis |
| `ink-500` | `#737373` | Body text, descriptions, muted content, **placeholders, hints (mínimo legible, 4.74:1 AA)** |
| `ink-400` | `#94A3B8` | **Solo decorativo / glifos / bordes. NUNCA como texto** (2.56:1 sobre blanco, falla AA) |
| `ink-300` | `#CBD5E1` | Light borders on dark backgrounds (slate-tinted) |
| `ink-200` | `#E5E5E5` | Borders, dividers, input outlines |
| `ink-100` | `#F5F7FA` | Subtle backgrounds (slate-tinted) |
| `ink-50` | `#F9FAFB` | Section alternate backgrounds |
| `white` | `#FFFFFF` | Page background, card fills, button text |

> ⚠️ **Deuda de craft (Bible R27/R31):** la rampa mezcla grises puros (`ink-700`, `ink-500`,
> `ink-200`) con grises slate-azulados (`ink-900`, `ink-400`, `ink-300`, `ink-100`). El sistema
> es monocromático (acento = negro puro), así que la rampa debería ser **un solo hue coherente**.
> Recomendación pendiente: unificar a grises neutros puros o tintar todos con el mismo hue.
> No corregido aún para no alterar el render del sitio sin revisión visual.

### Opacity Modifiers (used on dark backgrounds)

| Pattern | Example | Context |
|---------|---------|---------|
| `text-white/60` | 60% white | Footer body text + icon default (mínimo AA sobre `ink`, ≈4.9:1) |
| `text-white/70` | 70% white | Stat label on dark card |
| `text-white/80` | 80% white | Testimonial role |
| `border-white/10` | 10% white | Footer divider |
| `border-white/15` | 15% white | Footer icon border |

### Industry theme tokens (CSS custom properties)

El sistema soporta theming por industria vía `data-theme` en `<html>` (ver §10). Tokens:

| Variable | Default | inmobiliario | restaurantes | medico |
|----------|---------|--------------|--------------|--------|
| `--industry` | `#0A0A0A` | `#7C6A3E` (oro, AA ✓) | `#A85A4C` (rojo) | `#46807C` (teal) |
| `--industry-light` | `#F9FAFB` | `#FDF8EF` | `#FDF2F0` | `#EFF9F9` |
| `--industry-muted` | — | `#D4A84B` | `#D4745F` | `#3AA3A3` |

### Legacy tokens (DO NOT USE — mapped to ink for backwards compat)

| Token | Maps to | Note |
|-------|---------|------|
| `accent` | `#0A0A0A` | Was green. Now = ink. Use `ink` directly. |
| `accent-hover` | `#262626` | = ink-700 |
| `accent-soft` | `#F5F5F5` | ≈ ink-50. Use `ink-50` instead. |

---

## 2. Typography

### Font Stack

| Family | Name | Load | Usage |
|--------|------|------|-------|
| Sans | Inter | `rsms.me/inter/inter.css` | All body text, headings, navigation, buttons |
| Mono | JetBrains Mono | Google Fonts (400, 500, 700, italic 500) | Eyebrows, stat numbers, mobile menu indices |

> **Implementation note**: Tailwind's `font-mono` class doesn't reliably load JetBrains Mono. Use `style="font-family: 'JetBrains Mono', monospace;"` inline on elements, or the `.eyebrow` component class (which declares it directly in CSS).

### Type Scale (real values en `tailwind.config.mjs`)

| Class / token | Size | Line-height | Tracking | Weight | Context |
|-------|------|-------------|----------|--------|---------|
| `text-display` | `clamp(2.5rem, 5vw+1rem, 4.5rem)` | 1.05 | -0.03em | — | Display XL (disponible, uso puntual) |
| `text-h1` | `clamp(2rem, 3vw+1rem, 3rem)` | 1.1 | -0.02em | 600 (semibold) | Hero H1 + all section headings. Same scale everywhere. |
| `text-h2` | `clamp(1.5rem, 1.5vw+1rem, 2rem)` | 1.2 | -0.01em | — | Sub-section headings |
| `text-eyebrow` (token) | 12px | 1 | 0.2em | — | Token Tailwind (ver nota) |
| `.eyebrow` (clase) | 11px | 1 | 0.22em | 500 (medium) | **Usar esta.** Section labels (JetBrains Mono, uppercase) |
| Card title | `text-xl` (20px) | default | — | 600 (semibold) | Card headings |
| Body | `text-base` (**15px**) | 1.55 | — | 400 | Paragraphs |
| Body small | `text-sm` (14px) | relaxed | — | 400 | Card descriptions, form labels |
| Caption | `text-xs` (12px) | default | — | 400 | Footer, hints |
| Stat number | `text-5xl` / `text-6xl` | default | tighter (-0.03em) | 500 (medium) | Credentials, Experience metrics (JetBrains Mono inline) |

> **Nota eyebrow:** existen dos definiciones — el token Tailwind `text-eyebrow` (12px/0.2em) y la
> clase `.eyebrow` (11px/0.22em). **La clase `.eyebrow` es la canónica**; el token queda como legacy.
>
> **Nota body (Bible R2):** la Biblia pide body ≥16px. Zebra usa **15px** por decisión de marca
> (densidad / preferencia de landings). Desviación consciente documentada en §14.

### Heading rule

**2026-06-20 · Pesos aligerados (high-end tech).** Los headings dejaron de ser extrabold.
**All** `<h2>` section headings use:
```
class="text-h1 font-semibold text-ink"
```
Headings y card titles → `font-semibold` (600). Reservar pesos ≥700 solo para cifras/stat
o énfasis puntual, nunca para títulos.

### Text-wrap (default global en `global.css`)
`h1, h2, h3 { text-wrap: balance }` y `p { text-wrap: pretty }` aplican a todo el sitio
para evitar viudas/huérfanas sin tener que ponerlo inline por elemento.

---

## 3. Spacing

### Section rhythm

| Property | Value | Note |
|----------|-------|------|
| Section padding | `py-24 md:py-section` | **section = 60px** (token Tailwind) |
| Container | `.container-x` | max-w: 1280px, px: 24→40→80 |
| Section internal gap | `gap-12` or `gap-14` | Between header and content |

> Sistema de espaciado en múltiplos de 4px (Bible R44) ✓

### Component spacing

| Pattern | Values |
|---------|--------|
| Card padding | `p-8` (32px) for small cards, `p-10` (40px) for feature cards |
| Card gap (grid) | `gap-5` (20px) for tight grids, `gap-6` (24px) for spacious |
| Stack gap (flex-col) | `gap-5` between items, `gap-2` between label+input |
| Button padding | `px-6 py-3` (standard, h=2x v ✓ Bible R64), `px-10 py-5` (hero CTA) |

---

## 4. Border Radius (real values en `tailwind.config.mjs`)

> **2026-06-20 · Escala "Muy sutil".** Se suavizó toda la escala (cards 24→12, inputs 20→10)
> y los botones dejaron de ser pill (`rounded-full` → **10px**). Look más refinado/editorial.
> En Virtual Stripes los mismos valores viven como tokens `--vs-r-*` en `ds.css`.

| Token | Value | Usage |
|-------|-------|-------|
| `rounded-sm` | 6px | Tags, small chips |
| `rounded-md` | 8px | Compact controls (tabs, checkbox) |
| `rounded-lg` | 10px | Toasts, cookie banner, medium surfaces |
| `rounded-xl` | 10px | Inputs, selects, dropdown items |
| `rounded-2xl` | 12px | Dropdown panels, WhatsApp card |
| `rounded-3xl` | 12px | **All cards** — criteria, services, testimonials, recognition, stats, industry |
| `rounded-[10px]` | 10px | Buttons (primary + ghost) — ya no pill |
| `rounded-full` | 50% | Solo círculos reales: iconos, avatares, social, back-to-top, dots |

### Rule
Cards → `rounded-3xl` (12px). Buttons → `rounded-[10px]`. Inputs → `rounded-xl` (10px). Radios concéntricos (Bible R60). `rounded-full` solo para elementos genuinamente circulares.

---

## 5. Shadows (real values en `src/styles/tokens.css`)

Escala de **5 niveles por elevación** (Bible R96): construye el modelo mental del espacio Z.
Cada token es **multicapa** (Bible R55): la 1.ª capa `0 0 0 1px` imita el borde y se adapta a
cualquier fondo; las capas siguientes suman profundidad con offset vertical y blur ~2x distancia
(R53). No mezclar niveles arbitrariamente: subir un nivel completo por salto de elevación.

**Light** (capa de borde = negro tenue):

| Token | Elevación | Value |
|-------|-----------|-------|
| `shadow-sm` | cards sutiles | `0 0 0 1px rgba(10,10,10,.04), 0 1px 2px rgba(10,10,10,.06)` |
| `shadow-md` | dropdowns | `0 0 0 1px rgba(10,10,10,.04), 0 2px 4px -1px rgba(10,10,10,.08), 0 4px 8px -2px rgba(10,10,10,.06)` |
| `shadow-lg` | modales | `0 0 0 1px rgba(10,10,10,.04), 0 4px 8px -2px rgba(10,10,10,.10), 0 12px 24px -6px rgba(10,10,10,.10)` |
| `shadow-xl` | drawers | `0 0 0 1px rgba(10,10,10,.04), 0 8px 16px -4px rgba(10,10,10,.12), 0 24px 48px -12px rgba(10,10,10,.14)` |
| `shadow-2xl` | flotantes críticos | `0 0 0 1px rgba(10,10,10,.04), 0 16px 32px -8px rgba(10,10,10,.16), 0 40px 72px -16px rgba(10,10,10,.18)` |

**Dark** (capa de borde = blanco tenue para definir el edge sobre fondo oscuro; profundidad
atenuada con negro denso, Bible R56):

| Token | Value |
|-------|-------|
| `shadow-sm` | `0 0 0 1px rgba(255,255,255,.05), 0 1px 2px rgba(0,0,0,.4)` |
| `shadow-md` | `0 0 0 1px rgba(255,255,255,.05), 0 2px 6px -1px rgba(0,0,0,.5)` |
| `shadow-lg` | `0 0 0 1px rgba(255,255,255,.06), 0 6px 16px -4px rgba(0,0,0,.55)` |
| `shadow-xl` | `0 0 0 1px rgba(255,255,255,.06), 0 12px 28px -8px rgba(0,0,0,.6)` |
| `shadow-2xl` | `0 0 0 1px rgba(255,255,255,.07), 0 20px 44px -12px rgba(0,0,0,.65)` |

**Compat / otros:**

| Token | Value | Usage |
|-------|-------|-------|
| `shadow-card` | `var(--shadow-sm)` (dark: `none`, ver R56) | Alias de reposo para componentes existentes |
| `shadow-soft` | `var(--shadow-lg)` | Alias elevado: video lightbox, featured quote, form card |
| `shadow-elevated` | `var(--shadow-xl)` | Alias máxima elevación: modales, overlays |
| `shadow-inset` | `inset 0 1px 0 0 rgba(255,255,255,.06)` | Highlight superior en superficies oscuras |
| card-lift hover | `0 32px 64px -20px rgba(10,10,10,.18), 0 8px 16px -8px rgba(10,10,10,.08)` | Dinámico — `.card-lift:hover` |

---

## 6. Component Classes

### `.container-x`
```css
mx-auto w-full max-w-container px-6 md:px-10 lg:px-20
```

### `.eyebrow`
```css
font-family: 'JetBrains Mono', ui-monospace, monospace;
text-[11px] font-medium uppercase tracking-[0.22em] text-ink-500
```

### `.btn-primary`
```
rounded-[10px] bg-accent text-white px-6 py-3 text-sm font-semibold
hover: bg-accent-hover -translate-y-0.5 shadow-lg shadow-accent/30
focus-visible: bg-accent-hover · active: translate-y-0
```

### `.btn-ghost`
```
rounded-[10px] border border-ink-200 bg-white text-ink px-6 py-3 text-sm font-semibold
hover: border-ink-700 -translate-y-0.5 shadow-md · active: translate-y-0
```

### `.link-underline`
```
::after pseudo-element, h: 1.5px, bg: currentColor
scaleX(0) → scaleX(1), origin switches right→left on hover
duration: 0.45s ease-out-expo
```

### `.card-lift`
```
hover: translateY via shadow swap, shadow 32px, border-color darken
duration: 0.5s ease-out-expo
```

### `.img-zoom`
```
overflow: hidden on wrapper
img: scale(1.06) on parent hover
duration: 0.9s ease-out-expo
```

---

## 7. Animation System

### Easing
One easing for everything: `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out expo).

### Scroll Reveal

| Class | Effect | Duration |
|-------|--------|----------|
| `.reveal` | opacity 0→1, translateY(24px→0) | 0.8s |
| `.reveal-left` | translateX(-32px→0) | 0.8s |
| `.reveal-scale` | scale(0.96→1) | 0.8s |
| `.reveal-d1` to `.reveal-d6` | Stagger delays: 0.08s increments | — |

Gated por `html.js` (el observer siempre corre; la transición vive en CSS). Triggered por
`IntersectionObserver` agregando `.is-visible` (threshold 0.12, rootMargin -8% bottom).

### Otros
- **Count-Up** — `data-count-target` anima 0→target en scroll. `font-variant-numeric: tabular-nums` (Bible R7 ✓).
- **Scroll Progress Bar** — `.scroll-progress`, fixed top, scaleX tracks scroll depth.
- **Page Load Progress** — `.page-progress`, llena 0→100% durante carga, fade out al terminar.
- **Parallax** — `data-parallax="0.3"` translate en scroll.
- **Back to Top** — `.back-to-top`, aparece tras 600px, scroll suave al top.
- **Image Skeleton** — `.img-skeleton` shimmer placeholder (`@keyframes shimmer`).
- **Spin** — `.animate-spin` para spinner de submit.

### Reduced motion (Bible R244 / regla interna)
`@media (prefers-reduced-motion: reduce)` desactiva: `shimmer`, `float-y`, `pulse-dot`,
`skeleton-pulse`, `focus-glow`, el movimiento de `.reveal`/`.card-lift`/`.img-zoom`, el count-up
(pinta el valor final directo) y `scroll-behavior`. **El contenido nunca queda invisible**: los
reveals fuerzan `opacity:1; transform:none` bajo reduced-motion.

---

## 8. ~~Cursor System~~ (RETIRADO Y LIMPIADO)

El cursor custom (dot + ring) fue **eliminado por completo**: ~117 líneas de CSS, el bloque
`if (false)` en `animations.ts`, el rebind en `Base.astro` y todos los atributos `data-cursor-*`
del markup. El sitio usa el cursor nativo del browser. No queda código latente.

---

## 9. Interactive Patterns

### Buttons
- Primary: lift + shadow on hover, snap back on active
- Ghost: lift + shadow + border darken on hover
- Tres niveles de botón disponibles (primary / ghost / link) — Bible R90 ✓
- `data-magnetic="0.2|0.25|0.3"` for magnetic pull effect

### Cards
All cards use `card-lift` + `reveal` + `reveal-d{n}` for entrance stagger.

> Nota Bible R65/S07 ("shadow O border, nunca ambos"): las cards usan border + shadow
> simultáneos. Desviación aceptada (el border es sutil `ink-200`, la sombra carga la jerarquía).
> Ver §14.

**Selección de cards (selectable / pickable):** borde **siempre 1px**. Reposo `1px var(--border)`
(hairline). Seleccionada `1px var(--accent)` (contraste pleno) + sombra de selección. **No** subir
el grosor a 1.5/2px al seleccionar: rompe el hairline del DS, mete salto de layout y se ve pesado.
El cambio de estado es de **color + sombra**, no de grosor.

### Icon containers
```
bg-ink-50 text-ink → group-hover:bg-ink group-hover:text-white
```
With optional rotation: `group-hover:rotate-[-8deg]`

### Form inputs
```
border-ink-200 bg-white → hover:border-ink-300
focus-visible: border-ink + ring-2 ring-ink (foco de teclado siempre visible, no ring/5)
```
Validación on blur (Bible R125-132 ✓), errores persistentes con `.field-error` + `.error-msg`.
Rojo solo para error (Bible R38 ✓).

### Toast / Cookie / Social / Nav / Video lightbox
- **Toast** — `showToast()` confirmación post-submit, auto-dismiss 5s.
- **Cookie banner** — `.cookie-banner` GDPR, localStorage, accept/reject.
- **Social icons (footer)** — swap outline↔filled en hover.
- **Navigation** — hash anchors (`#inicio`, `#servicios`, `#testimonios`, `#cursos`, `#contacto`),
  sin dropdown. Sticky `bg-white/85 backdrop-blur-md`, altura fija `h-16 md:h-20`. Mobile: overlay full-screen.
- **Active nav section** — JS aplica `.nav-active` a la sección en viewport.
- **Video lightbox** — `<dialog>` nativo, YouTube iframe, cierra con X / click fuera / Escape.

---

## 10. Section Backgrounds + Industry Theming

### Page rhythm (home)
Alternancia estricta white / `ink-50`, rota solo por el footer oscuro:

`Nav (white/85) → Hero (white) → Certifications (ink-50) → SelectionCriteria (white) →
Credentials (ink-50) → ExperienceMetrics (white) → ServicesOverview (ink-50) →
PerformanceServices (white) → Testimonials (ink-50) → IndustryServices (white) →
Measurement (ink-50) → Recognition (white) → ClientLogos (ink-50) → ContactForm (white) →
Footer (ink, dark)`

### Industry Theming (`data-theme`)
Las landings por industria (`/servicios/*` vía `IndustryLanding.astro`) aplican `data-theme` en
`<html>` para inyectar el color de industria en touchpoints clave **sin tocar el markup**:

| Touchpoint | Override |
|------------|----------|
| `.btn-primary` | `background: var(--industry)`, hover oscurece (`color-mix … #000`, AA ✓) |
| Icon containers | `group-hover` → `var(--industry)` |
| `.card-lift` | borde izquierdo 3px que aparece en hover (`var(--industry)`) |
| Stat emphasis card | `bg-ink` → `var(--industry)` |
| `:focus-visible` | outline `var(--industry)` |
| `.link-underline::after` | `var(--industry)` |
| `.back-to-top` | `var(--industry)` |
| `.scroll-progress` / `.page-progress` | `var(--industry)` |
| Hero dot grid | patrón tintado por industria (grid / radial / diagonal) |

Temas: `inmobiliario` (oro), `restaurantes` (rojo), `medico` (teal). Default = monocromático.

### Motifs (patrones de marca)

Dos patrones decorativos **oficiales**. Ambos van **siempre detrás del contenido** (`z-index:-1`) y
**nunca sobre los cards**.

| Motif | Qué es | Web | PDF / deck |
|-------|--------|-----|------------|
| **Dot grid** | Retícula de puntos del Hero, tintada por industria (grid/radial/diagonal). | Componente `Hero.astro`. | — |
| **Stripes** | Líneas diagonales sutiles (marca cebra). | Clase `.zebra-motif` (theme-aware vía `currentColor`: negro en light, blanco en dark). | Imagen `public/img/motif-stripes.png` (light) / `motif-stripes-dark.png` (dark); no usar gradiente CSS en PDF por performance, ver ZR-24. |

Tokens del motif Stripes: `--motif-angle 115deg` · `--motif-line 2px` · `--motif-gap 26px` ·
`--motif-opacity .05` (light) / `.06` (dark).

No inventar motifs nuevos: si un adorno no está aquí, se propone y documenta primero (ZR-20).

---

## 11. Data Attributes (JS hooks)

| Attribute | Values | Behavior |
|-----------|--------|----------|
| `data-magnetic` | `0.2`, `0.25`, `0.3` | Magnetic pull toward cursor |
| `data-video-id` | YouTube ID | Opens video lightbox on click |
| `data-video-title` | String | Sets iframe title for a11y |
| `data-count-target` | Number | Count-up animation on scroll |
| `data-count-prefix` / `-suffix` | `"$"`, `"M"`, `"+"` | Prefix/suffix del número |
| `data-parallax` | `0.3` | Parallax scroll speed |
| `data-theme` | `inmobiliario` / `restaurantes` / `medico` | Industry theme override |

---

## 12. Accessibility (Bible S16)

| Feature | Implementation |
|---------|---------------|
| Skip link | `<a href="#contenido">Saltar al contenido</a>` (sr-only, visible on focus) |
| Focus ring | 2px solid ink (industry en themes), offset 3px, radius 4px — Bible R235 ✓ |
| `aria-label` | On logo, hamburger, social icons, video buttons |
| `aria-expanded` | On hamburger toggle (dynamically updated) |
| Cookie consent | `.cookie-banner` con localStorage, accept/reject |
| `prefers-reduced-motion` | Desactiva shimmer, pulse, float, skeleton, focus-glow, reveals, card-lift, img-zoom, count-up y marquee. Contenido siempre visible. |
| `lang="es"` | On `<html>` |
| View Transitions | Astro `<ViewTransitions />` |
| Touch targets | 44px en controles interactivos (back-to-top, hamburguesa, cerrar, sociales) ✓ Bible R238 |
| Focus de teclado | `:focus-visible` 2px ink global; inputs con `ring-2 ring-ink` (nunca ring invisible) |
| Video lightbox | `<dialog>` nativo, Esc to close, focus management |

---

## 13. File Structure (actual)

```
src/
├── components/
│   ├── ZebraLogo.astro          # Inline SVG, currentColor
│   ├── Icon.astro               # Lucide-style icon library
│   ├── Nav.astro                # Sticky header + hamburger + mobile menu
│   ├── Hero.astro               # Hero con dot grid parallax
│   ├── Certifications.astro     # Partner logos (grayscale → color hover)
│   ├── SelectionCriteria.astro  # Criteria cards
│   ├── Credentials.astro        # Stats con count-up
│   ├── ExperienceMetrics.astro  # Metric cards (1 dark emphasis) con count-up
│   ├── ServicesOverview.astro   # Services intro
│   ├── PerformanceServices.astro# Numbered process cards (JetBrains Mono)
│   ├── Testimonials.astro       # Video thumbnail cards + YouTube lightbox
│   ├── IndustryServices.astro   # Industry cards (grayscale → color hover)
│   ├── Measurement.astro        # Quote + explanation
│   ├── Recognition.astro        # Award cards (Merca 2.0, M4E)
│   ├── ClientLogos.astro        # Dual-row marquee (bidirectional)
│   ├── EducationalContent.astro # Bloque educativo / contenido
│   ├── ContactForm.astro        # Split: trust signals + form card + WhatsApp CTA
│   └── Footer.astro             # Dark footer, social icons (outline→fill hover)
├── components/landing/          # Secciones compartidas de las landings /servicios/*
│   ├── SectionHeader.astro      # eyebrow + h2 + descripción (data-driven)
│   ├── Criteria.astro · Experience.astro · Stats.astro · Services.astro
│   ├── Method.astro · VideoTestimonials.astro · FAQ.astro · Measurement.astro
├── layouts/
│   ├── Base.astro               # HTML shell, fonts, ViewTransitions, scripts
│   └── IndustryLanding.astro    # Shell de /servicios/*: data-theme + Nav + slot +
│                                #   video lightbox + Recognition/ClientLogos/Contact + Footer
├── pages/
│   ├── index.astro              # Home (section assembly)
│   ├── nosotros.astro           # /nosotros
│   ├── proceso.astro            # /proceso
│   ├── testimonios.astro        # /testimonios
│   ├── vacantes.astro           # /vacantes
│   ├── cursos/index.astro       # /cursos
│   ├── blog/index.astro         # /blog
│   ├── blog/como-medir-roi-marketing-digital.astro
│   ├── servicios/marketing-inmobiliario.astro    # data-theme=inmobiliario
│   ├── servicios/marketing-medico.astro          # data-theme=medico
│   ├── servicios/marketing-para-restaurantes.astro # data-theme=restaurantes
│   ├── aviso-de-privacidad.astro # /aviso-de-privacidad
│   ├── design-system.astro      # Living style guide (/design-system)
│   └── 404.astro                # Error page
├── scripts/
│   └── animations.ts            # Reveal, magnetic, progress bars, count-up, parallax,
│                                #   active nav, back-to-top, form validation, toast,
│                                #   cookie consent, skeleton (cursor RETIRADO)
└── styles/
    └── global.css               # Tokens, components, utilities, industry theming
```

---

## 14. Bible Compliance & Desviaciones conscientes

Verificado contra Product Craft Bible (276 reglas). Cumple bien en espaciado 4px, easing único,
reduced-motion, validación de forms, rojo solo destructivo, tabular-nums, touch targets, focus ring.

Desviaciones **intencionales** (decisión de marca, no corregir sin aprobación):

| Regla Bible | Estado en Zebra | Razón |
|-------------|-----------------|-------|
| **R2** body ≥16px | body 15px | Densidad / preferencia de landings |
| ~~**S07** "pill buttons default"~~ | **Resuelto 2026-06-20** | Botones suavizados a `rounded-[10px]` (escala "Muy sutil"); ya no es anti-pattern |
| **R52/R65/S07** shadow O border, nunca ambos | _showcase resuelto 2026-06-20:_ `.vs-specimen` separa por tema (light = solo sombra, borde transparente; dark = solo borde, sin sombra). Las **cards del sitio** (`global.css`) aún combinan border `ink-200` + shadow | Border sutil + sombra para jerarquía en el sitio; el DS ya cumple R52 |
| **R38** rojo solo destructivo | tema restaurantes usa rojo `#A85A4C` de marca | Identidad del sector. Para evitar choque, el rojo de **error** se diferencia en `#B91C1C` (más oscuro/saturado); marca ≠ error. |

Deudas de craft **pendientes** (recomendado corregir):

| Regla Bible | Hallazgo | Acción sugerida |
|-------------|----------|-----------------|
| **R27/R31** hue coherente en neutros | rampa mezcla grises puros + slate | Unificar el hue de la rampa `ink-*` |
| **R26** near-white nunca puro | `--bg-page: #FFFFFF` puro | Considerar `#FEFEFE`/`#FAFAFA` |

---

## Cambios del showcase (Virtual Stripes 26)

**2026-06-20**
- **Canvas recesado del contenido (fix "card blanca sobre fondo blanco").** En light el área `.vs-main` ya no era blanca como los specimens (`--vs-surface` #fff) → no contrastaban. Se añadió `--vs-canvas` (light `#F2F3F5`, gris tenue perceptible; dark `var(--bg)` #0A0A0A para conservar closer=lighter, R57) y `.vs-main { background: var(--vs-canvas) }`. Ahora los specimens blancos resaltan en light y siguen correctos en dark. (`src/styles/ds.css`)
- Toggle de tema ahora es icon-button con icono SVG luna (en claro) / sol (en oscuro), conserva `aria-label` y `aria-pressed`. (`src/components/ds/DSChrome.tsx`)
- Dark mode por default para visitante nuevo; respeta `localStorage['vs-theme']` si ya existe. (`src/layouts/DSShell.astro`, `src/components/ds/DSChrome.tsx`)
- Boton "Detalle" usa el anillo fino de foco del sistema (`box-shadow 0 0 0 1px var(--vs-accent)`), con gate de `prefers-reduced-motion`. (`src/components/ds/DSSpecimen.astro`)
- Demo de Movimiento: el punto recorre una linea horizontal con `translateX` + `cubic-bezier(.16,1,.3,1)` (con pausa al final); se elimino el `offset-path` erratico. La curva bezier queda como diagrama estatico. (`src/components/ds/foundations/Motion.astro`)
- **Elevacion de cards theme-conditional (PCB R52/R54/R55/R56/R57).** El frame `.vs-specimen` ahora eleva segun el tema: en **light** flota con sombra dual `--vs-shadow-card` (ambiente `0 1px 2px` + direccional `0 10px 28px -12px`, offset vertical) y borde transparente (R52 = solo sombra); en hover sube a `--vs-shadow-soft`; el foco compone el anillo 1px con la sombra. En **dark** no lleva sombra (`--shadow-card: none`, R56): la elevacion va por superficie mas clara `--surface #161616` sobre `--bg #0A0A0A` (closer = lighter, R57, ~+4.7% brillo dentro del max ~12% de R58) + hairline `--vs-border`; hover sube el acento en el borde. (`src/styles/tokens.css`, `src/styles/ds.css`)
- **Escala de sombras de 5 niveles por elevacion (PCB R96 + R55).** Se reconstruyo la escala como `--shadow-sm/md/lg/xl/2xl` (cards / dropdowns / modales / drawers / flotantes criticos) en `:root` light y `[data-ds-theme="dark"]`. Cada token es multicapa (R55): la 1.&#170; capa `0 0 0 1px` imita el borde y se adapta a cualquier fondo (negro tenue en light, blanco tenue en dark para definir el edge sobre fondo oscuro), las capas siguientes suman profundidad con offset vertical y blur ~2x distancia (R53); en dark la profundidad se atenua con negro denso (R56). Compat: `--shadow-card/soft/elevated` se aliasaron a `sm/lg/xl` para no romper los componentes via `--vs-shadow-*`; se anadieron alias `--vs-shadow-sm..2xl`. El specimen `#shadows` muestra las 5 elevaciones progresivas (placas sin borde sobre `--vs-surface`, la sombra define el edge) y se distingue en ambos temas. (`src/styles/tokens.css`, `src/styles/ds.css`, `src/components/ds/foundations/Shadows.astro`, `src/lib/ds-registry.ts`, §5)
- **Rampa ink invertida para dark.** Se anadieron tokens neutros para fondo oscuro en `:root[data-ds-theme="dark"]` (espejo de la rampa light: de oscuro a claro al subir el numero): `--ink-50 #1A1A1A` … `--ink-300 #404040`, `--ink-400 #737373`, `--ink-500 #A3A3A3`, `--ink-700 #E5E5E5`, `--ink-900 #F5F5F5`, `--ink #FFFFFF`. El sitio nunca pone `data-ds-theme`, asi que conserva su rampa ink light de `global.css`. La lamina "Rampa ink" del showcase es theme-aware: muestra la rampa light en claro y la invertida en oscuro. (`src/styles/tokens.css`, `src/components/ds/foundations/Color.astro`)
- **Numeracion de secciones estilo PCB (sidebar + body).** Cada seccion del showcase ahora lleva un numero secuencial 01-77 (orden de display de `DS_REGISTRY`, incluido Inicio=01) compartido 1:1 entre sidebar y body. Helper `specNumber(id)` exportado desde el registro. En el sidebar cada `.vs-sb-link` antepone un badge `.vs-sb-num` (cuadrito 20px redondeado, mono 10px, tenue) que se rellena con `--vs-accent` y texto `--vs-bg` cuando el item esta `.is-active` (legible en light y dark); cada grupo del acordeon muestra un conteo de items `.vs-sb-group-count` alineado a la derecha antes del chevron. En el body, `.vs-specimen-title` antepone `.vs-specimen-num` (mono 11px tenue) que coincide con el del sidebar. Se conservan acordeon, scroll-spy, atajos y colapso. (`src/lib/ds-registry.ts`, `src/layouts/DSShell.astro`, `src/components/ds/DSSpecimen.astro`, `src/styles/ds.css`)
