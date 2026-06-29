# Flujo · Página web (landing / sitio / app)

Stack de referencia: **Astro + Tailwind**. El mismo criterio aplica a cualquier framework.

## 1. Preparar
1. Copia `01-design-system/tokens.css` a tu proyecto e impórtalo global. Es la fuente única; no redefinas colores a mano.
2. Carga **Inter** + **JetBrains Mono**. En web puedes usar el `<link>` de Google Fonts; en PDF/deck NO (ver el otro flujo, ZR-23).
3. Decide el tema: ¿light o dark? (ZR-21). El sitio de Zebra es light por defecto; dark solo en el showcase.

## 2. Construir
- Texto solo con tokens `--text` / `--text-2` / `--accent` (ZR-06). Nunca hex fijo.
- Monocromático (ZR-05): negro, blanco, rampa ink. Amarillo nunca como chrome.
- Headings semibold 600; cifras 700 (ZR-10).
- Cards: hairline 1px, radio 12px web, y **fondo recesado detrás** (`--surface-2`) para que la card blanca luzca (ZR-08).
- Estados activos/selección: cambia color del borde a `--accent` + sombra, nunca engrosar (ZR-14).
- Foco fino animado (ZR-18). Iconos lucide stroke 1.5 (ZR-19).
- Decorativo: solo dot-grid del DS (ZR-20).
- Copy: sin em dash (ZR-02), sin emojis → SVG (ZR-03), género-neutro (ZR-04).

## 3. Accesibilidad
- Contraste AA siempre; nunca `ink-400` como texto (ZR-07).
- Animaciones: el reveal corre siempre, la transición se gatea por `prefers-reduced-motion` (ZR-27).

## 4. Cerrar
- Corre el **FLUJO-QA-antes-de-entregar.md**.
- Si hay vista imprimible, fuérzala a light en `@media print` (ZR-22).
