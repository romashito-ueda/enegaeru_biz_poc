import type { Provenance, SimulationInput } from '../../contracts/schema.ts';
import { timestampsForYear } from './time.ts';

export function mockFact<T, U extends string>(value: T, unit: U) {
  const provenance: Provenance = {
    kind: 'mock',
    source: 'TRACE synthetic fixture v1 (not measured)',
    acquisition: 'embedded',
    confirmation: 'unreviewed',
    updatedAt: '2026-09-15T00:00:00Z',
    period: {
      start: '2025-01-01T00:00:00+09:00',
      endExclusive: '2026-01-01T00:00:00+09:00',
    },
  };
  return { value, unit, provenance };
}
const round = (v: number) => Math.round(v * 10000) / 10000;
export function createMockInput(
  profile: SimulationInput['site']['profile'] = 'factory',
): SimulationInput {
  const settings = {
    factory: {
      annual: 1200000,
      start: 8,
      end: 18,
      weekend: 0.3,
      name: '工場モック',
      pv: 300,
      pcs: 250,
    },
    logistics: {
      annual: 850000,
      start: 6,
      end: 22,
      weekend: 0.65,
      name: '物流モック',
      pv: 240,
      pcs: 200,
    },
    retail: {
      annual: 1800000,
      start: 10,
      end: 22,
      weekend: 1.2,
      name: '小売モック',
      pv: 450,
      pcs: 400,
    },
  }[profile];
  const timestamps = timestampsForYear(2025);
  const loadWeights = timestamps.map((_, i) => {
    const day = Math.floor(i / 48),
      hour = (i % 48) / 2;
    const weekday = new Date(Date.UTC(2025, 0, day + 1)).getUTCDay();
    return (
      (hour >= settings.start && hour < settings.end ? 1 : 0.2) *
      ([0, 6].includes(weekday) ? settings.weekend : 1)
    );
  });
  const total = loadWeights.reduce((a, b) => a + b, 0);
  const load = loadWeights.map((v) => round((v / total) * settings.annual));
  load[load.length - 1] += settings.annual - load.reduce((a, b) => a + b, 0);
  const sun = timestamps.map((_, i) =>
    Math.max(0, Math.sin((Math.PI * ((i % 48) / 2 + 0.25 - 6)) / 12)),
  );
  const f = mockFact;
  return {
    schemaVersion: '1.0.0',
    versions: {
      model: 'contract-only-v1',
      tariff: 'synthetic-v1',
      assumptions: 'synthetic-v1',
      costs: 'synthetic-v1',
      roofs: 'synthetic-v1',
    },
    site: {
      id: `mock-${profile}`,
      name: settings.name,
      address: '茨城県つくば市（架空物件）',
      profile,
      latitude: f(36.08, 'deg'),
      longitude: f(140.11, 'deg'),
    },
    roofs: [
      {
        id: 'roof-a',
        usableArea: f(4000, 'm2'),
        tilt: f(10, 'deg'),
        azimuth: f(180, 'deg'),
        shadingLoss: f(0.03, 'fraction'),
      },
    ],
    time: {
      year: 2025,
      timezone: 'Asia/Tokyo',
      intervalMinutes: 30,
      convention: 'interval_start',
      timestamps,
    },
    load: { energy: f(load, 'kWh') },
    generation: {
      kind: 'weather',
      dni: f(
        sun.map((v) => round(v * 700)),
        'W/m2',
      ),
      dhi: f(
        sun.map((v) => round(v * 100)),
        'W/m2',
      ),
      temperature: f(
        timestamps.map((_, i) =>
          round(
            18 +
              10 * Math.sin((2 * Math.PI * (Math.floor(i / 48) - 100)) / 365),
          ),
        ),
        'degC',
      ),
      windSpeed: f(
        timestamps.map(() => 2),
        'm/s',
      ),
      elevation: f(25, 'm'),
    },
    equipment: {
      pv: {
        dcCapacity: f(settings.pv, 'kW'),
        acCapacity: f(settings.pcs, 'kW'),
        annualDegradation: f(0.005, 'fraction/year'),
        roofAllocations: [
          { roofId: 'roof-a', dcCapacity: f(settings.pv, 'kW') },
        ],
      },
      battery: {
        capacity: f(200, 'kWh'),
        power: f(100, 'kW'),
        roundTripEfficiency: f(0.92, 'fraction'),
        minimumSoc: f(0.1, 'fraction'),
        initialSoc: f(0.1, 'fraction'),
        dispatch: 'self_consumption',
        gridCharging: false,
        coupling: 'ac',
      },
    },
    tariff: {
      purchase: f(
        timestamps.map(
          (_, i) => (i % 48 >= 16 && i % 48 < 44 ? 24.5 : 19.5) - 1.2 + 3.2,
        ),
        'JPY/kWh',
      ),
      export: f(
        timestamps.map(() => 8),
        'JPY/kWh',
      ),
      annualEscalation: f(0.01, 'fraction/year'),
      demandCharges: 'excluded',
    },
    costs: {
      pv: f(150000, 'JPY/kW'),
      pvPcs: f(20000, 'JPY/kW'),
      battery: f(50000, 'JPY/kWh'),
      batteryPcs: f(20000, 'JPY/kW'),
      construction: f(1000000, 'JPY'),
      annualMaintenance: f(0.01, 'fraction/year'),
      events: [
        {
          id: 'subsidy-0',
          kind: 'subsidy',
          year: 0,
          target: 'project',
          amount: f(10000000, 'JPY'),
        },
        {
          id: 'battery-12',
          kind: 'replacement',
          year: 12,
          target: 'battery',
          amount: f(3000000, 'JPY'),
          replacedCapacityFraction: f(1, 'fraction'),
        },
      ],
    },
    evaluation: {
      ownership: 'self_owned',
      tax: 'pre_tax',
      debt: 'none',
      years: 20,
      discountRate: f(0.03, 'fraction/year'),
      carbonIntensity: f(0.43, 'kgCO2/kWh'),
      recoveryDefinition: 'undiscounted_sustained',
    },
    constraints: {
      grossBudget: f(100000000, 'JPY'),
      recoveryYears: f(15, 'year'),
      allowedRoofIds: ['roof-a'],
      objective: 'max_npv',
    },
    scenarios: [
      {
        id: 'base',
        label: '基準（モック）',
        loadScale: f(1, 'ratio'),
        solarScale: f(1, 'ratio'),
        energyPriceScale: f(1, 'ratio'),
      },
      {
        id: 'lower-demand',
        label: '需要20%減（仮定）',
        loadScale: f(0.8, 'ratio'),
        solarScale: f(1, 'ratio'),
        energyPriceScale: f(1, 'ratio'),
      },
    ],
  };
}
