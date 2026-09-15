import type { Params, Result, Project } from './simulation';
export async function buildWorkbook(project: Project, p: Params, r: Result) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TRACE PoC';
  const summary = workbook.addWorksheet('試算サマリー');
  summary.addRows([
    ['TRACE / 太陽光・蓄電池導入試算'],
    ['案件', project.name],
    ['データ種別', 'PoC サンプルデータ・簡易計算'],
    ['太陽光容量 kW', p.pv],
    ['蓄電池容量 kWh', p.battery],
    ['年間電気代削減 円', r.savings],
    ['初期投資 円', r.investment],
    ['回収期間 年', r.payback ?? '20年超'],
    ['自家消費率 %', r.selfRate],
    ['年間CO2削減 t', r.co2],
    ['20年累積収支 円', r.profit],
    ['NPV 円', r.npv],
    [
      '計算前提',
      '2025年、30分、17,520区間。税・融資未反映。商用データ・エネがえるの計算エンジンは不使用。',
    ],
  ]);
  const assumptions = workbook.addWorksheet('入力条件');
  assumptions.addRow(['条件キー', '設定値']);
  Object.entries(p)
    .filter(([k]) => !['demandData', 'pvData'].includes(k))
    .forEach(([k, v]) =>
      assumptions.addRow([k, Array.isArray(v) ? v.join(',') : v]),
    );
  const monthly = workbook.addWorksheet('月別電力と料金');
  monthly.addRow([
    '月',
    '需要 kWh',
    '発電 kWh',
    '自家消費 kWh',
    '買電 kWh',
    '余剰 kWh',
    '導入前 円',
    '導入後 円',
    '削減額 円',
  ]);
  r.months.forEach((m) =>
    monthly.addRow([
      m.month + 1,
      m.load,
      m.solar,
      m.direct + m.solarDischarge,
      m.grid,
      m.export,
      m.beforeBill,
      m.afterBill,
      m.beforeBill - m.afterBill,
    ]),
  );
  const cash = workbook.addWorksheet('20年収支');
  cash.addRow([
    '年',
    '削減効果＋売電 円',
    '維持費 円',
    '更新費 円',
    '年間収支 円',
    '累積収支 円',
  ]);
  r.cash.forEach((v) =>
    cash.addRow([
      v.year,
      v.benefit,
      v.maintenance,
      v.replacement,
      v.net,
      v.cumulative,
    ]),
  );
  const series = workbook.addWorksheet('30分値');
  series.addRow([
    '日時',
    '需要 kWh',
    '太陽光 kWh',
    '直接消費 kWh',
    '太陽光充電 kWh',
    '系統充電 kWh',
    '放電 kWh',
    '買電 kWh',
    '余剰 kWh',
    '利用可能残量 kWh',
  ]);
  r.points.forEach((v) =>
    series.addRow([
      new Date(Date.UTC(2025, 0, 1, 0, v.t * 30)).toISOString().slice(0, 16),
      v.load,
      v.solar,
      v.direct,
      v.charge,
      v.gridCharge,
      v.discharge,
      v.grid,
      v.export,
      v.soc,
    ]),
  );
  for (const sheet of workbook.worksheets) {
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF177F69' },
    };
    sheet.columns.forEach((col, i) => {
      col.width = i === 0 ? 25 : 23;
    });
    sheet.eachRow((row, i) => {
      if (i > 1)
        row.eachCell((cell) => {
          if (typeof cell.value === 'number') cell.numFmt = '#,##0.00';
        });
    });
  }
  return workbook;
}
