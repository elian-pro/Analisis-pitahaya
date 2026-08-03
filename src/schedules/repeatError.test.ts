import { test } from 'node:test';
import assert from 'node:assert';
import { isRepeatError, errorDetail, advisorMode } from './store';

// Cuando una automatización falla dos veces por lo mismo, el aviso de Chat manda
// un recordatorio corto en vez de repetir el error completo. Si esta comparación
// se rompe, el chat vuelve a llenarse de avisos idénticos día tras día.

test('mismo error que la vez pasada → es repetición', () => {
  const s = { last_status: 'error' as const, last_error: 'Sin asesores activos.' };
  assert.strictEqual(isRepeatError(s, 'Sin asesores activos.'), true);
});

test('error distinto → aviso completo', () => {
  const s = { last_status: 'error' as const, last_error: 'Sin asesores activos.' };
  assert.strictEqual(isRepeatError(s, 'No se pudo leer el Sheet.'), false);
});

test('el intento anterior salió bien → aviso completo', () => {
  const s = { last_status: 'ok' as const, last_error: 'Sin asesores activos.' };
  assert.strictEqual(isRepeatError(s, 'Sin asesores activos.'), false);
});

test('primer fallo de la automatización → aviso completo', () => {
  assert.strictEqual(isRepeatError({}, 'Sin asesores activos.'), false);
});

test('un error largo se compara ya recortado, como se guardó', () => {
  const largo = 'x'.repeat(600);
  const s = { last_status: 'error' as const, last_error: errorDetail(largo) };
  assert.strictEqual(s.last_error.length, 500);
  assert.strictEqual(isRepeatError(s, largo), true);
});

test('error vacío se normaliza igual al guardar y al comparar', () => {
  const s = { last_status: 'error' as const, last_error: errorDetail('') };
  assert.strictEqual(isRepeatError(s, ''), true);
});

// ── Cómo se resuelve la lista de asesores ────────────────────────────────────

test('"all" = todo el roster del cliente', () => {
  assert.strictEqual(advisorMode('all'), 'all');
});

test('"active" = solo los que tuvieron llamadas', () => {
  assert.strictEqual(advisorMode('active'), 'active');
});

test('lista con nombres = esos nombres', () => {
  assert.strictEqual(advisorMode(['Ana', 'Luis']), 'explicit');
});

test('lista vacía (automatizaciones viejas) = solo los que tuvieron llamadas, no "nadie"', () => {
  assert.strictEqual(advisorMode([]), 'active');
});
