/** Deterministic PoC model. All input series and tariffs are synthetic, not NEDO or utility data. */
export type Profile = 'factory' | 'logistics' | 'retail';
export type Params = {
  pv: number;
  battery: number;
  power: number;
  efficiency: number;
  reserve: number;
  strategy: 'self' | 'peak';
  target: number;
  gridCharge: boolean;
  annual: number;
  profile: Profile;
  weekend: number;
  start: number;
  end: number;
  rate: number;
  nightRate: number;
  basic: number;
  fuel: number;
  levy: number;
  tariffMode: 'peak' | 'fixed';
  contract: number;
  yield: number;
  orientation: number;
  tilt: number;
  pcs: number;
  solarCost: number;
  batteryCost: number;
  subsidy: number;
  maintenance: number;
  escalation: number;
  degradation: number;
  replacement: number;
  discount: number;
  sell: number;
  co2: number;
  monthly?: number[];
  demandData?: number[];
  pvData?: number[];
};
export type Project = {
  id: string;
  name: string;
  location: string;
  profile: Profile;
  params: Params;
  saved: SavedScenario[];
};
export type SavedScenario = {
  id: string;
  name: string;
  params: Params;
  date: string;
};
export const DEFAULTS: Params = {
  pv: 300,
  battery: 200,
  power: 100,
  efficiency: 92,
  reserve: 10,
  strategy: 'self',
  target: 230,
  gridCharge: false,
  annual: 1200,
  profile: 'factory',
  weekend: 30,
  start: 8,
  end: 18,
  rate: 24.5,
  nightRate: 19.5,
  basic: 1850,
  fuel: -1.2,
  levy: 3.2,
  tariffMode: 'peak',
  contract: 300,
  yield: 1180,
  orientation: 0,
  tilt: 10,
  pcs: 250,
  solarCost: 17,
  batteryCost: 6,
  subsidy: 1000,
  maintenance: 1,
  escalation: 1,
  degradation: 0.5,
  replacement: 300,
  discount: 3,
  sell: 0,
  co2: 0.43,
};
export const PROFILE_NAMES: Record<Profile, string> = {
  factory: '製造業',
  logistics: '物流・倉庫',
  retail: '商業施設',
};
export const DEMO_PROJECTS: Project[] = [
  {
    id: 'tsukuba',
    name: 'つくば工場',
    location: '茨城県つくば市',
    profile: 'factory',
    params: { ...DEFAULTS },
    saved: [],
  },
  {
    id: 'yokohama',
    name: '横浜物流センター',
    location: '神奈川県横浜市',
    profile: 'logistics',
    params: {
      ...DEFAULTS,
      annual: 850,
      pv: 240,
      pcs: 200,
      profile: 'logistics',
      weekend: 65,
      start: 6,
      end: 22,
    },
    saved: [],
  },
  {
    id: 'kashiwa',
    name: '柏ショッピングモール',
    location: '千葉県柏市',
    profile: 'retail',
    params: {
      ...DEFAULTS,
      annual: 1800,
      pv: 450,
      pcs: 400,
      profile: 'retail',
      weekend: 120,
      start: 10,
      end: 22,
    },
    saved: [],
  },
];
export type Point = {
  t: number;
  month: number;
  day: number;
  hour: number;
  load: number;
  solar: number;
  direct: number;
  charge: number;
  gridCharge: number;
  discharge: number;
  solarDischarge: number;
  grid: number;
  export: number;
  soc: number;
};
export type Monthly = {
  month: number;
  load: number;
  solar: number;
  direct: number;
  charge: number;
  discharge: number;
  solarDischarge: number;
  gridCharge: number;
  grid: number;
  export: number;
  beforeEnergy: number;
  afterEnergy: number;
  beforePeak: number;
  afterPeak: number;
  beforeBill: number;
  afterBill: number;
};
export type CashRow = {
  year: number;
  benefit: number;
  maintenance: number;
  replacement: number;
  net: number;
  cumulative: number;
};
export const STEPS = 365 * 48;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const SEASON = [
  1.05, 1.01, 0.94, 0.89, 0.91, 1.04, 1.17, 1.19, 1.04, 0.9, 0.92, 1.04,
];
export function dateForStep(t: number) {
  return new Date(Date.UTC(2025, 0, 1, 0, t * 30));
}
export function timestamp(t: number) {
  return dateForStep(t).toISOString().slice(0, 16);
}
export function series(p: Params): { load: number[]; solar: number[] } {
  const load: number[] = [],
    sun: number[] = [],
    monthSums = Array(12).fill(0);
  for (let d = 0; d < 365; d++) {
    const date = dateForStep(d * 48),
      m = date.getUTCMonth(),
      weekend = [0, 6].includes(date.getUTCDay());
    const dayLength = 12 + 2.5 * Math.sin(((d - 80) / 365) * Math.PI * 2),
      sunrise = 12 - dayLength / 2;
    const weather = 0.69 + 0.17 * Math.sin(d * 1.83) + 0.1 * Math.cos(d * 0.43);
    for (let h = 0; h < 48; h++) {
      const hour = h / 2 + 0.25,
        business = hour >= p.start && hour < p.end;
      let shape = business
        ? 1.03 + 0.13 * Math.sin((hour - p.start) * 0.85)
        : 0.24;
      if (p.profile === 'factory' && hour >= 12 && hour < 13) shape *= 0.72;
      if (p.profile === 'logistics')
        shape = business ? 0.77 + 0.14 * Math.sin(hour * 0.5) : 0.4;
      if (p.profile === 'retail')
        shape = business ? 0.95 + 0.22 * Math.sin((hour - 10) * 0.28) : 0.27;
      const l =
        Math.max(0.01, shape) *
        (weekend ? p.weekend / 100 : 1) *
        SEASON[m] *
        (1 + 0.035 * Math.sin(d * 2.1));
      load.push(l);
      monthSums[m] += l;
      const angle = ((hour - sunrise) / dayLength) * Math.PI;
      sun.push(
        angle > 0 && angle < Math.PI
          ? Math.pow(Math.sin(angle), 1.5) * weather
          : 0,
      );
    }
  }
  const sum = load.reduce((a, b) => a + b, 0),
    sunSum = sun.reduce((a, b) => a + b, 0);
  let cursor = 0;
  const orientFactor = 1 - (0.18 * Math.abs(p.orientation)) / 90;
  const tiltFactor = 1 - Math.abs(p.tilt - 20) * 0.002;
  for (let m = 0; m < 12; m++)
    for (let j = 0; j < MONTH_DAYS[m] * 48; j++, cursor++) {
      load[cursor] =
        p.demandData?.[cursor] ??
        load[cursor] *
          (p.monthly
            ? (p.monthly[m] * 1000) / monthSums[m]
            : (p.annual * 1000) / sum);
      sun[cursor] =
        p.pvData?.[cursor] ??
        Math.min(
          p.pcs * 0.5,
          (sun[cursor] / sunSum) * p.pv * p.yield * orientFactor * tiltFactor,
        );
    }
  return { load, solar: sun };
}
export function simulate(p: Params) {
  const input = series(p),
    points: Point[] = [],
    months: Monthly[] = Array.from({ length: 12 }, (_, month) => ({
      month,
      load: 0,
      solar: 0,
      direct: 0,
      charge: 0,
      discharge: 0,
      solarDischarge: 0,
      gridCharge: 0,
      grid: 0,
      export: 0,
      beforeEnergy: 0,
      afterEnergy: 0,
      beforePeak: 0,
      afterPeak: 0,
      beforeBill: 0,
      afterBill: 0,
    }));
  const eta = Math.sqrt(p.efficiency / 100),
    capacity = p.battery * (1 - p.reserve / 100),
    power = p.power * 0.5;
  let solarStore = 0,
    gridStore = 0,
    month = 0,
    monthEnd = MONTH_DAYS[0] * 48;
  for (let t = 0; t < STEPS; t++) {
    if (t >= monthEnd) {
      month++;
      monthEnd += MONTH_DAYS[month] * 48;
    }
    const load = input.load[t],
      solar = input.solar[t],
      hour = (t % 48) / 2,
      day = Math.floor(t / 48);
    const direct = Math.min(load, solar),
      excess = solar - direct,
      need = load - direct;
    const charge = Math.min(
      excess,
      power,
      Math.max(0, capacity - solarStore - gridStore) / eta,
    );
    solarStore += charge * eta;
    let gridCharge = 0,
      discharge = 0,
      solarDischarge = 0;
    if (charge < 1e-9 && p.gridCharge && hour < 6) {
      gridCharge = Math.min(
        power,
        Math.max(0, capacity - solarStore - gridStore) / eta,
        Math.max(0, p.target * 0.5 - need),
      );
      gridStore += gridCharge * eta;
    } else if (charge < 1e-9) {
      const requested =
        p.strategy === 'self' ? need : Math.max(0, need - p.target * 0.5);
      const stored = solarStore + gridStore;
      discharge = Math.min(requested, power, stored * eta);
      const fraction = stored > 0 ? solarStore / stored : 0;
      solarDischarge = discharge * fraction;
      solarStore = Math.max(0, solarStore - solarDischarge / eta);
      gridStore = Math.max(0, gridStore - (discharge - solarDischarge) / eta);
    }
    const grid = Math.max(0, need - discharge + gridCharge),
      exported = Math.max(0, excess - charge);
    const point = {
      t,
      month,
      day,
      hour,
      load,
      solar,
      direct,
      charge,
      gridCharge,
      discharge,
      solarDischarge,
      grid,
      export: exported,
      soc: solarStore + gridStore,
    };
    points.push(point);
    const m = months[month];
    for (const key of [
      'load',
      'solar',
      'direct',
      'charge',
      'discharge',
      'solarDischarge',
      'gridCharge',
      'grid',
      'export',
    ] as const)
      m[key] += point[key];
    const rate =
      (hour < 7 || hour >= 23 ? p.nightRate : p.rate) + p.fuel + p.levy;
    m.beforeEnergy += load * rate;
    m.afterEnergy += grid * rate;
    m.beforePeak = Math.max(m.beforePeak, load * 2);
    m.afterPeak = Math.max(m.afterPeak, grid * 2);
  }
  const beforePeak = Math.max(...months.map((m) => m.beforePeak)),
    afterPeak = Math.max(...months.map((m) => m.afterPeak));
  for (const m of months) {
    m.beforeBill =
      m.beforeEnergy +
      (p.tariffMode === 'peak' ? beforePeak : p.contract) * p.basic;
    m.afterBill =
      m.afterEnergy +
      (p.tariffMode === 'peak' ? afterPeak : p.contract) * p.basic;
  }
  const sum = (key: keyof Monthly) => months.reduce((a, m) => a + m[key], 0);
  const beforeBill = sum('beforeBill'),
    afterBill = sum('afterBill'),
    savings = beforeBill - afterBill;
  const exported = sum('export'),
    solar = sum('solar'),
    self = sum('direct') + sum('solarDischarge'),
    load = sum('load'),
    grid = sum('grid');
  const equipment = (p.pv * p.solarCost + p.battery * p.batteryCost) * 10000,
    subsidy = Math.min(equipment, p.subsidy * 10000),
    investment = equipment - subsidy;
  const sale = exported * p.sell,
    maintenance = (equipment * p.maintenance) / 100;
  const cash: CashRow[] = [
    {
      year: 0,
      benefit: 0,
      maintenance: 0,
      replacement: 0,
      net: -investment,
      cumulative: -investment,
    },
  ];
  let cumulative = -investment,
    payback: number | null = investment === 0 && equipment > 0 ? 0 : null,
    npv = -investment;
  for (let year = 1; year <= 20; year++) {
    // First-year dispatch held fixed; annual degradation/escalation are sensitivity approximations.
    const benefit =
      savings *
        Math.pow(1 + p.escalation / 100, year - 1) *
        Math.pow(1 - p.degradation / 100, year - 1) +
      sale * Math.pow(1 - p.degradation / 100, year - 1);
    const replacement =
      year === 12 && equipment > 0 ? p.replacement * 10000 : 0;
    const net = benefit - maintenance - replacement,
      previous = cumulative;
    cumulative += net;
    if (payback === null && previous < 0 && cumulative >= 0 && net > 0)
      payback = year - 1 + -previous / net;
    npv += net / Math.pow(1 + p.discount / 100, year);
    cash.push({ year, benefit, maintenance, replacement, net, cumulative });
  }
  return {
    points,
    months,
    beforeBill,
    afterBill,
    savings,
    beforePeak,
    afterPeak,
    exported,
    solar,
    self,
    load,
    grid,
    selfRate: solar > 0 ? (self / solar) * 100 : 0,
    autonomy: load > 0 ? (self / load) * 100 : 0,
    co2: ((load - grid) * p.co2) / 1000,
    equipment,
    subsidy,
    investment,
    sale,
    maintenance,
    cash,
    payback,
    npv,
    profit: cumulative,
    roi: investment > 0 ? (cumulative / investment) * 100 : null,
    finalSoc: solarStore + gridStore,
    capacity,
  };
}
export type Result = ReturnType<typeof simulate>;
export function number(value: number, digits = 0) {
  return value.toLocaleString('ja-JP', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
export function man(value: number, digits = 0) {
  return number(value / 10000, digits);
}
export function years(value: number | null) {
  return value === null ? '20年超' : number(value, 1) + '年';
}

export function parseSeriesCSV(text: string, kind: 'demand' | 'pv'): number[] {
  const rows = text
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/);
  const headers = rows
    .shift()
    ?.split(',')
    .map((s) => s.trim());
  const col = kind === 'demand' ? 'demand_kwh' : 'pv_kwh';
  if (
    headers?.[0] !== 'timestamp' ||
    headers[1] !== col ||
    headers.length !== 2
  )
    throw new Error(
      `見出しは timestamp,${col} にしてください。テンプレートを利用できます。`,
    );
  if (rows.length !== STEPS)
    throw new Error(
      `2025年の30分値 ${STEPS.toLocaleString()}行が必要です（現在 ${rows.length.toLocaleString()}行）。`,
    );
  return rows.map((row, i) => {
    const cells = row.split(',');
    const value = Number(cells[1]);
    if (
      cells.length !== 2 ||
      cells[0].trim() !== timestamp(i) ||
      cells[1].trim() === '' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100000
    )
      throw new Error(
        `${i + 2}行目：日時は ${timestamp(i)}、電力量は0〜100,000 kWhにしてください。`,
      );
    return value;
  });
}

export const LIMITS: Partial<Record<keyof Params, [number, number]>> = {
  pv: [0, 1000],
  battery: [0, 1000],
  power: [0, 500],
  efficiency: [50, 100],
  reserve: [0, 90],
  target: [0, 2000],
  annual: [10, 20000],
  weekend: [0, 150],
  start: [0, 23],
  end: [1, 24],
  rate: [0, 100],
  nightRate: [0, 100],
  basic: [0, 5000],
  fuel: [-10, 30],
  levy: [0, 20],
  contract: [0, 2000],
  yield: [500, 2000],
  orientation: [-90, 90],
  tilt: [0, 60],
  pcs: [0, 1000],
  solarCost: [0, 60],
  batteryCost: [0, 40],
  subsidy: [0, 50000],
  maintenance: [0, 10],
  escalation: [-5, 10],
  degradation: [0, 5],
  replacement: [0, 10000],
  discount: [0, 15],
  sell: [0, 50],
  co2: [0, 1],
};
export function validateParams(input: unknown): input is Params {
  if (!input || typeof input !== 'object') return false;
  const p = input as Params;
  for (const [key, range] of Object.entries(LIMITS)) {
    const value = p[key as keyof Params];
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < range[0] ||
      value > range[1]
    )
      return false;
  }
  if (
    !['factory', 'logistics', 'retail'].includes(p.profile) ||
    !['self', 'peak'].includes(p.strategy) ||
    !['peak', 'fixed'].includes(p.tariffMode) ||
    typeof p.gridCharge !== 'boolean' ||
    p.start >= p.end
  )
    return false;
  for (const key of ['demandData', 'pvData'] as const)
    if (
      p[key] !== undefined &&
      (!Array.isArray(p[key]) ||
        p[key]!.length !== STEPS ||
        !p[key]!.every((v) => Number.isFinite(v) && v >= 0 && v <= 100000))
    )
      return false;
  if (
    p.monthly !== undefined &&
    (!Array.isArray(p.monthly) ||
      p.monthly.length !== 12 ||
      !p.monthly.every((v) => Number.isFinite(v) && v >= 0 && v <= 20000) ||
      p.monthly.reduce((a, b) => a + b, 0) <= 0)
  )
    return false;
  return true;
}
