import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateInput, validateResult } from '../lib/domain/validate.ts';
import { inputHash } from '../lib/domain/hash.ts';
import {
  timestampsForYear,
  hourlyEnergyToHalfHourly,
  energyToAveragePower,
  averagePowerToEnergy,
  legacyAzimuthToNorth,
} from '../lib/domain/time.ts';
import {
  inspectLegacyProject,
  LEGACY_PARAM_MAPPING,
} from '../lib/domain/legacy.ts';
import { DEMO_PROJECTS, DEFAULTS } from '../lib/simulation.ts';

const read = (file) =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/${file}`, import.meta.url), 'utf8'),
  );
const inputs = Object.fromEntries(
  ['factory', 'logistics', 'retail', 'absolute-ac'].map((name) => [
    name,
    read(`generated/${name}.json`),
  ]),
);
for (const c of read('contract-cases.json'))
  test(`contract parity: ${c.id}`, () => {
    const input = structuredClone(inputs[c.fixture]);
    for (const patch of c.patches) {
      const keys = patch.path.slice(1).split('/');
      const key = keys.pop();
      keys.reduce((obj, k) => obj[k], input)[key] = patch.value;
    }
    if (c.valid) assert.equal(validateInput(input), input);
    else assert.throws(() => validateInput(input));
  });
test('cross-language hashes include values and every version; key order is irrelevant', async () => {
  const hashes = read('generated/hashes.json');
  for (const [name, input] of Object.entries(inputs))
    assert.equal(await inputHash(input), hashes[name]);
  const input = inputs.factory;
  for (const key of Object.keys(input.versions)) {
    const changed = structuredClone(input);
    changed.versions[key] += '-changed';
    assert.notEqual(await inputHash(changed), hashes.factory);
  }
  assert.equal(
    await inputHash({ '😀': 1, 前提: 1e-8, zero: -0 }),
    await inputHash({ zero: 0, 前提: 0.00000001, '😀': 1.0 }),
  );
});
test('half-hour conversion conserves interval, monthly and annual kWh', () => {
  const hourly = Array.from({ length: 8760 }, (_, i) => (i % 29) + 0.25);
  const energy = hourlyEnergyToHalfHourly(hourly),
    times = timestampsForYear(2025);
  const months = Array(12).fill(0),
    original = Array(12).fill(0);
  energy.forEach((v, i) => {
    assert.equal(averagePowerToEnergy(energyToAveragePower(v)), v);
    months[Number(times[i].slice(5, 7)) - 1] += v;
    if (i % 2 === 0) {
      assert.equal(v + energy[i + 1], hourly[i / 2]);
      original[Number(times[i].slice(5, 7)) - 1] += hourly[i / 2];
    }
  });
  assert.deepEqual(months, original);
  assert.equal(
    energy.reduce((a, b) => a + b),
    hourly.reduce((a, b) => a + b),
  );
  assert.deepEqual([-90, 0, 90].map(legacyAzimuthToNorth), [90, 180, 270]);
  for (const azimuth of [0, 90, 180, 270]) {
    const input = structuredClone(inputs.factory);
    input.roofs[0].azimuth.value = azimuth;
    validateInput(input);
  }
});
test('legacy migration accounts for every field and archives saved/unknown data', () => {
  const project = structuredClone(DEMO_PROJECTS[0]);
  project.params.futureField = 'retain me';
  project.saved = [
    {
      id: 'saved',
      name: '案',
      params: { ...DEFAULTS, gridCharge: true, strategy: 'peak' },
      date: '2025-01-01',
    },
  ];
  const preview = inspectLegacyProject(project);
  assert.equal(preview.status, 'needs_confirmation');
  assert.deepEqual(preview.legacyArchive, project);
  assert.equal(
    preview.entries[0].fields.length,
    Object.keys(project.params).length,
  );
  assert.equal(
    preview.entries[1].fields.find((f) => f.key === 'gridCharge').status,
    'confirm',
  );
  assert.equal(
    preview.entries[0].fields.find((f) => f.key === 'futureField').status,
    'confirm',
  );
  for (const key of Object.keys(DEFAULTS))
    assert.ok(LEGACY_PARAM_MAPPING[key], key);
});
test('question fixtures distinguish ranking changes from identical NPV shifts', () => {
  for (const c of read('question-cases.json').cases) {
    assert.deepEqual(
      c.answers.map(
        (a) => [...a.candidates].sort((a, b) => b.npv - a.npv)[0].id,
      ),
      c.expectedWinnerIds,
    );
    const gaps = c.answers.map(
      (a) => a.candidates[0].npv - a.candidates[1].npv,
    );
    assert.equal(Math.max(...gaps) - Math.min(...gaps), c.expectedGapRange);
  }
});
test('result validates annual chronology and recovery definitions', () => {
  const result = read('generated/result.json');
  validateResult(result);
  result.sustainedRecoveryYear = 7;
  assert.throws(() => validateResult(result));
  result.sustainedRecoveryYear = 8;
  result.annual[0].year = 2;
  assert.throws(() => validateResult(result));
});
