import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS,
  simulate,
  series,
  STEPS,
  parseSeriesCSV,
  timestamp,
  validateParams,
} from '../lib/simulation.ts';

test('annual demand totals and monthly totals preserve input energy', () => {
  const r = simulate(DEFAULTS);
  assert.equal(r.points.length, STEPS);
  assert.ok(Math.abs(r.load - 1200000) < 1e-6);
  const monthly = Array.from({ length: 12 }, (_, i) => 50 + i * 10),
    s = simulate({ ...DEFAULTS, monthly });
  s.months.forEach((m, i) =>
    assert.ok(Math.abs(m.load - monthly[i] * 1000) < 1e-6),
  );
});
test('each half hour conserves electrical energy and battery energy', () => {
  for (const strategy of ['self', 'peak'])
    for (const gridCharge of [true, false]) {
      const p = {
          ...DEFAULTS,
          pv: 650,
          pcs: 500,
          battery: 350,
          power: 90,
          strategy,
          gridCharge,
        },
        r = simulate(p),
        eta = Math.sqrt(p.efficiency / 100);
      let previous = 0;
      for (const x of r.points) {
        assert.ok(
          Math.abs(
            x.solar +
              x.grid +
              x.discharge -
              x.load -
              x.charge -
              x.gridCharge -
              x.export,
          ) < 1e-7,
        );
        assert.ok(
          Math.abs(
            x.soc -
              previous -
              (x.charge + x.gridCharge) * eta +
              x.discharge / eta,
          ) < 1e-7,
        );
        assert.ok(x.soc >= -1e-8 && x.soc <= r.capacity + 1e-7);
        assert.ok(x.charge + x.gridCharge <= p.power * 0.5 + 1e-8);
        assert.ok(x.discharge <= p.power * 0.5 + 1e-8);
        assert.ok(!(x.discharge > 1e-8 && x.charge + x.gridCharge > 1e-8));
        previous = x.soc;
      }
      assert.ok(r.self <= r.solar + 1e-7 && r.self <= r.load + 1e-7);
    }
});
test('zero equipment yields zero savings and no battery energy', () => {
  const r = simulate({ ...DEFAULTS, pv: 0, battery: 0 });
  assert.equal(r.savings, 0);
  assert.equal(r.solar, 0);
  assert.equal(r.investment, 0);
  assert.equal(r.profit, 0);
  assert.equal(r.selfRate, 0);
  assert.ok(
    r.points.every((p) => p.soc === 0 && p.charge === 0 && p.discharge === 0),
  );
});
test('grid-origin battery energy does not count as solar self-consumption', () => {
  const r = simulate({ ...DEFAULTS, pv: 0, battery: 500, gridCharge: true });
  assert.ok(r.months.some((m) => m.gridCharge > 0));
  assert.ok(r.months.some((m) => m.discharge > 0));
  assert.equal(r.self, 0);
  assert.equal(r.selfRate, 0);
});
test('PCS limits generation; fixed contract has no basic-fee peak savings', () => {
  const p = { ...DEFAULTS, pv: 800, pcs: 80, tariffMode: 'fixed' },
    r = simulate(p);
  assert.ok(r.points.every((x) => x.solar <= 40 + 1e-9));
  for (const m of r.months)
    assert.ok(
      Math.abs(m.beforeBill - m.beforeEnergy - (m.afterBill - m.afterEnergy)) <
        1e-6,
    );
});
test('cash flows, subsidy ceiling and NPV are internally consistent', () => {
  const p = { ...DEFAULTS, subsidy: 50000 },
    r = simulate(p);
  assert.equal(r.investment, 0);
  assert.equal(r.subsidy, r.equipment);
  const normal = simulate(DEFAULTS);
  assert.ok(
    Math.abs(normal.cash.reduce((a, v) => a + v.net, 0) - normal.profit) < 1e-6,
  );
  const npv = normal.cash.reduce(
    (a, v) => a + v.net / Math.pow(1 + DEFAULTS.discount / 100, v.year),
    0,
  );
  assert.ok(Math.abs(npv - normal.npv) < 1e-6);
  assert.equal(normal.cash[12].replacement, DEFAULTS.replacement * 10000);
  assert.equal(normal.cash.filter((x) => x.replacement > 0).length, 1);
});
test('CSV roundtrip and deliberate failures for gap, invalid value, wrong schema', () => {
  const values = series(DEFAULTS).load,
    rows = values.map((v, i) => `${timestamp(i)},${v}`),
    csv = 'timestamp,demand_kwh\n' + rows.join('\n');
  assert.deepEqual(parseSeriesCSV(csv, 'demand'), values);
  assert.throws(
    () =>
      parseSeriesCSV(
        'timestamp,demand_kwh\n' + rows.slice(1).join('\n'),
        'demand',
      ),
    /17,520/,
  );
  const bad = [...rows];
  bad[100] = `${timestamp(100)},-1`;
  assert.throws(
    () => parseSeriesCSV('timestamp,demand_kwh\n' + bad.join('\n'), 'demand'),
    /102行目/,
  );
  assert.throws(() => parseSeriesCSV(csv, 'pv'), /pv_kwh/);
});
test('invalid persisted inputs cannot enter simulation', () => {
  assert.equal(validateParams(DEFAULTS), true);
  for (const p of [
    { ...DEFAULTS, pv: NaN },
    { ...DEFAULTS, efficiency: 0 },
    { ...DEFAULTS, start: 20, end: 10 },
    { ...DEFAULTS, pvData: [3] },
    { ...DEFAULTS, monthly: Array(12).fill(0) },
    { ...DEFAULTS, profile: 'invalid' },
  ])
    assert.equal(validateParams(p), false);
});
