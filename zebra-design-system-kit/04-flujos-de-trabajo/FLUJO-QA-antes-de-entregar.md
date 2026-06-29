# Flujo · QA antes de entregar (checklist universal)

Pasa esta lista antes de dar por terminada cualquier pieza (web, PDF, deck, documento).
Verifica con evidencia (míralo / mídelo), no por intuición.

## Marca y mensaje
- [ ] El copy es coherente con la tesis; nada contradice el mensaje (ZR-01).
- [ ] Sin em dash (ZR-02), sin emojis (SVG en su lugar) (ZR-03), género-neutro (ZR-04).
- [ ] El logo está presente donde corresponde (footer/encabezado) (ZR-13).
- [ ] El logo conserva su proporción; en dark está invertido a blanco (ZR-11, ZR-12).

## Color, superficie, tipografía
- [ ] Monocromático; el amarillo no aparece como chrome (ZR-05).
- [ ] Texto por token, no hex fijo; se ve bien en el tema elegido (ZR-06).
- [ ] Contraste AA; sin `ink-400` como texto (ZR-07).
- [ ] Card y su sección son de distinto color; la card luce (ZR-08).
- [ ] Inter + JetBrains Mono; headings 600, cifras 700 (ZR-09, ZR-10).

## Layout
- [ ] Bordes hairline 1px; estados activos por color, no por grosor (ZR-14).
- [ ] Radio de card adecuado (≥16px en piezas grandes) (ZR-15).
- [ ] Nada de contenido encima del footer; banda reservada (ZR-16).
- [ ] En estático, cards sin drop shadow (solo hairline) (ZR-17).
- [ ] Decorativo solo del DS (dot-grid); nada inventado (ZR-20).

## Producción (solo PDF/deck)
- [ ] Se preguntó/definió el tema antes de construir (ZR-21).
- [ ] Fuentes estáticas: `pdffonts` no muestra decenas de Type 3 (ZR-23).
- [ ] Motif como imagen, no gradiente repetido (ZR-24).
- [ ] Mirror light↔dark correcto (logo, tarjetas de énfasis, superficie) (ZR-25).
- [ ] Páginas rasterizadas y revisadas una por una; nada desbordado (ZR-26).
- [ ] Vista imprimible forzada a light (ZR-22).

## Accesibilidad
- [ ] Foco visible y fino (ZR-18); targets adecuados (ZR-28).
- [ ] Reduced-motion no oculta contenido (ZR-27).

> Si algo falla, no se entrega. Reporta con honestidad lo que falte.
