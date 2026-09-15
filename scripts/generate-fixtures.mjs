import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createMockInput, mockFact } from '../lib/domain/fixtures.ts';
import { inputHash } from '../lib/domain/hash.ts';
import { validateInput, validateResult } from '../lib/domain/validate.ts';
const dir = new URL('../fixtures/generated/', import.meta.url);
await mkdir(dir, { recursive: true });
const hashes = {};
async function save(name, data) {
  const content = JSON.stringify(data) + '\n',
    path = new URL(name, dir);
  if (process.argv.includes('--check')) {
    if ((await readFile(path, 'utf8')) !== content)
      throw new Error(`Stale fixture: ${name}`);
  } else await writeFile(path, content);
}
for (const profile of ['factory', 'logistics', 'retail', 'absolute-ac']) {
  const input = createMockInput(
    profile === 'absolute-ac' ? 'factory' : profile,
  );
  if (profile === 'absolute-ac') {
    input.generation = {
      kind: 'absolute_ac',
      energy: {
        ...input.load.energy,
        value: input.time.timestamps.map((_, i) =>
          i % 48 >= 16 && i % 48 < 32 ? 50 : 0,
        ),
      },
      binding: {
        pvDcKw: 300,
        pvAcKw: 250,
        roofsVersion: input.versions.roofs,
        roofGeometry: [
          {
            roofId: 'roof-a',
            tilt: 10,
            azimuth: 180,
            shadingLoss: 0.03,
            dcKw: 300,
          },
        ],
      },
    };
  }
  validateInput(input);
  hashes[profile] = await inputHash(input);
  await save(`${profile}.json`, input);
}
await save('hashes.json', hashes);
const f = mockFact;
const result = {
  schemaVersion: '1.0.0',
  inputHash: hashes.factory,
  versions: createMockInput().versions,
  scenarioId: 'base',
  engine: { name: 'contract-fixture', version: '1' },
  warnings: ['MOCK: schema fixture, not a simulation result'],
  annual: Array.from({ length: 20 }, (_, i) => ({
    year: i + 1,
    load: f(100, 'kWh'),
    pvGeneration: f(50, 'kWh'),
    gridImport: f(50, 'kWh'),
    gridExport: f(0, 'kWh'),
    selfConsumption: f(50, 'kWh'),
    operatingBenefit: f(50, 'JPY'),
    netCashFlow: f(40, 'JPY'),
  })),
  grossInitialCost: f(300, 'JPY'),
  netInitialCost: f(300, 'JPY'),
  npv: f(100, 'JPY'),
  firstBreakEvenYear: 8,
  sustainedRecoveryYear: 8,
};
validateResult(result);
await save('result.json', result);
