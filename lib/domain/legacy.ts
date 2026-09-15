import type { Params, Project } from '../simulation.ts';
import { legacyAzimuthToNorth } from './time.ts';

type Mapping = {
  status: 'mapped' | 'confirm' | 'excluded';
  target: string;
  reason: string;
};
const mapped = (target: string, reason = '単位を維持'): Mapping => ({
  status: 'mapped',
  target,
  reason,
});
const confirm = (target: string, reason: string): Mapping => ({
  status: 'confirm',
  target,
  reason,
});
const excluded = (reason: string): Mapping => ({
  status: 'excluded',
  target: 'legacyArchive',
  reason,
});
// Exhaustive at compile time: adding a legacy Params field requires a migration decision.
export const LEGACY_PARAM_MAPPING = {
  pv: mapped('equipment.pv.dcCapacity'),
  pcs: mapped('equipment.pv.acCapacity'),
  battery: mapped('equipment.battery.capacity'),
  power: mapped('equipment.battery.power'),
  efficiency: mapped('equipment.battery.roundTripEfficiency', '% → fraction'),
  reserve: mapped('equipment.battery.minimumSoc', '% → fraction'),
  strategy: confirm(
    'equipment.battery.dispatch',
    'selfのみ受理。peakは方式変更の確認が必要',
  ),
  target: excluded('契約電力・ピーク制御を今回の評価から除外'),
  gridCharge: confirm(
    'equipment.battery.gridCharging',
    'trueは方式変更の確認が必要',
  ),
  annual: mapped('load profile annual energy', 'MWh → kWh'),
  profile: mapped('site.profile'),
  weekend: mapped('load profile weekend multiplier', '% → ratio'),
  start: mapped('load profile startHour'),
  end: mapped('load profile endHour'),
  monthly: mapped(
    'load profile monthly energy',
    'MWh → kWh。demandDataがある場合は補助設定として保存',
  ),
  demandData: confirm(
    'load.energy',
    '時刻・欠損・期間を検証し、CSVの来歴は未確認のまま保持',
  ),
  pvData: confirm(
    'generation.absolute_ac',
    '取込時の設備が不明。現在値に自動で紐づけず確認が必要',
  ),
  rate: mapped('tariff.purchase daytime component'),
  nightRate: mapped('tariff.purchase nighttime component'),
  fuel: mapped('tariff.purchase fuel component'),
  levy: mapped('tariff.purchase levy component'),
  basic: excluded('基本料金削減は評価対象外'),
  tariffMode: excluded('旧項目は基本料金のpeak/fixed方式'),
  contract: excluded('契約電力は評価対象外'),
  yield: confirm(
    'generation weather calibration',
    'kWh/kW/yearの年間原単位から気象は復元不可',
  ),
  orientation: mapped(
    'roofs[].azimuth',
    '南0・東負・西正 → 北0・東90・南180・西270',
  ),
  tilt: mapped('roofs[].tilt'),
  solarCost: confirm(
    'costs.pv / pvPcs / construction',
    '万円/kW → 円/kW。旧一括費用を任意に分解しない',
  ),
  batteryCost: confirm(
    'costs.battery / batteryPcs',
    '万円/kWh → 円/kWh。PCS費の内訳を確認',
  ),
  subsidy: confirm(
    'costs.events[subsidy]',
    '万円 → 円。旧実装の設備費上限による切り捨てを確認',
  ),
  maintenance: mapped(
    'costs.annualMaintenance',
    '% of gross equipment cost → fraction/year',
  ),
  escalation: mapped('tariff.annualEscalation', '% → fraction/year'),
  degradation: mapped(
    'equipment.pv.annualDegradation',
    '% → fraction/year。金額へ直接掛けない',
  ),
  replacement: confirm(
    'costs.events[replacement]',
    '万円 → 円。12年目という旧時期を保持し、更新対象と容量割合を確認',
  ),
  discount: mapped('evaluation.discountRate', '% → fraction/year'),
  sell: mapped('tariff.export'),
  co2: mapped('evaluation.carbonIntensity'),
} satisfies Record<keyof Params, Mapping>;

export function inspectLegacyProject(project: Project) {
  const snapshots = [
    { id: project.id, params: project.params },
    ...project.saved.map((s) => ({ id: s.id, params: s.params })),
  ];
  const entries = snapshots.map((snapshot) => ({
    id: snapshot.id,
    fields: Object.entries(snapshot.params).map(([key, value]) => ({
      key,
      value,
      ...(LEGACY_PARAM_MAPPING[key as keyof Params] ??
        confirm('legacyArchive', '未知の項目。破棄せず確認')),
    })),
    conversions: {
      azimuth: legacyAzimuthToNorth(snapshot.params.orientation),
      annualKwh: snapshot.params.annual * 1000,
      roundTripEfficiency: snapshot.params.efficiency / 100,
      minimumSoc: snapshot.params.reserve / 100,
      pvBundledJpyPerKw: snapshot.params.solarCost * 10000,
      batteryBundledJpyPerKwh: snapshot.params.batteryCost * 10000,
    },
  }));
  return {
    status: 'needs_confirmation' as const,
    // Including saved scenarios, IDs, location, timestamps and unknown fields.
    legacyArchive: structuredClone(project),
    entries,
    message:
      '移行プレビューです。確認が必要な項目を解消するまで計算用入力として送信しません。',
  };
}
