'use client';
import { useEffect, useId, useState } from 'react';
import {
  Battery,
  Check,
  ChevronRight,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  Sun,
  Zap,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Pick } from './energy-charts';
import { type Params, PROFILE_NAMES, number, LIMITS } from '@/lib/simulation';

export function Numeric({
  label,
  value,
  onChange,
  min = 0,
  max = 100000,
  step = 1,
  unit = '',
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
}) {
  const id = useId(),
    [draft, setDraft] = useState(String(value)),
    [error, setError] = useState('');
  useEffect(() => {
    setDraft(String(value));
    setError('');
  }, [value]);
  function commit() {
    const n = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(n) || n < min || n > max) {
      setError(`${min}〜${max}${unit}で入力`);
      return;
    }
    setError('');
    onChange(n);
  }
  return (
    <div className="numeric-field">
      <label htmlFor={id}>{label}</label>
      <div className="input-unit">
        <Input
          id={id}
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? id + '-error' : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        {unit && <span>{unit}</span>}
      </div>
      {error && (
        <small id={id + '-error'} className="field-error">
          {error}（未反映）
        </small>
      )}
    </div>
  );
}
function Range({
  label,
  value,
  onChange,
  max,
  unit,
  step = 10,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max: number;
  unit: string;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <div className="range-field">
      <div className="slider-label">
        <span>{label}</span>
        <strong>
          {number(value)}
          <small> {unit}</small>
        </strong>
      </div>
      <Slider
        aria-label={label}
        value={[value]}
        min={0}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      />
      <div className="range-ends">
        <span>0 {unit}</span>
        <span>
          {max} {unit}
        </span>
      </div>
    </div>
  );
}
export function Conditions({
  params: p,
  onChange,
  onDemand,
  onReset,
}: {
  params: Params;
  onChange: (p: Partial<Params>) => void;
  onDemand: () => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false),
    [section, setSection] = useState('solar');
  function advanced(s: string) {
    setSection(s);
    setOpen(true);
  }
  function field(key: keyof Params, label: string, unit = '', step = 1) {
    const range = LIMITS[key] ?? [0, 10000];
    return (
      <Numeric
        key={key}
        label={label}
        value={p[key] as number}
        unit={unit}
        min={range[0]}
        max={range[1]}
        step={step}
        onChange={(v) => onChange({ [key]: v })}
      />
    );
  }
  return (
    <>
      <aside className="settings-panel">
        <div className="panel-heading">
          <h2>
            <SlidersHorizontal size={17} />
            導入条件
          </h2>
          <span className="auto-label">
            <span className="live-dot" />
            自動計算
          </span>
        </div>
        <div className="condition-section">
          <h3>
            <Sun size={18} className="solar-text" />
            太陽光発電
            <button
              aria-label="太陽光の詳細条件"
              onClick={() => advanced('solar')}
            >
              <Settings2 size={15} />
            </button>
          </h3>
          <Range
            label="設備容量"
            value={p.pv}
            unit="kW"
            max={1000}
            onChange={(pv) => onChange({ pv, pcs: Math.round(pv * 0.85) })}
            disabled={Boolean(p.pvData)}
          />
          <button className="condition-link" onClick={() => advanced('solar')}>
            <span>
              {p.pvData
                ? 'CSVの発電量を使用'
                : `${p.orientation === 0 ? '南' : p.orientation < 0 ? '東寄り' : '西寄り'}向き · 傾斜 ${p.tilt}° · PCS ${p.pcs} kW`}
            </span>
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="condition-section">
          <h3>
            <Battery size={18} />
            蓄電池
            <button
              aria-label="蓄電池の詳細条件"
              onClick={() => advanced('battery')}
            >
              <Settings2 size={15} />
            </button>
          </h3>
          <Range
            label="実効容量"
            value={p.battery}
            unit="kWh"
            max={1000}
            onChange={(battery) => onChange({ battery })}
          />
          <Pick
            label="蓄電池の運転方針"
            value={p.strategy}
            onChange={(strategy) =>
              onChange({ strategy: strategy as Params['strategy'] })
            }
            options={[
              { value: 'self', label: '自家消費を優先' },
              { value: 'peak', label: 'ピークカットを優先' },
            ]}
          />
          {p.strategy === 'peak' && (
            <Numeric
              label="目標ピーク"
              value={p.target}
              max={2000}
              unit="kW"
              onChange={(target) => onChange({ target })}
            />
          )}
          <div className="condition-line">
            <span>充放電出力 / 往復効率</span>
            <strong>
              {p.power} kW / {p.efficiency}%
            </strong>
          </div>
        </div>
        <div className="condition-section">
          <h3>
            <Zap size={18} />
            需要・電気料金
            <button aria-label="需要条件を編集" onClick={onDemand}>
              <Settings2 size={15} />
            </button>
          </h3>
          <div className="condition-line">
            <span>年間使用量</span>
            <strong>
              {number(
                p.demandData
                  ? p.demandData.reduce((a, b) => a + b, 0) / 1000
                  : p.monthly
                    ? p.monthly.reduce((a, b) => a + b, 0)
                    : p.annual,
              )}{' '}
              MWh
            </strong>
          </div>
          <div className="condition-line">
            <span>昼間の実質単価</span>
            <strong>{number(p.rate + p.fuel + p.levy, 1)} 円/kWh</strong>
          </div>
          <button className="data-source" onClick={onDemand}>
            <Check size={14} />
            {p.demandData
              ? 'CSVからの需要'
              : `${PROFILE_NAMES[p.profile]}テンプレート`}
            <ChevronRight size={13} />
          </button>
          <button className="condition-link" onClick={() => advanced('tariff')}>
            <span>電気料金を編集</span>
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="condition-section">
          <h3>
            投資条件
            <button
              aria-label="投資条件を編集"
              onClick={() => advanced('finance')}
            >
              <Settings2 size={15} />
            </button>
          </h3>
          <div className="condition-line">
            <span>設備費（太陽光 / 蓄電池）</span>
            <strong>
              {p.solarCost} / {p.batteryCost} 万円
            </strong>
          </div>
          <div className="condition-line">
            <span>補助金</span>
            <strong>{number(p.subsidy)} 万円</strong>
          </div>
          <button
            className="condition-link"
            onClick={() => advanced('finance')}
          >
            <span>費用・長期収支の前提を編集</span>
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="condition-section settings-bottom">
          <p className="settings-note">
            2025年・17,520区間を計算。需要、日射、料金はサンプルです。
          </p>
          <button className="button text-button" onClick={onReset}>
            <RotateCcw size={13} />
            この案を初期条件に戻す
          </button>
        </div>
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="detail-sheet">
          <SheetHeader>
            <SheetTitle>導入条件の詳細</SheetTitle>
            <SheetDescription>
              変更はすぐに結果へ反映されます。数値入力は欄を離れると確定します。
            </SheetDescription>
          </SheetHeader>
          <Tabs value={section} onValueChange={(v) => setSection(String(v))}>
            <TabsList className="sheet-tabs">
              <TabsTrigger value="solar">太陽光</TabsTrigger>
              <TabsTrigger value="battery">蓄電池</TabsTrigger>
              <TabsTrigger value="tariff">料金</TabsTrigger>
              <TabsTrigger value="finance">投資</TabsTrigger>
            </TabsList>
            <TabsContent value="solar">
              <div className="field-grid">
                {field('pv', '設備容量', 'kW')}
                {field('pcs', 'パワコン出力', 'kW')}
                {field('yield', '年間発電原単位', 'kWh/kW')}
                {field('orientation', '南を0°とした方位', '°')}
                {field('tilt', '傾斜角', '°')}
              </div>
              <p className="detail-copy">
                発電原単位はサンプル値です。方位・傾斜の補正後、各30分区間をパワコン出力で制限します。複数屋根は合算した1面で近似します。
              </p>
              {p.pvData && (
                <div className="notice-box">
                  CSVの発電量が優先されています。
                  <button
                    className="button secondary"
                    onClick={() => onChange({ pvData: undefined })}
                  >
                    発電テンプレートに戻す
                  </button>
                </div>
              )}
            </TabsContent>
            <TabsContent value="battery">
              <div className="field-grid">
                {field('battery', '実効容量', 'kWh')}
                {field('power', '充放電出力', 'kW')}
                {field('efficiency', '往復変換効率', '%')}
                {field('reserve', '非常用の確保容量', '%')}
                {field('target', '目標ピーク', 'kW')}
              </div>
              <div className="switch-line">
                <label htmlFor="grid-charge">夜間に系統から充電する</label>
                <Switch
                  id="grid-charge"
                  checked={p.gridCharge}
                  onCheckedChange={(gridCharge) => onChange({ gridCharge })}
                />
              </div>
              <p className="detail-copy">
                系統充電は0〜6時に、目標ピークを超えない範囲で実行。自家消費優先では不足時に放電、ピーク優先では目標超過分だけ放電します。自家消費量には太陽光由来の放電だけを計上します。
              </p>
            </TabsContent>
            <TabsContent value="tariff">
              <div className="field-grid">
                {field('rate', '昼間従量料金', '円/kWh', 0.1)}
                {field('nightRate', '夜間従量料金', '円/kWh', 0.1)}
                {field('basic', '基本料金単価', '円/kW・月')}
                {field('fuel', '燃料費調整', '円/kWh', 0.1)}
                {field('levy', '再エネ賦課金', '円/kWh', 0.1)}
                {field('sell', '余剰売電単価', '円/kWh', 0.1)}
              </div>
              <label className="field-caption">基本料金の算定方法</label>
              <Pick
                label="基本料金の算定方法"
                value={p.tariffMode}
                onChange={(tariffMode) =>
                  onChange({ tariffMode: tariffMode as Params['tariffMode'] })
                }
                options={[
                  { value: 'peak', label: '年間ピーク電力で算定（簡易）' },
                  { value: 'fixed', label: '契約電力を固定して算定' },
                ]}
              />
              {p.tariffMode === 'fixed' && field('contract', '契約電力', 'kW')}
              <p className="detail-copy">
                昼間7〜23時、夜間23〜7時の2単価です。税・力率・料金段階・月別燃調・直近12か月の契約更新は省略しています。実在の電力会社の料金ではありません。
              </p>
            </TabsContent>
            <TabsContent value="finance">
              <div className="field-grid">
                {field('solarCost', '太陽光設備単価', '万円/kW', 0.1)}
                {field('batteryCost', '蓄電池設備単価', '万円/kWh', 0.1)}
                {field('subsidy', '補助金額', '万円')}
                {field('maintenance', '年あたり維持費率', '%', 0.1)}
                {field('escalation', '電気料金の年間上昇率', '%', 0.1)}
                {field('degradation', '年間劣化率', '%', 0.1)}
                {field('replacement', '12年目の設備更新費', '万円')}
                {field('discount', '割引率', '%', 0.1)}
                {field('co2', '排出係数', 'kg/kWh', 0.01)}
              </div>
              <p className="detail-copy">
                自己所有・20年の概算。補助金は設備費を上限に控除。初年度の削減額に上昇率と劣化率を掛ける簡易モデルで、税・融資・設備別の劣化は未反映です。
              </p>
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>
    </>
  );
}
