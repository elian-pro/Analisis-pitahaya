# Flujo · Documento (propuesta · informe · brief · cotización)

Documentos de texto largo con identidad de Zebra. Pueden vivir como HTML→PDF o en plantilla.

## 1. Preparar
- Tema: documentos suelen ir **light** (se imprimen / se leen como papel). Fuerza light en `@media print` (ZR-22).
- Fuentes estáticas si exportas a PDF (ZR-23). Inter para cuerpo, JetBrains Mono para etiquetas/datos.
- Toma tokens de `01-design-system/tokens.css`.

## 2. Estructura y jerarquía
- Una sola escala tipográfica (la del DS). Headings semibold 600; cifras 700 (ZR-10).
- Eyebrows/labels en JetBrains Mono mayúscula con letter-spacing.
- Cuerpo en `--text-2`; énfasis en `--text`. Nunca hex fijo (ZR-06).
- Tablas y bloques: hairline 1px, fondo recesado para destacar (ZR-08), sin sombras pesadas (ZR-17).

## 3. Marca
- **Encabezado y/o footer con el wordmark** de Zebra (ZR-13), proporción intacta (ZR-11).
- Monocromático (ZR-05). Decorativo solo del DS (ZR-20).
- Copy: sin em dash (ZR-02), sin emojis → SVG (ZR-03), género-neutro (ZR-04), coherente (ZR-01).

## 4. Cerrar
- Revisa contraste AA (ZR-07).
- Corre **FLUJO-QA-antes-de-entregar.md**. Si es PDF, además el QA de producción (ZR-26).
