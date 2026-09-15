import { Type, type Static, type TSchema } from '@sinclair/typebox';

const object = <T extends Record<string, TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const enumeration = <const T extends string>(values: T[]) =>
  Type.Union(values.map((value) => Type.Literal<T>(value)));
const text = Type.String({ minLength: 1 });
const number = Type.Number();
const nonnegative = Type.Number({ minimum: 0 });
const fraction = Type.Number({ minimum: 0, maximum: 1 });
const timestamp = Type.String({
  format: 'date-time',
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:[0-5]\\d(Z|[+-]\\d{2}:\\d{2})$',
});
const period = object({ start: timestamp, endExclusive: timestamp });
export const ProvenanceSchema = object({
  kind: enumeration(['mock', 'assumed', 'derived', 'observed']),
  source: text,
  acquisition: enumeration(['embedded', 'manual', 'imported', 'provider']),
  confirmation: enumeration(['unreviewed', 'desk_reviewed', 'site_verified']),
  period,
  updatedAt: timestamp,
  originalResolutionMinutes: Type.Optional(
    Type.Union([Type.Literal(30), Type.Literal(60)]),
  ),
  transformation: Type.Optional(text),
});
const fact = <T extends TSchema, U extends string>(value: T, unit: U) =>
  object({
    value,
    unit: Type.Literal(unit),
    provenance: ProvenanceSchema,
    uncertainty: Type.Optional(
      object({
        min: value.type === 'number' ? value : number,
        max: value.type === 'number' ? value : number,
        rationale: text,
      }),
    ),
  });
const series = <U extends string>(unit: U, item = nonnegative) =>
  fact(Type.Array(item, { minItems: 17520, maxItems: 17520 }), unit);
const roof = object({
  id: text,
  usableArea: fact(nonnegative, 'm2'),
  tilt: fact(Type.Number({ minimum: 0, maximum: 90 }), 'deg'),
  azimuth: fact(Type.Number({ minimum: 0, exclusiveMaximum: 360 }), 'deg'),
  shadingLoss: fact(fraction, 'fraction'),
});
const versions = object({
  model: text,
  tariff: text,
  assumptions: text,
  costs: text,
  roofs: text,
});
const equipment = object({
  pv: object({
    dcCapacity: fact(nonnegative, 'kW'),
    acCapacity: fact(nonnegative, 'kW'),
    annualDegradation: fact(fraction, 'fraction/year'),
    roofAllocations: Type.Array(
      object({ roofId: text, dcCapacity: fact(nonnegative, 'kW') }),
    ),
  }),
  battery: object({
    capacity: fact(nonnegative, 'kWh'),
    power: fact(nonnegative, 'kW'),
    roundTripEfficiency: fact(
      Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
      'fraction',
    ),
    minimumSoc: fact(fraction, 'fraction'),
    initialSoc: fact(fraction, 'fraction'),
    dispatch: Type.Literal('self_consumption'),
    gridCharging: Type.Literal(false),
    coupling: Type.Literal('ac'),
  }),
});
const weather = object({
  kind: Type.Literal('weather'),
  dni: series('W/m2'),
  dhi: series('W/m2'),
  temperature: series('degC', number),
  windSpeed: series('m/s'),
  elevation: fact(number, 'm'),
});
const absoluteAc = object({
  kind: Type.Literal('absolute_ac'),
  energy: series('kWh'),
  binding: object({
    pvDcKw: nonnegative,
    pvAcKw: nonnegative,
    roofsVersion: text,
    roofGeometry: Type.Array(
      object({
        roofId: text,
        tilt: number,
        azimuth: number,
        shadingLoss: number,
        dcKw: nonnegative,
      }),
    ),
  }),
});
const scenario = object({
  id: text,
  label: text,
  // Deterministic what-if multipliers, never a probability distribution.
  loadScale: fact(Type.Number({ exclusiveMinimum: 0 }), 'ratio'),
  solarScale: fact(nonnegative, 'ratio'),
  energyPriceScale: fact(nonnegative, 'ratio'),
});
export const SimulationInputSchema = object({
  schemaVersion: Type.Literal('1.0.0'),
  versions,
  site: object({
    id: text,
    name: text,
    address: text,
    profile: enumeration(['factory', 'logistics', 'retail']),
    latitude: fact(Type.Number({ minimum: -90, maximum: 90 }), 'deg'),
    longitude: fact(Type.Number({ minimum: -180, maximum: 180 }), 'deg'),
  }),
  roofs: Type.Array(roof, { minItems: 1 }),
  time: object({
    year: Type.Integer({ minimum: 2001, maximum: 2099 }),
    timezone: Type.Literal('Asia/Tokyo'),
    intervalMinutes: Type.Literal(30),
    convention: Type.Literal('interval_start'),
    timestamps: Type.Array(timestamp, { minItems: 17520, maxItems: 17520 }),
  }),
  load: object({ energy: series('kWh') }),
  generation: Type.Union([weather, absoluteAc]),
  equipment,
  tariff: object({
    purchase: series('JPY/kWh', number),
    export: series('JPY/kWh', number),
    annualEscalation: fact(
      Type.Number({ exclusiveMinimum: -1 }),
      'fraction/year',
    ),
    demandCharges: Type.Literal('excluded'),
  }),
  costs: object({
    pv: fact(nonnegative, 'JPY/kW'),
    pvPcs: fact(nonnegative, 'JPY/kW'),
    battery: fact(nonnegative, 'JPY/kWh'),
    batteryPcs: fact(nonnegative, 'JPY/kW'),
    construction: fact(nonnegative, 'JPY'),
    annualMaintenance: fact(nonnegative, 'fraction/year'),
    events: Type.Array(
      object({
        id: text,
        year: Type.Integer({ minimum: 0, maximum: 20 }),
        kind: enumeration(['subsidy', 'replacement']),
        target: enumeration([
          'project',
          'pv',
          'pv_pcs',
          'battery',
          'battery_pcs',
        ]),
        amount: fact(nonnegative, 'JPY'),
        replacedCapacityFraction: Type.Optional(fact(fraction, 'fraction')),
      }),
    ),
  }),
  evaluation: object({
    ownership: Type.Literal('self_owned'),
    tax: Type.Literal('pre_tax'),
    debt: Type.Literal('none'),
    years: Type.Literal(20),
    discountRate: fact(Type.Number({ exclusiveMinimum: -1 }), 'fraction/year'),
    carbonIntensity: fact(nonnegative, 'kgCO2/kWh'),
    recoveryDefinition: Type.Literal('undiscounted_sustained'),
  }),
  constraints: object({
    grossBudget: Type.Optional(fact(nonnegative, 'JPY')),
    recoveryYears: Type.Optional(
      fact(Type.Number({ minimum: 0, maximum: 20 }), 'year'),
    ),
    allowedRoofIds: Type.Array(text, { minItems: 1, uniqueItems: true }),
    objective: enumeration([
      'max_npv',
      'min_gross_cost',
      'max_self_consumption',
    ]),
  }),
  scenarios: Type.Array(scenario, { minItems: 1 }),
});

export const SimulationResultSchema = object({
  schemaVersion: Type.Literal('1.0.0'),
  inputHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  versions,
  scenarioId: text,
  engine: object({ name: text, version: text }),
  warnings: Type.Array(text),
  annual: Type.Array(
    object({
      year: Type.Integer({ minimum: 1, maximum: 20 }),
      load: fact(nonnegative, 'kWh'),
      pvGeneration: fact(nonnegative, 'kWh'),
      gridImport: fact(nonnegative, 'kWh'),
      gridExport: fact(nonnegative, 'kWh'),
      selfConsumption: fact(nonnegative, 'kWh'),
      operatingBenefit: fact(number, 'JPY'),
      netCashFlow: fact(number, 'JPY'),
    }),
    { minItems: 20, maxItems: 20 },
  ),
  grossInitialCost: fact(nonnegative, 'JPY'),
  netInitialCost: fact(number, 'JPY'),
  npv: fact(number, 'JPY'),
  firstBreakEvenYear: Type.Union([
    Type.Integer({ minimum: 0, maximum: 20 }),
    Type.Null(),
  ]),
  sustainedRecoveryYear: Type.Union([
    Type.Integer({ minimum: 0, maximum: 20 }),
    Type.Null(),
  ]),
});
export type SimulationInput = Static<typeof SimulationInputSchema>;
export type SimulationResult = Static<typeof SimulationResultSchema>;
export type Provenance = Static<typeof ProvenanceSchema>;
