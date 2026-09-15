/**
 * Reproduce the calculation audit with deliberate synthetic inputs.
 * These assertions document shortcomings in the audited implementation;
 * they are NOT regression requirements to preserve after fixing the model.
 * Run: node research/calculation-audit.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS, STEPS, simulate, series, validateParams } from '../lib/simulation.ts';

const zeros = () => Array(STEPS).fill(0);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const close = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const run = (p) => {
  assert.ok(validateParams(p), 'Fixture must be accepted by the application validator');
  return simulate(p);
};
const daily = (step, kwh) => {
  const values = zeros();
  for (let day = 0; day < 365; day++) values[day * 48 + step] = kwh;
  return values;
};
const sourceHashes = Object.fromEntries(
  ['lib/simulation.ts', 'components/workspace.tsx'].map((file) => [
    file, createHash('sha256').update(readFileSync(new URL(`../${file}`, import.meta.url))).digest('hex'),
  ]),
);
const findings = {};

// F1: Existing customer's first year after commissioning, with prior-year
// monthly demand peaks equal to this fixture's no-project baseline peaks.
// No negotiated contract reset or power-factor adjustment is assumed.
const normal = run(DEFAULTS);
const history = normal.months.map((m) => m.beforePeak);
const rolling = (current) => current.map((_, month) =>
  Math.max(...history.concat(current).slice(month + 1, month + 13)),
);
const beforeContracts = rolling(history);
const afterContracts = rolling(normal.months.map((m) => m.afterPeak));
const expectedBasicSaving = sum(beforeContracts.map((v, i) => (v - afterContracts[i]) * DEFAULTS.basic));
const annualMaxBasicSaving = (normal.beforePeak - normal.afterPeak) * DEFAULTS.basic * 12;
const firstYearSaving = normal.savings - annualMaxBasicSaving + expectedBasicSaving;
assert.ok(normal.savings > firstYearSaving);
findings.F1_rolling_contract = {
  assumptions: 'Jan commissioning; prior 12 monthly peaks equal baseline; no negotiated reset; same unit prices and other fees',
  modelAnnualSavingYen: normal.savings,
  rollingFirstYearSavingYen: firstYearSaving,
  overstatementYen: normal.savings - firstYearSaving,
  modelBasicSavingYen: annualMaxBasicSaving,
  rollingBasicSavingYen: expectedBasicSaving,
  beforePeakKw: normal.beforePeak,
  afterPeakKw: normal.afterPeak,
  afterContractKwByMonth: afterContracts,
};

// F2: At 01:00, 300 kW demand and a 100 kW target. Prior charging has
// provided enough stored energy for a feasible 100 kW discharge.
const nightLoad = zeros();
nightLoad[2] = 150;
const nightParams = { ...DEFAULTS, pv: 0, demandData: nightLoad, pvData: zeros(),
  strategy: 'peak', target: 100, gridCharge: true };
const night = run(nightParams);
const availableBefore = night.points[1].soc;
const feasibleDischargeKwh = Math.min(150 - 100 * 0.5, nightParams.power * 0.5,
  availableBefore * Math.sqrt(nightParams.efficiency / 100));
close(night.points[2].discharge, 0);
close(feasibleDischargeKwh, 50);
findings.F2_night_dispatch = {
  time: '2025-01-01 01:00 (30-minute interval)',
  availableStoredEnergyKwh: availableBefore,
  modelDischargeKwh: night.points[2].discharge,
  feasibleDischargeKwh,
  modelImportKw: night.points[2].grid * 2,
  feasibleImportKw: (nightLoad[2] - feasibleDischargeKwh) * 2,
  targetKw: 100,
};

// F3: After 19 rounds of 5% PV degradation, generation remains above load
// in every occupied interval, so bill savings stay unchanged without sales.
const lifeParams = { ...DEFAULTS, battery: 0, demandData: daily(24, 10),
  pvData: daily(24, 30), basic: 0, escalation: 0, degradation: 5,
  sell: 0, maintenance: 0, replacement: 0 };
const first = run(lifeParams);
const year20Factor = Math.pow(0.95, 19);
const replay = run({ ...lifeParams, pvData: lifeParams.pvData.map((v) => v * year20Factor) });
close(first.savings, 365 * 10 * (DEFAULTS.rate + DEFAULTS.fuel + DEFAULTS.levy));
close(replay.savings, first.savings);
assert.ok(first.cash[20].benefit < replay.savings);
findings.F3_lifetime_scaling = {
  assumptions: 'Daily one interval: 10 kWh load and 30 kWh AC PV; battery/sales/basic/O&M/replacement/escalation zero; 5% compounded PV degradation',
  firstYearSavingYen: first.savings,
  year20PvKwhPerOccupiedInterval: 30 * year20Factor,
  modelYear20BenefitYen: first.cash[20].benefit,
  replayYear20BenefitYen: replay.savings,
  understatementYen: replay.savings - first.cash[20].benefit,
};

// F4: Opposite roof azimuths collapse to the same time series, including
// for an explicitly asymmetric (morning only) demand profile.
const eastParams = { ...DEFAULTS, orientation: -90, battery: 0, demandData: daily(16, 40) };
const westParams = { ...eastParams, orientation: 90 };
const east = series(eastParams).solar;
const west = series(westParams).solar;
const maxDifference = Math.max(...east.map((v, i) => Math.abs(v - west[i])));
close(maxDifference, 0);
const horizontalSouth = sum(series({ ...DEFAULTS, tilt: 0, orientation: 0, pcs: 1000 }).solar);
const horizontalEast = sum(series({ ...DEFAULTS, tilt: 0, orientation: -90, pcs: 1000 }).solar);
close(horizontalEast / horizontalSouth, 0.82);
findings.F4_azimuth = {
  maxEastWestHalfHourlyDifferenceKwh: maxDifference,
  eastAnnualBillSavingYen: run(eastParams).savings,
  westAnnualBillSavingYen: run(westParams).savings,
  horizontalSouthKwh: horizontalSouth,
  horizontalEastKwh: horizontalEast,
  horizontalAzimuthOnlyReductionPercent: (1 - horizontalEast / horizontalSouth) * 100,
  note: 'Demonstrates absent directional timing, not a measured east/west yield forecast',
};

// F5: Shifting sellable PV can lower the electricity bill while reducing
// total annual value. Isolate this effect by zeroing other cash-flow inputs.
const marginalParams = { ...DEFAULTS, battery: 40, power: 40, reserve: 0,
  demandData: daily(36, 10), pvData: daily(24, 20), basic: 0,
  sell: 40, subsidy: 0, maintenance: 0, replacement: 0,
  escalation: 0, degradation: 0 };
const battery = run(marginalParams);
const noBattery = run({ ...marginalParams, battery: 0 });
const deltaBill = battery.savings - noBattery.savings;
const deltaSale = battery.sale - noBattery.sale;
const deltaNet = deltaBill + deltaSale - (battery.maintenance - noBattery.maintenance);
assert.ok(deltaBill > 0 && deltaNet < 0);
findings.F5_incremental_economics = {
  assumptions: 'Daily 20 kWh midday PV; 10 kWh evening demand; sell 40 yen/kWh; evening buy 26.5 yen/kWh; 92% round-trip efficiency; other recurring costs zero',
  extraInvestmentYen: battery.investment - noBattery.investment,
  incrementalBillSavingYen: deltaBill,
  incrementalSaleYen: deltaSale,
  incrementalNetAnnualValueYen: deltaNet,
  displayedBillOnlyPaybackYears: (battery.investment - noBattery.investment) / deltaBill,
  incrementalNpvYen: battery.npv - noBattery.npv,
  finalStoredEnergyKwh: battery.finalSoc,
  boundaryNote: 'Uses the current initial empty usable store and unvalued terminal store; these affect the exact annual amount but not the negative-value conclusion',
};

// F6: An imported absolute AC profile overrides size/PCS changes, while
// their cost still changes. A sizing comparison needs explicit data semantics.
const importParams = { ...DEFAULTS, battery: 0, pvData: series(DEFAULTS).solar };
const small = run({ ...importParams, pv: 100, pcs: 85 });
const large = run({ ...importParams, pv: 500, pcs: 425 });
close(small.savings, large.savings);
assert.ok(large.investment > small.investment);
findings.F6_imported_profile_sizing = {
  smallerPvKw: 100,
  largerPvKw: 500,
  smallAnnualSavingYen: small.savings,
  largeAnnualSavingYen: large.savings,
  smallInvestmentYen: small.investment,
  largeInvestmentYen: large.investment,
  smallDeclaredPcsKw: 85,
  importedMaxAcKw: Math.max(...small.points.map((p) => p.solar * 2)),
  note: 'Absolute metered AC profile is valid for its recorded equipment; it must not silently stand for multiple design sizes',
};

const result = {
  auditDate: '2026-09-08',
  scope: 'Synthetic analytical reproductions; not a SAM benchmark or measured field validation',
  sourceHashes,
  findings,
};
writeFileSync(new URL('./calculation-audit-results.json', import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
