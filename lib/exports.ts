import {
  type Params,
  type Result,
  type Project,
  timestamp,
  man,
  number,
} from './simulation';

export function download(
  content: string | Blob,
  name: string,
  type = 'text/plain;charset=utf-8',
) {
  const blob =
    typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
export function csvDownload(r: Result, name: string) {
  const head =
    'timestamp,demand_kwh,pv_kwh,direct_kwh,pv_charge_kwh,grid_charge_kwh,discharge_kwh,grid_kwh,export_kwh,usable_soc_kwh';
  const rows = r.points.map((p) =>
    [
      timestamp(p.t),
      ...[
        p.load,
        p.solar,
        p.direct,
        p.charge,
        p.gridCharge,
        p.discharge,
        p.grid,
        p.export,
        p.soc,
      ].map((v) => v.toFixed(4)),
    ].join(','),
  );
  download(
    '\uFEFF' + [head, ...rows].join('\r\n'),
    `${name}_30分値.csv`,
    'text/csv;charset=utf-8',
  );
}
export async function excelDownload(project: Project, p: Params, r: Result) {
  const { buildWorkbook } = await import('./workbook');
  const workbook = await buildWorkbook(project, p, r);
  const buffer = await workbook.xlsx.writeBuffer();
  download(
    new Blob([new Uint8Array(buffer)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${project.name}_導入試算.xlsx`,
  );
}
export function reportText(project: Project, p: Params, r: Result) {
  return `${project.name} / 太陽光・蓄電池導入検討\n\n太陽光 ${p.pv} kW / 蓄電池 ${p.battery} kWh\n年間電気代削減 ${man(r.savings)} 万円\n初期投資 ${man(r.investment)} 万円\n自家消費率 ${number(r.selfRate, 1)} %\n20年間の累積収支 ${man(r.profit)} 万円\n\nPoC・サンプルデータ。税・融資を除く簡易試算。`;
}
