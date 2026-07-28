# Revisión de la propuesta de rediseño (Stitch)

Contenido de esta carpeta: la auditoría UX, tres pantallas del wizard propuesto
(`screen.png` + `code.html`) y el `DESIGN.md` de identidad.

Veredicto corto: **la auditoría es buena y accionable; los mockups sirven como
referencia visual, no como código a integrar.**

---

## Lo que el diagnóstico acierta

Todo esto es real y verificable en el formulario actual:

- **17 campos en un scroll único** sin indicador de progreso.
- **Dependencias invisibles**: los selects de columnas aparecen habilitados y
  vacíos aunque no sirven de nada hasta cargar una pestaña.
- **El Radar ocupa ~30% del formulario** y es opcional para la mayoría.
- **Campos autogenerados con peso visual de campo crítico**: carpeta de
  sidecars, carpeta de Radar y carpeta de respaldo se crean solas, pero se ven
  igual de importantes que "Nombre del cliente".
- **El selector de Drive deja el campo con placeholder** en vez de mostrar la
  ruta elegida (punto 1.8 de la auditoría). Esto es un defecto real del código
  actual, no solo una opinión de diseño.

La tabla de priorización (P0 → P3) es sensata y se puede ejecutar por partes.

---

## Lo que NO se debe copiar tal cual

### 1. Los mockups son tema claro; la app es oscura
`DESIGN.md` define `surface: #f9f9f9` con negro sobre blanco, y las tres
pantallas están en claro. La app entera es oscura. Integrar las pantallas tal
cual dejaría un formulario blanco dentro de una app negra. Hay que **portar la
estructura, no los colores**.

### 2. Los tres pasos no coinciden entre sí
Cada mockup nombra los pasos distinto:

| Pantalla | Nombres de los pasos |
|---|---|
| Paso 1 | Datos · Conexión · Revisión |
| Paso 2 | Info · Fuente · Config |
| Paso 3 | Info básica · Integración · Análisis |

Además el paso 3 abandona el modal y se vuelve página completa, con footer de
sitio web ("© 2024 Zebra Systems Inc.", Privacy Policy, API Status) que no
existe ni tiene sentido en esta app. Son tres bocetos sueltos, no un flujo.

### 3. Inventa campos que el backend no tiene
El paso 3 muestra **"Tokens max: 256"** y **"Temperatura: 0.3"**. No existen en
`ClientConfig` ni hay nada que los consuma. Implementarlos es trabajo de
backend nuevo, no un rediseño.

El contador **"1,240 / 4,000"** sugiere un límite de 4000 caracteres en el
prompt que tampoco existe.

### 4. Contradice defaults reales
"Duración mínima (segundos): **15**". El default real es **200**
(`radar_min_duration_seconds`), y por buena razón: una llamada de 15 segundos no
tiene objeciones que analizar.

### 5. El copy del Radar es incorrecto
Dice *"Detecta y clasifica objeciones **en tiempo real durante las llamadas**"*.
El Radar es un reporte batch que se corre sobre transcripciones ya guardadas.
Ese texto haría que el equipo prometa al cliente algo que el producto no hace.

### 6. Pierde campos que sí se usan
No aparecen en ningún paso: frases excluidas, máx. caracteres de transcripción,
columnas de duración y grabación, carpeta de sidecars, carpeta de respaldo del
Radar, máx. caracteres del Radar. Varios pueden vivir en "avanzadas", pero
tienen que existir.

### 7. El toggle azul rompe su propia paleta
`DESIGN.md` declara monocromo estricto ("strictly monochromatic palette") y el
mockup del Radar usa un switch azul.

### 8. El código no es reutilizable aquí
Los `code.html` cargan **Tailwind por CDN**, Google Fonts y Material Symbols.
`index.html` es CSS plano sin build ni dependencias externas. Copiar ese HTML
significaría meter Tailwind al proyecto para una sola pantalla.

---

## Cómo aprovecharla

Orden recomendado, de mayor relación valor/esfuerzo a menor:

1. **Chip con la ruta de Drive elegida** — arregla un defecto real de hoy.
2. **Selects de columnas deshabilitados** con "Carga una pestaña primero".
3. **Toggle para activar el Radar** y colapsar sus 5 campos.
4. **"Opciones avanzadas" colapsado**: sidecars, frases excluidas, máx. caracteres.
5. **Auto-detección de columnas** por similitud de nombre (fecha/date,
   asesor/agente, transcripción/transcript).
6. **Resumen antes de guardar**, con los nombres reales de las carpetas.
7. **Wizard de 3 pasos** — el más caro; hacerlo solo si los anteriores no bastan,
   y con una nomenclatura única de pasos.

Los puntos 1 a 4 no requieren tocar el backend y caben en el modal actual, en
tema oscuro. El 7 es el que justifica rediseñar de verdad.
