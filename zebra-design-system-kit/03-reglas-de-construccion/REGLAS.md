# Reglas de construcción — Zebra Design System

> Reglas con **ID estable `ZR-##`** agrupadas por tema. Cítalas por código ("aplica ZR-12").
> Lo que SÍ y lo que NUNCA. Si una regla y el código del DS se contradicen, gana el código y
> esta lista se corrige.

Convención: **Z**ebra **R**egla. El número es estable; no se reordena. Si agregas una regla,
toma el siguiente número libre del grupo (deja huecos si hace falta, no renumeres).

---

## A · Marca y voz

- **ZR-01 · Mensaje coherente.** Nunca comunicar lo que NO hacemos. Revisar eyebrow + headline + cuerpo juntos; un claim no puede contradecir la tesis de la pieza. (Ej.: en un deck cuyo argumento es "más leads no resuelven", la portada no puede decir "generamos leads".)
- **ZR-02 · Sin em dash.** En copy usar coma, punto o middot `·`. Nunca `—`.
- **ZR-03 · Sin emojis.** Donde iría un emoji, va un vector SVG (icono lucide o inline).
- **ZR-04 · Copy género-neutro.** "Nuestro equipo" por defecto; nunca "/a".

## B · Color y superficie

- **ZR-05 · Monocromático.** Acento = negro `#0A0A0A` (light) / blanco (dark). Rampa `ink` para grises. El amarillo audiovisual `#ffce00` solo como contenido de demos de video, jamás como chrome (botones, bordes, fondos de UI).
- **ZR-06 · Texto siempre theme-aware.** Pintar texto solo con `--text` / `--text-2` / `--accent` (o un token con override en dark). Nunca un hex fijo ni un token sin override → se vuelve invisible en dark.
- **ZR-07 · Contraste de texto AA.** Nunca usar tonos `*-light` ni `ink-400` (#94A3B8) como texto sobre fondo claro (falla AA). Mínimo WCAG AA.
- **ZR-08 · Tarjeta nunca del mismo color que su sección.** Light: card `#fff` sobre fondo recesado `--surface-2` (#F9FAFB). Dark: card `#161616` sobre `#0A0A0A` (closer = lighter). Si card y fondo empatan, el card desaparece o el hairline/sombra deja un marco feo.

## C · Tipografía

- **ZR-09 · Familias.** Inter para texto; JetBrains Mono para eyebrows, labels y datos técnicos (mayúscula, letter-spacing). No introducir otras familias.
- **ZR-10 · Pesos.** Headings y card titles en **semibold (600)**; `strong/b` a 600. `≥700` solo para cifras/stat. Nada de light para texto de lectura.

## D · Logo

- **ZR-11 · Nunca distorsionar el logo.** Respetar siempre el aspect-ratio. Cuidado con flex `align-items:stretch` que ensancha un `<img>`: usar `align-self:flex-start` y fijar **una sola dimensión** (la otra `auto`). Nunca estirar para "que llene".
- **ZR-12 · Invertir, no recolorear.** En dark el wordmark (negro) se pasa a blanco con `filter:invert(1)` (no distorsiona, solo color). No redibujar ni teñir el logo con otros colores.
- **ZR-13 · Footer con logotipo.** En footers de piezas de Zebra incluir siempre el wordmark, no solo el texto "Zebra". Puede acompañarse de texto secundario.

## E · Layout y footer

- **ZR-14 · Borde de selección = hairline con contraste, NUNCA engrosar.** Grosor siempre 1px en todos los estados. Seleccionado/activo: cambiar el **color** del borde a `--accent` y sumar sombra/relleno; no subir a 1.5/2px (salta el layout y se ve pesado). Foco: anillo `box-shadow` adicional, no más grosor.
- **ZR-15 · Radio de card visible en piezas grandes.** `--r-card` es 12px (escala web). En decks/PDF/piezas físicamente grandes, subir a **≥16px** para que el redondeo se lea intencional y no "cuadrado".
- **ZR-16 · Contenido nunca encima del footer.** Reservar una banda: `padding-bottom` mayor que la altura del footer (pager/logo). Un contenedor `flex:1` crece hasta el padding; si el footer vive ahí, se encima. Aplica a TODAS las láminas, no solo donde se nota.

## F · Componentes e interacción

- **ZR-17 · Profundidad por superficie + hairline, no por sombra pesada.** En piezas estáticas (PDF/deck), los cards van **sin drop shadow**: se definen por el hairline redondeado y el contraste de superficie (ver ZR-08). La sombra sobre fondo casi blanco deja un marco cuadrado en las esquinas del bounding box.
- **ZR-18 · Foco fino.** Anillo `box-shadow: 0 0 0 1px var(--accent)` + transición `.18s cubic-bezier(.16,1,.3,1)`. No outline duro de 2px.
- **ZR-19 · Iconos.** `stroke-width: 1.5` (checks chicos 1.75). Estilo lucide, monolínea.
- **ZR-20 · Decorativos solo del DS (dos motifs oficiales).** Zebra tiene dos patrones sancionados: el **dot-grid** (Hero, tintado por industria) y el **Stripes** (líneas diagonales, marca cebra). Ambos van **siempre detrás del contenido y NUNCA sobre los cards**. Stripes: ángulo/grosor/espaciado/opacidad en tokens `--motif-*`; en web usar la clase `.zebra-motif` (theme-aware: negro en light, blanco en dark); en PDF/deck usar la imagen `motif-stripes.png` / `motif-stripes-dark.png` por performance (ver ZR-24). No inventar motifs nuevos: si un adorno no está en el DS, se propone y documenta primero.

## G · Producción (PDF · decks · impresión)

- **ZR-21 · Preguntar el tema primero.** Antes de construir cualquier pieza, definir **light o dark**. Es la primera decisión, no un detalle asumido.
- **ZR-22 · Impresión = siempre light.** Cualquier vista imprimible (resumen, factura, guía) se imprime en claro; en `@media print` forzar los tokens light aunque la pantalla esté en dark, y anular filtros de dark (logo invertido vuelve a su color). Un deck de pantalla sí puede ir dark.
- **ZR-23 · PDF ligero: fuentes ESTÁTICAS.** Auto-hospedar woff2 de pesos fijos (`@fontsource/inter`, `@fontsource/jetbrains-mono`) y `@font-face` con `src:url(local)`. NUNCA cargar las fuentes variables de Google Fonts vía `<link>`: Chrome las incrusta como **Type 3 duplicadas por página** (40+ objetos), el PDF pesa más y tarda en renderizar. Estáticas → CID TrueType, una vez. (Diagnóstico: `pdffonts archivo.pdf` no debe mostrar decenas de Type 3.)
- **ZR-24 · Motif como imagen, no como gradiente repetido.** Un patrón en CSS `repeating-linear-gradient` se emite como cientos de rectángulos vectoriales por página. Pre-render una sola imagen PNG (transparente, optimizada con pngquant) y reusarla como `background`; el PDF la deduplica. La opacidad final la da el CSS.
- **ZR-25 · Mirror correcto light ↔ dark.** Los tokens por variable se invierten solos. A mano hay que cuidar: (a) **logo** → invertir a blanco en dark (ZR-12); (b) **tarjetas de énfasis** que en light eran negras se invierten a **blancas con texto oscuro** en dark (no se quedan negras, desaparecen); (c) sección = `--bg` y card = `--surface` más clara (ZR-08); (d) cada patrón necesita su variante de color.
- **ZR-26 · QA antes de entregar (producción).** Rasterizar las páginas (`pdftoppm -png`) y revisarlas una por una; verificar `pdffonts` (sin decenas de Type 3) y que nada se encime ni desborde. Verificar con evidencia, no asumir.

## H · Movimiento y accesibilidad

- **ZR-27 · Reduced-motion sin contenido invisible.** El observer/JS que revela contenido **siempre corre**; la *transición* se gatea por `@media (prefers-reduced-motion)`. Nunca dejar contenido oculto esperando una animación que no se ejecuta.
- **ZR-28 · Foco y target visibles.** Foco siempre visible (ZR-18), tamaño de touch target adecuado, cumplir WCAG AA como mínimo.

---

### Cómo citar y crecer

- Cita por ID: "esto rompe **ZR-08**".
- Para agregar una regla: siguiente número libre en su grupo; nunca renumerar las existentes.
- Si una regla deja de aplicar, márcala como ~~obsoleta~~ con fecha; no borres el ID.
