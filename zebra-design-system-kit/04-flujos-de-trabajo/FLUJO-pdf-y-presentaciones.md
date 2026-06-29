# Flujo · PDF y presentaciones (decks)

Para entregables estáticos exportados a PDF (propuestas, decks de venta, reportes).
Recomendado: HTML + CSS → PDF con Chrome headless (`--print-to-pdf`). Mismo criterio en cualquier motor.

## 0. Antes de nada
- **Pregunta el tema: light o dark** (ZR-21). Deck de pantalla puede ir dark; si se va a imprimir, light (ZR-22).

## 1. Preparar (lo que hace ligero y correcto al PDF)
1. **Fuentes ESTÁTICAS auto-hospedadas** (ZR-23). Descarga woff2 de pesos fijos y enláza­las con `@font-face local`:
   - Inter 400/600/700 · JetBrains Mono 400/500/600 (p. ej. de `@fontsource/*` por jsDelivr).
   - NUNCA el `<link>` de Google Fonts (fuentes variables → Type 3 duplicadas → PDF pesado y lento).
2. Define los tokens del tema en `:root` (toma valores de `01-design-system/tokens.css`).
3. Tamaño de lámina: 16:9 = `@page { size: 13.333in 7.5in; margin:0 }`; cada slide a esas medidas, `page-break-after:always`.

## 2. Construir cada lámina
- **Logo**: en el footer SIEMPRE (ZR-13); proporción intacta, `align-self:flex-start` + una sola dimensión (ZR-11); en dark invertido a blanco con `filter:invert(1)` (ZR-12).
- **Cards**: radio ≥16px (ZR-15), **sin drop shadow** (ZR-17), hairline 1px, y card de distinto color que su sección (ZR-08).
- **Reservar banda de footer**: `padding-bottom` mayor que el footer para que el contenido `flex:1` no se encime (ZR-16).
- **Motif**: si usas el dot-grid, como UNA imagen reutilizada, no como gradiente repetido (ZR-24); detrás del contenido (`z-index:-1` + `isolation:isolate`), jamás sobre los cards.
- **Tarjetas de énfasis**: en light = negras con texto blanco; en dark = blancas con texto oscuro (mirror, ZR-25).
- Tipografía: Inter + JetBrains Mono (eyebrows mono mayúscula); semibold headings, 700 cifras (ZR-09/10).
- Copy coherente con la tesis (ZR-01); sin em dash/emoji (ZR-02/03).

## 3. Exportar
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-pdf-header-footer --no-margins \
  --print-to-pdf="salida.pdf" --virtual-time-budget=4000 "file:///ruta/deck.html"
```

## 4. QA de producción (obligatorio, ZR-26)
```bash
pdffonts salida.pdf      # NO debe mostrar decenas de Type 3 (solo unas pocas CID TrueType)
pdfimages -list salida.pdf
pdftoppm -png -r 90 salida.pdf pg   # rasteriza y revisa cada página: nada encimado ni desbordado
```
Luego corre **FLUJO-QA-antes-de-entregar.md**.
