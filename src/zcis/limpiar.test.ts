import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limpiarOferta } from './limpiar';

// Los dos documentos de abajo reproducen la ESTRUCTURA y las marcas exactas de
// las ofertas reales de ZCIS (Sofía y Maraya), con el cuerpo recortado: lo que
// hay que probar son las marcas, no el catálogo del cliente. La oferta completa
// es material confidencial y no tiene por qué vivir en el repositorio.
//
// Las diferencias entre los dos no son de estilo, son las que rompen un limpiador
// escrito contra un solo ejemplo:
//   · Sofía titula en caja mixta ("## Prueba"), Maraya en mayúsculas ("## PRUEBA").
//   · Sofía pone la marca al principio del párrafo, Maraya dentro y con dos puntos.
//   · Maraya se titula "DOCUMENTO DE TRABAJO" y firma con una línea en negrita.

const SOFIA = `# Oferta Sofia Boutique Condos

---

## Que vende

Fracciones vitalicias de propiedad en un resort turistico en Tulum, operado por
un equipo profesional.

---

## Diferenciadores

- **Operacion incluida en el modelo:** no es un servicio adicional que el dueno
  contrata despues.
- **Entrega marzo 2027:** fecha de entrega declarada.

---

## Prueba

[ASUNCION A VALIDAR] El brief no incluye numeros de ocupacion proyectada,
porcentaje de reparto de rentas, proyectos entregados anteriormente por el
desarrollador, ni testimonios de compradores existentes.

---

## Precio y condiciones

- Precio de entrada desde **80,000 USD**
- Modalidad: fraccion vitalicia de propiedad

[ASUNCION A VALIDAR] El brief no especifica esquema de pagos, enganche,
financiamiento disponible, ni condiciones de salida o reventa de la fraccion.

---

## Pendientes a validar

1. Porcentaje exacto de reparto de rentas entre propietarios y operadora.
2. Mecanismo legal que respalda la titularidad fraccional.

---

*Documento elaborado exclusivamente con informacion del brief. Todo dato marcado
como [ASUNCION A VALIDAR] debe confirmarse con el cliente antes de usarse en
comunicacion publica.*`;

const MARAYA = `# OFERTA MARAYA · DOCUMENTO DE TRABAJO
**Agente de Oferta Zebra · Extracción desde Brief Maestro**

---

## QUE VENDE

Terrenos residenciales dentro de una privada planeada en Cancún, Quintana Roo.

---

## DIFERENCIADORES

**Densidad controlada**
773 terrenos en total. El brief usa el termino "exclusivos", lo que implica una
escala limitada dentro de una ciudad de alta demanda. [ASUNCION A VALIDAR: el
brief usa el adjetivo "exclusivos" pero no define criterio de exclusividad.]

**Servicios incluidos a pie de lote**
Luz subterránea, agua con Aguakan, alumbrado publico y barda perimetral.

---

## PRUEBA

**Sobre Cancún como mercado:**
- 55 años de crecimiento documentado
- Plusvalía promedio anual presentada: 13%

---

## PENDIENTES A VALIDAR

1. **Precio por metro cuadrado y precio total por terreno.** No esta en el brief.

---

*Documento producido por el Agente de Oferta Zebra. Todos los datos provienen
exclusivamente del Brief Creativo Maestro de Maraya.*`;

test('no sobrevive ninguna marca de nota interna', () => {
  for (const [nombre, doc] of [['Sofía', SOFIA], ['Maraya', MARAYA]] as const) {
    const out = limpiarOferta(doc);
    assert.ok(!/asunci[oó]n a validar/i.test(out), `${nombre}: quedó una marca de asuncion`);
    assert.ok(!/pendientes a validar/i.test(out),  `${nombre}: quedó la seccion de pendientes`);
    assert.ok(!/documento (elaborado|producido)/i.test(out), `${nombre}: quedó la procedencia`);
  }
});

test('la seccion que era solo una asuncion desaparece entera', () => {
  // En Sofía, "## Prueba" es íntegramente una nota: sin contenido no hay
  // seccion. Un titulo huerfano en el contexto invita a Claude a comentar el
  // hueco, que es justo lo que se quiere evitar.
  const out = limpiarOferta(SOFIA);
  assert.ok(!/##\s*Prueba/i.test(out), 'quedó el titulo de una seccion vacia');
});

test('la seccion con datos reales se conserva aunque se llame igual', () => {
  // No se borra por llamarse "Prueba": en Maraya tiene cifras de mercado.
  const out = limpiarOferta(MARAYA);
  assert.match(out, /##\s*PRUEBA/);
  assert.match(out, /55 años de crecimiento documentado/);
});

test('una marca dentro del parrafo no se lleva el parrafo por delante', () => {
  // El caso que rompe borrar por parrafos: la frase de antes es un diferenciador.
  const out = limpiarOferta(MARAYA);
  assert.match(out, /773 terrenos en total/);
  assert.match(out, /escala limitada dentro de una ciudad de alta demanda\./);
  assert.ok(!/no define criterio/.test(out));
});

test('un parrafo que era solo la nota no deja un hueco', () => {
  const out = limpiarOferta(SOFIA);
  // El precio sigue, la nota que lo seguia no.
  assert.match(out, /80,000 USD/);
  assert.ok(!/esquema de pagos, enganche/.test(out));
  assert.ok(!/\n{3,}/.test(out), 'quedaron lineas en blanco de mas');
  assert.ok(!/---\s*\n\s*---/.test(out), 'quedaron separadores huerfanos');
});

test('el titulo conserva la marca comercial y pierde la coletilla de borrador', () => {
  // El nombre del producto es lo que hace que la transcripcion escriba
  // "Sofia Boutique Condos" y no algo que suene parecido.
  assert.match(limpiarOferta(SOFIA),  /# Oferta Sofia Boutique Condos/);
  assert.match(limpiarOferta(MARAYA), /# OFERTA MARAYA\n/);
  assert.ok(!/DOCUMENTO DE TRABAJO/i.test(limpiarOferta(MARAYA)));
  assert.ok(!/Agente de Oferta Zebra/i.test(limpiarOferta(MARAYA)));
});

test('la negrita de un subtitulo no se confunde con una firma', () => {
  // Las dos son lineas enteras en asteriscos; solo la cursiva marca procedencia.
  const out = limpiarOferta(MARAYA);
  assert.match(out, /\*\*Densidad controlada\*\*/);
  assert.match(out, /\*\*Sobre Cancún como mercado:\*\*/);
});

test('un texto sin marcas se devuelve como estaba', () => {
  // El contexto escrito a mano tambien pasa por aqui si alguien lo re-importa.
  const plano = 'Vende bodegas industriales en Uman, Yucatan, a empresas locales.';
  assert.equal(limpiarOferta(plano).trim(), plano);
});
