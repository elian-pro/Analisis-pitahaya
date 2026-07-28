# Auditoría UX/UI: formulario "Nuevo cliente"

Diagnóstico del modal **Ajustes → Clientes → Nuevo cliente** y propuesta de rediseño para reducir carga cognitiva y errores de configuración.

**Estado actual:** 17 campos en un modal de scroll único, 8 obligatorios y 9 opcionales, sin jerarquía ni validación progresiva.

---

## 1. Áreas de oportunidad

### 1.1 Todo en un solo scroll infinito
17 campos en un modal sin indicador de progreso. El usuario no sabe cuánto falta ni dónde está parado. El botón "Guardar cliente" permanece visible desde el primer momento, pero en la práctica es inalcanzable hasta llegar al final del formulario.

### 1.2 No hay jerarquía entre obligatorio y opcional
Los campos obligatorios están intercalados con los opcionales. El asterisco es el único diferenciador y se pierde en texto de 11px. La sección completa "Radar de Objeciones" es opcional y ocupa aproximadamente el 30% del formulario.

### 1.3 Dependencias invisibles
Existen cadenas de dependencia que no se comunican en ningún momento:

- Las columnas dependen de haber cargado la pestaña.
- La pestaña depende del link de la hoja de Google.
- "Duración mínima (Radar)" depende de tener configurada la columna de duración.

Los selects aparecen habilitados y vacíos, invitando al error.

### 1.4 Campos autogenerados con peso visual permanente
Carpeta de sidecars, Carpeta Drive de Radar y Carpeta de respaldo Radar se crean solas. Los tres ocupan el mismo espacio y jerarquía visual que "Nombre del cliente", que sí es crítico.

### 1.5 Los prompts están subdimensionados
Son el campo de mayor valor del formulario, porque definen el output completo del sistema, y se presentan como dos textareas vacíos con placeholder genérico. Sin plantillas, sin ejemplos, sin contador de caracteres. Un usuario nuevo no tiene forma de saber qué escribir ahí.

### 1.6 Feedback ausente
No hay validación en vivo, ni confirmación de que la hoja es accesible, ni preview de las columnas detectadas. El único momento de verdad ocurre al pulsar "Guardar".

### 1.7 Contraste y densidad tipográfica
Labels en gris sobre negro, cerca del límite de contraste AA. Las notas explicativas debajo de cada campo llegan a ocupar 3 líneas y triplican la altura visual del campo sin aportar valor en la mayoría de los casos.

### 1.8 El selector de Drive rompe el contexto
Modal sobre modal. Al volver, el campo sigue mostrando el placeholder "Se crea sola al elegir la ubicación" en vez de la ruta que el usuario acaba de elegir.

---

## 2. Propuesta de rediseño

### 2.1 Wizard de 3 pasos

```
[1] Datos            [2] Fuente           [3] Análisis
Nombre               Hoja de Google       Prompt individual
Ubicación Drive      Pestaña              Prompt general
                     Mapeo de columnas    ▸ Radar (toggle)
                                          ▸ Opciones avanzadas
```

- Cada paso valida antes de permitir avanzar.
- Barra de progreso en la parte superior.
- El botón primario dice "Siguiente" y solo cambia a "Guardar cliente" en el paso 3.

### 2.2 Progressive disclosure

| Ahora | Propuesta |
|---|---|
| Carpeta de sidecars visible | Dentro de "Opciones avanzadas" (colapsado) |
| Radar: 5 campos siempre visibles | Toggle "Activar Radar de Objeciones" que despliega la sección |
| Carpeta Drive y respaldo de Radar | Dentro del Radar, en avanzadas |
| Máx. caracteres y frases excluidas | Avanzadas, con el default visible como texto: "3000 caracteres · sin filtros" |

**Resultado:** de 17 campos visibles a 8 en el flujo feliz.

### 2.3 Mapeo de columnas como paso guiado

En lugar de 7 selects vacíos, después de cargar la pestaña:

```
Detectamos 12 columnas en "Llamadas Mayo"

Fecha          →  [Fecha de llamada    ▾]  ✓ auto-detectada
Asesor         →  [Agente              ▾]  ✓ auto-detectada
Calificación   →  [Elige una columna   ▾]
Análisis       →  [Elige una columna   ▾]
Transcripción  →  [Transcript          ▾]  ✓ auto-detectada

Opcionales: Duración · Grabación
```

Auto-match por similitud de nombre (fecha/date, asesor/agente/vendedor, transcripción/transcript). Ahorra hasta 5 de 7 decisiones.

### 2.4 Estados de dependencia explícitos

- Los selects de columnas aparecen **deshabilitados con mensaje**: "Carga una pestaña primero", en vez de vacíos y clickeables.
- "Duración mínima (Radar)" deshabilitado con nota: "Requiere columna de duración".
- Al pegar el link de la hoja, validación inmediata:
  - ✓ "Acceso confirmado · 3 pestañas"
  - ✗ "Sin acceso: comparte la hoja con la cuenta central"

### 2.5 Prompts con andamiaje

Reemplazar el textarea vacío por:

```
PROMPT INDIVIDUAL
[Empezar desde plantilla ▾]  ← Inmobiliaria · Ventas B2B · Call center · En blanco

┌──────────────────────────────────┐
│ Eres un analista de ventas...    │
│                                  │
└──────────────────────────────────┘
1,240 caracteres · Define el PDF de cada asesor
```

### 2.6 Confirmación antes de guardar

Paso final con resumen legible, no un botón a ciegas:

```
Sofia Fractional Residences

Se crearán en  Zebra / Clientes / 2026 /
   📁 Sofia Fractional Residences | Analisis de llamadas IA
   📁 Sofia Fractional Residences | Radar de Objeciones IA

Fuente     Hoja "Llamadas 2026" · pestaña Mayo
Columnas   5 de 5 obligatorias mapeadas
Radar      Activo · mínimo 200s

[ Atrás ]                        [ Crear cliente ]
```

### 2.7 Ajustes de UI

- Labels a 12px con contraste mínimo 4.5:1.
- Texto de ayuda colapsado tras un ícono de información con tooltip, no siempre visible.
- El campo de ubicación de Drive muestra la ruta seleccionada como chip (`Zebra / Clientes / 2026  ✕`) en lugar del placeholder.
- Sticky footer con contador: "Paso 2 de 3 · 2 campos pendientes".
- Ancho del modal a 720px en el paso de columnas, para que los pares de selects quepan cómodos.

---

## 3. Impacto estimado

| Métrica | Antes | Después |
|---|---|---|
| Campos visibles en flujo feliz | 17 | 8 |
| Decisiones en mapeo de columnas | 7 | 2 (con auto-detección) |
| Momento de validación | Solo al guardar | En cada paso |
| Usuarios que ven campos del Radar sin usarlo | 100% | 0% |

---

## 4. Priorización sugerida

| Prioridad | Cambio | Esfuerzo | Impacto |
|---|---|---|---|
| P0 | Toggle del Radar y sección de avanzadas | Bajo | Alto |
| P0 | Selects de columnas deshabilitados con mensaje | Bajo | Alto |
| P1 | Validación en vivo del link de la hoja | Medio | Alto |
| P1 | Chip con la ruta de Drive seleccionada | Bajo | Medio |
| P1 | Auto-detección de columnas | Medio | Alto |
| P2 | Wizard de 3 pasos | Alto | Alto |
| P2 | Plantillas de prompts | Medio | Alto |
| P3 | Ajustes de contraste y tipografía | Bajo | Medio |
