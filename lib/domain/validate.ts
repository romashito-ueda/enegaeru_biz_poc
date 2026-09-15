import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  SimulationInputSchema,
  SimulationResultSchema,
  type SimulationInput,
  type SimulationResult,
} from '../../contracts/schema.ts';
import { timestampsForYear } from './time.ts';

const ajv = new Ajv({ allErrors: false, strict: true });
addFormats(ajv);
const inputValidator = ajv.compile<SimulationInput>(SimulationInputSchema);
const resultValidator = ajv.compile<SimulationResult>(SimulationResultSchema);
export class ContractError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(errors.join('; '));
    this.errors = errors;
  }
}
function facts(value: unknown, path: string, errors: string[]) {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    if (typeof value[0] === 'number' || typeof value[0] === 'string') return;
    value.forEach((child, i) => facts(child, `${path}/${i}`, errors));
    return;
  }
  const item = value as Record<string, any>;
  if ('provenance' in item) {
    const p = item.provenance;
    if (Date.parse(p.period.start) >= Date.parse(p.period.endExclusive))
      errors.push(`${path}: invalid provenance period`);
    if (p.confirmation === 'site_verified' && p.kind !== 'observed')
      errors.push(`${path}: only observed values can be site_verified`);
    if (p.originalResolutionMinutes === 60 && !p.transformation)
      errors.push(`${path}: missing resolution transformation`);
    if (item.uncertainty) {
      const u = item.uncertainty;
      if (
        typeof item.value !== 'number' ||
        u.min > u.max ||
        item.value < u.min ||
        item.value > u.max
      )
        errors.push(`${path}: invalid uncertainty range`);
    }
  }
  for (const [key, child] of Object.entries(item))
    facts(child, `${path}/${key}`, errors);
}
export function validateInput(value: unknown): SimulationInput {
  if (!inputValidator(value))
    throw new ContractError([ajv.errorsText(inputValidator.errors)]);
  const input = value,
    errors: string[] = [];
  try {
    const expected = timestampsForYear(input.time.year);
    if (input.time.timestamps.some((v, i) => v !== expected[i]))
      errors.push('time: expected contiguous JST interval-start timestamps');
  } catch {
    errors.push('time: leap/unsupported year');
  }
  const roofs = new Set(input.roofs.map((r) => r.id));
  if (roofs.size !== input.roofs.length) errors.push('roofs: duplicate id');
  const allowed = new Set(input.constraints.allowedRoofIds);
  if ([...allowed].some((id) => !roofs.has(id)))
    errors.push('constraints: unknown roof');
  const pv = input.equipment.pv,
    battery = input.equipment.battery;
  const allocations = pv.roofAllocations;
  if (new Set(allocations.map((a) => a.roofId)).size !== allocations.length)
    errors.push('equipment: duplicate roof allocation');
  if (allocations.some((a) => !allowed.has(a.roofId)))
    errors.push('equipment: roof not allowed');
  if (
    Math.abs(
      allocations.reduce((sum, a) => sum + a.dcCapacity.value, 0) -
        pv.dcCapacity.value,
    ) > 1e-6
  )
    errors.push('equipment: PV allocation does not sum to DC capacity');
  if ((pv.dcCapacity.value === 0) !== (pv.acCapacity.value === 0))
    errors.push('equipment: PV DC/AC must both be zero or positive');
  if ((battery.capacity.value === 0) !== (battery.power.value === 0))
    errors.push(
      'equipment: battery capacity/power must both be zero or positive',
    );
  if (battery.initialSoc.value < battery.minimumSoc.value)
    errors.push('equipment: initial SOC below minimum');
  if (input.generation.kind === 'absolute_ac') {
    const binding = input.generation.binding;
    if (
      binding.pvDcKw !== pv.dcCapacity.value ||
      binding.pvAcKw !== pv.acCapacity.value ||
      binding.roofsVersion !== input.versions.roofs
    )
      errors.push(
        'generation: absolute AC is bound to its original equipment; switch to weather input to recalculate',
      );
    if (
      binding.roofGeometry.length !== allocations.length ||
      allocations.some((a) => {
        const r = input.roofs.find((r) => r.id === a.roofId),
          b = binding.roofGeometry.find((r) => r.roofId === a.roofId);
        return (
          !r ||
          !b ||
          b.dcKw !== a.dcCapacity.value ||
          b.tilt !== r.tilt.value ||
          b.azimuth !== r.azimuth.value ||
          b.shadingLoss !== r.shadingLoss.value
        );
      })
    )
      errors.push('generation: absolute AC roof geometry mismatch');
    if (
      input.generation.energy.value.some((v) => v > binding.pvAcKw * 0.5 + 1e-6)
    )
      errors.push('generation: AC energy exceeds bound PCS');
    if (input.scenarios.some((s) => s.solarScale.value !== 1))
      errors.push('generation: cannot rescale absolute AC');
  }
  const seriesFacts = [
    input.load.energy,
    input.tariff.purchase,
    input.tariff.export,
    ...(input.generation.kind === 'weather'
      ? [
          input.generation.dni,
          input.generation.dhi,
          input.generation.temperature,
          input.generation.windSpeed,
        ]
      : [input.generation.energy]),
  ];
  const start = `${input.time.year}-01-01T00:00:00+09:00`,
    end = `${input.time.year + 1}-01-01T00:00:00+09:00`;
  if (
    seriesFacts.some(
      (s) =>
        s.provenance.period.start !== start ||
        s.provenance.period.endExclusive !== end,
    )
  )
    errors.push('series: provenance period must match time axis');
  if (new Set(input.scenarios.map((s) => s.id)).size !== input.scenarios.length)
    errors.push('scenarios: duplicate id');
  if (
    new Set(input.costs.events.map((e) => e.id)).size !==
    input.costs.events.length
  )
    errors.push('costs: duplicate event id');
  for (const event of input.costs.events) {
    if (
      event.kind === 'replacement' &&
      (event.year === 0 || event.target === 'project')
    )
      errors.push('costs: replacement needs an equipment target and year >= 1');
    if (
      event.kind === 'replacement' &&
      event.target === 'battery' &&
      !event.replacedCapacityFraction
    )
      errors.push('costs: battery replacement needs a capacity fraction');
    if (
      (event.kind !== 'replacement' || event.target !== 'battery') &&
      event.replacedCapacityFraction
    )
      errors.push('costs: unexpected replacement capacity');
  }
  facts(input, '', errors);
  if (errors.length) throw new ContractError(errors);
  return input;
}
export function validateResult(value: unknown): SimulationResult {
  if (!resultValidator(value))
    throw new ContractError([ajv.errorsText(resultValidator.errors)]);
  const errors: string[] = [];
  if (value.annual.some((v, i) => v.year !== i + 1))
    errors.push('result: annual years must be 1 through 20');
  if (
    value.sustainedRecoveryYear !== null &&
    (value.firstBreakEvenYear === null ||
      value.sustainedRecoveryYear < value.firstBreakEvenYear)
  )
    errors.push('result: inconsistent recovery years');
  facts(value, '', errors);
  if (errors.length) throw new ContractError(errors);
  return value;
}
