<!--
  DOCUMENTO GENERADO AUTOMÁTICAMENTE.
  Lo reescribe Claude en cada cambio de código (ver .github/workflows/update-doc.yml
  y scripts/generate-doc.mjs). No lo edites a mano: tus cambios se sobrescribirán
  en el próximo commit. Si quieres cambiar el tono o la estructura, edita el
  prompt en scripts/generate-doc.mjs.
-->

# Zebra Reports — Analizador de llamadas de venta

*Documento explicativo. No es un manual de uso ni de instalación: describe qué es la herramienta, qué problema resuelve, cómo lo resuelve y con qué criterios.*

---

## 1. Qué es

Zebra Reports es un **asistente automático que evalúa el desempeño de los asesores comerciales a partir de sus llamadas de venta**. Toma las llamadas que ya están registradas y transcritas en una hoja de cálculo de Google, las lee, las interpreta y produce un **reporte en PDF** con calificaciones, fortalezas, debilidades, objeciones, ejemplos concretos y recomendaciones puntuales para cada asesor, más un reporte ejecutivo del equipo completo.

Todo esto ocurre **solo**: una vez configurado, cada cliente tiene una automatización que se dispara sola (por ejemplo, "cada martes a las 10:00 am analiza la semana pasada"), genera los reportes, los guarda en la carpeta de Google Drive del cliente y avisa por Google Chat cuando están listos.

En una frase: **convierte cientos de transcripciones de llamadas en un informe de coaching claro y accionable, sin que nadie tenga que leerlas una por una.**

---

## 2. Qué problema resuelve

Los equipos de venta generan **muchísima conversación** y muy poca lectura de esa conversación. Escuchar o leer cada llamada para saber quién está cerrando bien, quién no maneja las objeciones, o qué tan seguido se logra agendar el siguiente paso, es un trabajo lento, subjetivo y que casi nunca se hace de forma consistente.

Zebra Reports resuelve tres dolores concretos:

- **Volumen:** nadie tiene tiempo de revisar decenas o cientos de llamadas al mes. La herramienta las procesa todas.
- **Consistencia:** cada asesor se evalúa con **exactamente los mismos criterios**, definidos por el cliente, en lugar de depender del ojo de quien revise.
- **Continuidad:** compara cada periodo con el anterior, así que se ve la **evolución** (mejoró, se estancó o retrocedió), no solo una foto suelta.

El resultado es que un gerente comercial recibe, sin esfuerzo, un diagnóstico listo para usar en la sesión de retroalimentación con cada vendedor.

---

## 3. Cómo funciona (visión general)

El proceso, de principio a fin, sigue estos pasos:

1. **Se dispara la automatización.** Puede ser por calendario (semanal, mensual o una fecha única) o de forma manual con un botón de "Ejecutar ahora". El sistema revisa cada minuto si a alguna automatización le toca correr y se pone al día si hubo un reinicio.

2. **Se define el periodo.** Si es semanal, analiza la semana anterior completa (lunes a domingo). Si es mensual, el mes anterior. Si es de fecha única, el periodo exacto que se eligió.

3. **Se arma la lista de asesores.** Normalmente "todos" significa **el roster de asesores que el cliente configuró**, no cualquier nombre que aparezca en la hoja. Esto evita meter en el reporte a personas que no son del equipo (leads mal capturados, gente de otras áreas, etc.).

4. **Se leen las llamadas** desde la hoja de Google del cliente, tomando solo las del periodo.

5. **Se filtran las llamadas** para quedarse con las que valen la pena analizar (más sobre esto en la sección 5).

6. **Se agrupan las llamadas por asesor.**

7. **Se analiza a cada asesor.** Para cada uno se calculan métricas exactas a partir de su calificación, se busca su reporte del periodo anterior para comparar, y se le pide a la inteligencia artificial que lea sus transcripciones y produzca el análisis cualitativo. Con eso se arma su PDF individual.

8. **Se genera el reporte ejecutivo del equipo**, que resume a todos los asesores juntos.

9. **Se unen todos los PDF** (primero el del equipo, luego los individuales) en un solo documento, que se **sube a la carpeta de Drive del cliente**.

10. **Se guarda un respaldo de las métricas** de cada asesor, que servirá para la comparación del próximo periodo y para el tablero de evolución.

11. **Se avisa por Google Chat** con el enlace al reporte listo. Si algo falla, se avisa al canal de errores.

---

## 4. Los criterios del cliente (qué hace único a cada reporte)

Aquí está el corazón de la herramienta: **cada cliente define sus propias reglas**, y el análisis se adapta a ellas. No es un molde único. Lo que cada cliente configura incluye:

### a) De dónde salen los datos
Cada cliente indica cuál es su hoja de cálculo y **qué columna significa qué**: cuál tiene la fecha, cuál el nombre del asesor, cuál la calificación de la llamada, cuál el análisis previo (si existe), cuál la transcripción, cuál la duración y, opcionalmente, cuál el enlace a la grabación. Así el sistema sabe leer hojas con estructuras distintas.

### b) El contexto del negocio
El cliente describe **su empresa, su producto y su cliente ideal**. Por ejemplo, para uno de los clientes el contexto es: inversión en terrenos agrícolas con renta garantizada, dirigido a profesionales de 35 a 65 años que buscan ingresos pasivos. Ese contexto le permite a la IA entender de qué se está hablando en las llamadas.

### c) El guion esperado
Se define **cómo debería ser una buena llamada**, paso por paso. Por ejemplo: apertura cálida, descubrimiento de necesidades, presentación del proyecto, validación del perfil financiero, manejo de objeciones y cierre de un microcompromiso (agendar la siguiente reunión). El análisis mide qué tanto se acerca cada asesor a ese guion.

### d) Los criterios de evaluación
El cliente lista **qué habilidades importan** y para qué tipo de asesor. Por ejemplo, distingue entre un perfil que abre y conecta ("linner": escucha activa, empatía, detección de necesidades, manejo de objeciones, cierre de microcompromisos) y un perfil que cierra ("cerrador": validar el perfil financiero, tomar el control, usar autoridad/escasez/prueba social, lograr un siguiente paso claro).

### e) Notas y reglas especiales
Aquí se afinan detalles importantes, como: **no penalizar** algo que no corresponde a esa etapa de la venta, **verificar** si el asesor mencionó cierto programa o beneficio clave, o **cómo tratar el primer periodo** cuando todavía no hay con qué comparar.

En resumen, el reporte es fiel a **cómo vende cada empresa**, porque la empresa misma le dicta a la herramienta qué es "bueno" y qué es "mejorable".

---

## 5. Qué llamadas entran al análisis (filtros de calidad)

No todas las filas de la hoja se analizan. Antes de evaluar, el sistema descarta lo que ensuciaría el resultado:

- **Fuera del periodo:** solo se consideran las llamadas cuya fecha cae dentro de la semana o el mes que se está analizando.
- **Llamadas de prueba o irrelevantes:** el cliente puede definir **frases a excluir**; si la transcripción contiene una de esas frases, la llamada se ignora (sirve para sacar pruebas internas o conversaciones que no son ventas reales).
- **Llamadas demasiado cortas:** si se conoce la duración, las llamadas de **menos de 90 segundos** se descartan, porque no dan material suficiente para evaluar.
- **Transcripciones muy largas:** se recortan a un tope de caracteres que el cliente define, para mantener el análisis enfocado y eficiente.

Si un asesor del roster no tuvo ninguna llamada válida en el periodo, simplemente se omite de ese reporte (no aparece con datos inventados).

---

## 6. Cómo analiza la data

El análisis combina **dos formas de trabajar** que se complementan, y esto es importante para entender qué tan confiable es cada número:

### Lo que se calcula con exactitud (no lo decide la IA)
Las cifras "duras" salen directamente de la **columna de calificación** que el cliente ya tiene en su hoja, no de una interpretación. De ahí se obtienen:
- el **promedio** de calificación del asesor en el periodo,
- su calificación **mínima y máxima**,
- qué tan **dispersas** están sus llamadas (si es parejo o muy irregular),
- el **número de llamadas** analizadas.

A nivel de equipo, también se calculan de forma exacta el **promedio del equipo**, el **total de llamadas**, el **ranking** de asesores y la **variación contra el periodo anterior**. Estos números son objetivos y reproducibles.

### Lo que interpreta la inteligencia artificial
Para todo lo cualitativo, la herramienta le entrega a la IA (un modelo Claude) las transcripciones del asesor **junto con las reglas del cliente** (contexto, guion y criterios de la sección 4) y le pide un análisis estructurado. La IA es la que lee las conversaciones y determina cosas como: qué tipo de asesor es, qué objeciones aparecieron y si se resolvieron, qué tan seguido se logró el siguiente paso, cuánto habló el asesor frente al cliente, qué técnicas de persuasión usó, cuáles fueron sus fortalezas y debilidades, cuál fue su mejor y peor llamada, y qué debería hacer distinto.

### La comparación con el periodo anterior
Antes de analizar, el sistema **busca el reporte del periodo pasado** de ese mismo asesor. Si lo encuentra, se lo pasa a la IA para que señale mejoras o retrocesos, y además calcula la diferencia exacta de las métricas clave. Si no hay periodo anterior, el reporte lo marca como **"primer periodo de evaluación"** en vez de inventar una comparación.

### Salvaguardas de calidad
- El análisis **se reintenta hasta 3 veces** si la IA devuelve algo mal formado, y cada resultado se **valida** contra una estructura estricta antes de aceptarlo, para que el PDF nunca salga incompleto.
- Se le exige escribir en **español correcto** (con todas las tildes y la ñ) y con puntuación limpia.
- La "mejor llamada" que destaca la IA se **verifica** contra los datos reales para enlazar la grabación correcta; si algo no cuadra, se cae de vuelta a la llamada mejor calificada.

---

## 7. Qué contiene el PDF

El documento final tiene **dos tipos de reporte**.

### A) Reporte individual (uno por asesor)

Incluye, en lenguaje claro:

- **Encabezado:** nombre del asesor, periodo analizado y fecha de generación.
- **Tipo de asesor y nivel general:** por ejemplo "cerrador" con nivel *Élite* (85+), *Alto desempeño* (70–84), *Consistente* (55–69), *En progreso* (40–54) o *Punto de partida* (menos de 40). El nivel lo calcula el sistema a partir del score promedio, no lo elige la IA.
- **Calificación del periodo:** promedio, rango (mínimo a máximo), qué tan consistente fue y número de llamadas.
- **Comparativo con el periodo anterior:** cuánto subió o bajó en calificación, en logro del siguiente paso y en equilibrio de la conversación (o "primer periodo" si no aplica).
- **Resumen ejecutivo** del desempeño del asesor.
- **Criterios evaluados:** cada habilidad con su puntaje y porcentaje de cumplimiento.
- **Indicadores de conversación:** porcentaje de llamadas donde logra el siguiente paso, cuánto habló el asesor frente al cliente ("talk ratio"), promedio de preguntas que hace, objeciones por llamada y tasa de resolución.
- **Elementos del producto:** qué argumentos o beneficios mencionó y en qué porcentaje de llamadas, y cuáles está **desaprovechando**.
- **Objeciones:** por categoría, cuántas veces aparecieron, qué tan bien las resolvió, qué técnicas usó y **ejemplos textuales** de una respuesta efectiva y una fallida.
- **Objeciones peor manejadas** con un consejo concreto para cada una.
- **Técnicas de persuasión** ("sesgos": autoridad, escasez, prueba social, etc.): cuáles usa y con qué frecuencia, y cuáles no está aprovechando.
- **Desglose de cierres:** cuántas llamadas terminaron en apartado, cita de seguimiento, firma, fecha de decisión, o **sin ningún siguiente paso**.
- **Fortalezas y debilidades**, cada una con el porcentaje de llamadas en que aparece y el nivel de impacto.
- **Mejor y peor llamada** del periodo, con su calificación, el lead, una descripción y, cuando la hoja lo permite, el **enlace a la grabación**.
- **Recomendaciones priorizadas:** qué hacer, en qué área, con qué prioridad y qué métrica debería moverse.

### B) Reporte ejecutivo del equipo (uno por cliente)

Es la vista de gerencia e incluye:

- **Resumen ejecutivo** breve del periodo.
- **Tendencia del equipo:** mejora, estable, mixto, retroceso o primer mes.
- **Indicadores clave (KPIs):** el score de cada asesor y del equipo, con su variación y tendencia, más una o dos métricas críticas transversales del periodo.
- **Ranking de asesores**, del mejor al que más necesita apoyo.
- **Fortalezas del equipo y áreas de oportunidad.**
- **Mejores prácticas** detectadas, atribuidas al asesor que las ejecuta bien (para replicarlas).
- **Patrones de objeciones** comunes a todo el equipo, con su frecuencia y recomendación.
- **Recomendaciones dirigidas**, indicando a quién va cada una (a un asesor, al equipo o a la gerencia).

---

## 8. El tablero de evolución

Además del PDF de cada periodo, la herramienta guarda las métricas históricas y las muestra en un **tablero de evolución en el tiempo**. Ahí se puede ver cómo se mueven, periodo a periodo, la calificación promedio, el porcentaje de logro del siguiente paso y el equilibrio de la conversación, tanto **del equipo completo como de cada asesor**, y agruparlo por semana, mes, bimestre, trimestre, semestre o año.

Esto convierte los reportes sueltos en una **historia de progreso**: no solo "cómo le fue esta semana", sino "cómo viene evolucionando".

---

## 9. En síntesis

Zebra Reports toma la materia prima que las empresas ya generan —las transcripciones de sus llamadas— y la transforma, sin intervención humana, en **coaching accionable y consistente**. Lo hace midiendo con exactitud lo que es medible (las calificaciones) e interpretando con inteligencia artificial lo que es cualitativo (las conversaciones), **siempre bajo los criterios que cada cliente define para su propio negocio**, y comparando cada periodo con el anterior para mostrar la evolución. El producto final llega listo, en la carpeta del cliente, con un aviso cuando está disponible.
