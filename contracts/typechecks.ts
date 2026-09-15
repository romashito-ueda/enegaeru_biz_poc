import type { SimulationInput } from './schema.ts';
// @ts-expect-error Unknown business profile must not enter the contract.
const badProfile: SimulationInput['site']['profile'] = 'unknown';
// @ts-expect-error Interval energy must not be confused with average power.
const badEnergyUnit: SimulationInput['load']['energy']['unit'] = 'kW';
// @ts-expect-error Grid charging is excluded in contract v1.
const badGridCharging: SimulationInput['equipment']['battery']['gridCharging'] = true;
void [badProfile, badEnergyUnit, badGridCharging];
