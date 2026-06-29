# Kit del Design System de Zebra — Virtual Stripes 26

> Una sola fuente de verdad para que **todo** lo que produce Zebra (páginas, PDFs,
> presentaciones, documentos, email, social) se vea, se lea y se sienta como Zebra.

Si es tu primera vez, lee este archivo completo (2 min) y luego abre las carpetas en orden.

---

## Dónde vive y cómo instalarlo

El kit y el showcase navegable viven en **https://zebra.lopezulloa.com** (ruta `/design-system`).
Para bajar la última versión:

```bash
curl -O https://zebra.lopezulloa.com/zebra-design-system-kit.zip
unzip zebra-design-system-kit.zip
open zebra-design-system-kit/00-EMPIEZA-AQUI.md
```

O usa el botón **"Descargar el kit (.zip)"** en https://zebra.lopezulloa.com/design-system.

---

## Qué es esto

El Design System de Zebra no es solo una paleta. Es **el sistema** que unifica la marca en
cualquier formato: los mismos tokens, la misma tipografía, las mismas reglas de construcción.
Tu trabajo al usar este kit es simple: **no inventes, hereda.** Si algo no está en el kit,
no lo agregues por tu cuenta; pregunta o revisa la Memoria para entender el criterio.

## El ritmo del kit (léelo en orden 00 → 04)

| Carpeta | Qué contiene | Cuándo la usas |
|---|---|---|
| `00-EMPIEZA-AQUI.md` | Este mapa. | Una vez, al inicio. |
| `01-design-system/` | **El sistema.** Tokens (CSS + JSON DTCG), referencia atómica de color/tipo/componentes/marca, y el logo oficial. | Para tomar valores exactos: colores, radios, sombras, pesos. |
| `02-memoria-del-ds/` | **El porqué.** Las decisiones de diseño y su evolución. | Cuando dudes "¿por qué es así?" antes de cambiar algo. |
| `03-reglas-de-construccion/` | **Las reglas (`ZR-##`).** Lo que SÍ y lo que NUNCA, agrupado por tema y citable por ID. | Mientras construyes, como checklist. |
| `04-flujos-de-trabajo/` | **Los flujos.** Paso a paso para página web, PDF/presentación, documento, y el QA final. | Al empezar y al cerrar cada pieza. |

## Cómo se relacionan las tres capas

```
01 · DESIGN SYSTEM     →  los materiales   (qué colores, qué tipos, qué tokens)
02 · MEMORIA           →  el criterio      (por qué son así; no romperlo sin entenderlo)
03 · REGLAS            →  la ejecución     (cómo aplicarlos sin errores; checklist)
04 · FLUJOS            →  el orden         (en qué secuencia para cada formato)
```

Regla mental: **DS = materiales · Memoria = criterio · Reglas = ejecución · Flujos = orden.**

## Arranque rápido por formato

- **Página web** → `04-flujos-de-trabajo/FLUJO-pagina-web.md`. Importa `tokens.css`, usa Inter + JetBrains Mono.
- **PDF / presentación** → `04-flujos-de-trabajo/FLUJO-pdf-y-presentaciones.md`. Pregunta primero el tema (light/dark), fuentes estáticas.
- **Documento (propuesta/informe)** → `04-flujos-de-trabajo/FLUJO-documento.md`.
- **Antes de entregar cualquier cosa** → `04-flujos-de-trabajo/FLUJO-QA-antes-de-entregar.md`.

## Lo no negociable (resumen de 6 líneas)

1. Monocromático: negro `#0A0A0A`, blanco, rampa de grises. El amarillo solo es contenido de demo de video, nunca chrome.
2. Tipografía: **Inter** (texto) + **JetBrains Mono** (eyebrows/labels en mayúscula). Headings semibold (600).
3. Borde **hairline 1px** siempre; la profundidad va por superficie y sombra, no por engrosar líneas.
4. El **logo nunca se distorsiona** ni se recolorea (en dark se invierte a blanco).
5. **Pregunta el tema** (light o dark) antes de construir.
6. **No inventes** elementos decorativos: usa solo los del DS.

---

Fuente de verdad viva: el showcase navegable **Virtual Stripes** en
**https://zebra.lopezulloa.com/design-system**. Si el código y un documento se contradicen,
gana el código y el documento se corrige.
