# Memoria del Design System — Zebra · Virtual Stripes 26

> El **porqué** del sistema. Aquí no hay valores (esos están en `01-design-system/`) ni checklists
> (esos están en `03-reglas-de-construccion/`). Aquí está el criterio: por qué las cosas son como
> son, para que nadie las rompa sin entenderlas. Si vas a cambiar algo del DS, léelo primero.

---

## Principios de marca

1. **Monocromático por convicción, no por pobreza.** Zebra (cebra → blanco y negro) se expresa en
   un sistema de negro, blanco y una rampa de grises. El color no es la identidad; la identidad es
   la **precisión**: tipografía afilada, hairlines, jerarquía clara. El único color "vivo" permitido
   es el amarillo audiovisual, y solo como *contenido* de demos de video, jamás como chrome de UI.
   → ver regla **ZR-05**.

2. **Una sola fuente de verdad, portable.** Los tokens viven una sola vez (`tokens.css` +
   `ds-tokens.json` en DTCG) y se propagan a todo: sitio, decks, PDFs, Figma. Cambiar un token ahí
   cambia toda la marca. Por eso el kit existe: para que cualquier persona o herramienta hable el
   mismo lenguaje sin reinterpretarlo.

3. **Profundidad por superficie y luz, no por peso.** La jerarquía se logra con contraste de
   superficie (closer = lighter) y sombras sutiles, no engrosando bordes ni saturando. De ahí el
   **hairline de 1px constante** y la escala de sombras de 5 niveles. → ZR-08, ZR-14, ZR-17.

4. **Theme-aware de raíz.** Todo debe funcionar en light y dark. El texto nunca se pinta con un hex
   fijo; siempre por token. La impresión siempre cae a light (el papel es blanco). → ZR-06, ZR-22.

5. **No inventar.** El sistema es deliberado. Agregar un adorno, un color o una familia tipográfica
   "porque se ve bien" fragmenta la marca. Si no está en el DS, no se usa; se propone y se documenta
   primero. → ZR-20.

## Decisiones clave y su razón

- **Hairline `.10` (whisper).** Borde = `rgba(10,10,10,.10)` light / `rgba(255,255,255,.10)` dark.
  La profundidad la da la sombra, no la línea. `border-strong` (.12/.14) solo para chips/tags
  pequeños. **El grosor del borde es siempre 1px**, en todos los estados; el estado activo cambia el
  *color* a `--accent`, no el grosor (engrosar produce salto de layout y look pesado).

- **Tarjeta blanca nunca sobre fondo blanco.** Una `--surface` (#fff) no luce sobre `--bg` (#fff): se
  pierde el borde. El fondo detrás de tarjetas se recesa a `--surface-2` (#F9FAFB). En dark se cumple
  solo (card #161616 sobre bg #0A0A0A, más clara = más cercana). Aprendido en producción: además, una
  sombra sobre fondo casi blanco deja un marco cuadrado en las esquinas → en piezas estáticas el card
  va sin sombra, solo hairline.

- **Botones a `rounded-[10px]` (ya no pill).** Escala de radios "muy sutil": chip 6 · control 8 ·
  input/btn 10 · card 12 · pill 999. En piezas grandes (decks) el card sube a 16 para que el redondeo
  se lea.

- **Pesos: semibold para headings, 700 solo para cifras.** Evita el look "bold por default".

- **Foco fino animado.** Anillo `box-shadow 0 0 0 1px var(--accent)` con transición
  `cubic-bezier(.16,1,.3,1)`, no outline duro de 2px. El mismo easing único gobierna todo el motion.

- **Industria (acentos apagados, AA).** Para material por vertical: oro `#7C6A3E`, rojo `#A85A4C`,
  teal `#46807C` (todos AA, separados del rojo de error). Menos vivos, siguen distintos.

## Aprendizajes de producción (de piezas reales)

Estas lecciones nacieron construyendo entregables (decks/PDFs) y se volvieron reglas:

- **Logo distorsionado por flexbox.** Un `<img>` en un flex column con `align-items:stretch` se
  ensancha manteniendo el alto → letras estiradas. Nunca distorsionar; `align-self:flex-start` + una
  sola dimensión. → ZR-11.
- **PDF pesado por fuentes variables.** Google Fonts sirve Inter/JetBrains como *variables*; Chrome no
  puede incrustarlas como fuente real en PDF y las convierte en Type 3 duplicadas por página → lento.
  Solución: woff2 estáticos auto-hospedados. → ZR-23.
- **Motif "Stripes" formalizado.** Se agregaron "rayas diagonales" riffeando sobre el nombre Virtual
  *Stripes*; al inicio no estaban en el DS y se removieron. Al validar que encajan con la marca
  (Zebra = cebra = rayas) se **formalizaron** como segundo motif oficial junto al dot-grid: tokens
  `--motif-*`, clase `.zebra-motif` (web) e imágenes `motif-stripes(-dark).png` (PDF). La lección de
  fondo sigue viva: no inventar; primero documentar en el DS, luego usar. → ZR-20.
- **Mensaje cruzado.** Un eyebrow decía lo contrario a la tesis de la pieza. El copy debe alinear en
  todos sus niveles. → ZR-01.

## Cómo evoluciona

El showcase navegable **Virtual Stripes** en el sitio es la fuente viva. Cuando el código y un
documento del kit se contradicen, **gana el código** y el documento se corrige. Los cambios
relevantes se anotan aquí con su razón, para que la próxima persona no repita el error.
