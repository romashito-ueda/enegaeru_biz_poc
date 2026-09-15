export const INTERVALS = 17520;
export const INTERVAL_HOURS = 0.5;
export function timestampsForYear(year: number): string[] {
  if (!Number.isInteger(year) || year < 2001 || year > 2099 || year % 4 === 0)
    throw new Error('PoC supports ordinary years from 2001 to 2099 only.');
  const start = Date.UTC(year, 0, 1);
  return Array.from(
    { length: INTERVALS },
    (_, i) =>
      new Date(start + i * 1800000).toISOString().slice(0, 19) + '+09:00',
  );
}
export const energyToAveragePower = (kwh: number) => kwh / INTERVAL_HOURS;
export const averagePowerToEnergy = (kw: number) => kw * INTERVAL_HOURS;
// Legacy UI: negative=east, zero=south, positive=west.
export function legacyAzimuthToNorth(degrees: number): number {
  if (!Number.isFinite(degrees) || degrees < -90 || degrees > 90)
    throw new Error('Invalid legacy azimuth');
  return (180 + degrees) % 360;
}
export function hourlyEnergyToHalfHourly(hourly: number[]): number[] {
  if (
    hourly.length !== 8760 ||
    hourly.some((v) => !Number.isFinite(v) || v < 0)
  )
    throw new Error('Expected 8760 nonnegative hourly kWh values.');
  return hourly.flatMap((v) => [v / 2, v / 2]);
}
