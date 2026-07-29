import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientFileLabel, reportsFolderName, ensureClientFolders, type ClientConfig } from './manager';

test('clientFileLabel: el nombre corto manda; vacío cae al completo', () => {
  assert.equal(clientFileLabel({ name: 'Sofia Fractional Residences' }), 'Sofia Fractional Residences');
  assert.equal(clientFileLabel({ name: 'Sofia Fractional Residences', short_name: 'Sofia FR' }), 'Sofia FR');
  // Un corto en blanco no debe dejar sin nombre a carpetas y archivos.
  assert.equal(clientFileLabel({ name: 'Sofia', short_name: '   ' }), 'Sofia');
});

test('las carpetas se crean con el nombre corto', async () => {
  const calls: Array<[string, string]> = [];
  const out = await ensureClientFolders(
    { name: 'Sofia Fractional Residences', short_name: 'Sofia FR', parent_folder_id: 'UNIDAD' } as Partial<ClientConfig>,
    {},
    async (p, n) => { calls.push([p, n]); return 'id'; },
  );
  assert.equal(calls[0][1], reportsFolderName('Sofia FR'));
  assert.ok(out.folder_id);
});

// El renombrado en Drive solo toca lo que empieza por el nombre anterior, para
// no pisar archivos que alguien renombró a mano. google/drive arrastra a
// config/env, que aborta sin credenciales: se rellenan y se carga con require.
process.env.GOOGLE_SA_JSON    ||= '{}';
process.env.ANTHROPIC_API_KEY ||= 'test';
const { withNewPrefix } = require('../google/drive') as typeof import('../google/drive');

test('withNewPrefix: cambia el prefijo y respeta el resto del nombre', () => {
  const from = 'Sofia Fractional Residences', to = 'Sofia FR';
  assert.equal(
    withNewPrefix(`${from} | Analisis de Llamadas | Junio 2026`, from, to),
    'Sofia FR | Analisis de Llamadas | Junio 2026',
  );
  assert.equal(withNewPrefix(`${from} | Radar de Objeciones IA`, from, to), 'Sofia FR | Radar de Objeciones IA');
  // Ajeno al patrón: no se toca.
  assert.equal(withNewPrefix('Notas de la reunion.pdf', from, to), null);
  // Coincidencia parcial por el principio: tampoco, porque no empieza igual.
  assert.equal(withNewPrefix('Fractional Residences | Analisis', from, to), null);
});
