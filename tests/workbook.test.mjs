import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildWorkbook } from '../lib/workbook.ts';
import { DEMO_PROJECTS, DEFAULTS, simulate, STEPS } from '../lib/simulation.ts';

test('XLSX roundtrip preserves five sheets, 17520 intervals and exact UI totals', async () => {
  const r = simulate(DEFAULTS),
    workbook = await buildWorkbook(DEMO_PROJECTS[0], DEFAULTS, r);
  const bytes = await workbook.xlsx.writeBuffer(),
    read = new ExcelJS.Workbook();
  await read.xlsx.load(bytes);
  assert.equal(read.worksheets.length, 5);
  assert.equal(read.getWorksheet('30分値').rowCount, STEPS + 1);
  assert.equal(
    read.getWorksheet('試算サマリー').getCell('B6').value,
    r.savings,
  );
  assert.equal(read.getWorksheet('20年収支').getCell('F22').value, r.profit);
  assert.equal(
    read.getWorksheet('30分値').getCell('A2').value,
    '2025-01-01T00:00',
  );
  assert.equal(
    read.getWorksheet('30分値').getCell(`A${STEPS + 1}`).value,
    '2025-12-31T23:30',
  );
});
