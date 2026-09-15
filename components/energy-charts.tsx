'use client';
import { useMemo, useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowRight, Battery, Factory, Sun } from 'lucide-react';
import { ChartContainer } from '@/components/ui/chart';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  type Result,
  type Params,
  type Point,
  man,
  number,
  years,
} from '@/lib/simulation';

export function Pick({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => v !== null && onChange(String(v))}
      items={options}
    >
      <SelectTrigger aria-label={label} className="trace-select">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
const CHART_CONFIG = {
  solar: { label: '太陽光発電', color: '#e5ac37' },
  load: { label: '電力需要', color: '#617991' },
  grid: { label: '買電', color: '#158875' },
  discharge: { label: '蓄電池放電', color: '#a38ac2' },
  soc: { label: '蓄電池残量', color: '#a38ac2' },
};
function averageDay(points: Point[], month: number, weekend: boolean) {
  const sums = Array.from({ length: 48 }, (_, i) => ({
    hour: i / 2,
    time: `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`,
    solar: 0,
    load: 0,
    grid: 0,
    discharge: 0,
    soc: 0,
    n: 0,
  }));
  for (const p of points) {
    const dow = (p.day + 3) % 7;
    if (p.month !== month || [0, 6].includes(dow) !== weekend) continue;
    const row = sums[p.t % 48];
    for (const key of ['solar', 'load', 'grid', 'discharge'] as const)
      row[key] += p[key] * 2;
    row.soc += p.soc;
    row.n++;
  }
  return sums.map((r) => ({
    ...r,
    solar: r.solar / (r.n || 1),
    load: r.load / (r.n || 1),
    grid: r.grid / (r.n || 1),
    discharge: r.discharge / (r.n || 1),
    soc: r.soc / (r.n || 1),
  }));
}
export function EnergyChart({
  result: r,
  params: p,
}: {
  result: Result;
  params: Params;
}) {
  const [month, setMonth] = useState('7'),
    [day, setDay] = useState('weekday');
  const data = useMemo(
    () => averageDay(r.points, Number(month), day === 'weekend'),
    [r, month, day],
  );
  return (
    <>
      <section className="panel chart-panel">
        <div className="panel-heading">
          <div>
            <h2>電気を、つくる・ためる・つかう。</h2>
            <p>30分ごとの電力バランス · 月内の平均日</p>
          </div>
          <div className="chart-filters">
            <Pick
              label="表示する月"
              value={month}
              onChange={setMonth}
              options={Array.from({ length: 12 }, (_, i) => ({
                value: String(i),
                label: `${i + 1}月`,
              }))}
            />
            <Pick
              label="表示する曜日区分"
              value={day}
              onChange={setDay}
              options={[
                { value: 'weekday', label: '平日' },
                { value: 'weekend', label: '土日' },
              ]}
            />
          </div>
        </div>
        <div className="chart-legend">
          <span>
            <i className="dot demand" />
            需要
          </span>
          <span>
            <i className="dot solar" />
            太陽光
          </span>
          <span>
            <i className="dot grid" />
            買電
          </span>
          <span>
            <i className="dot battery" />
            放電
          </span>
        </div>
        <div className="chart-unit">kW</div>
        <ChartContainer
          config={CHART_CONFIG}
          className="real-chart"
          aria-label="平均日の30分ごとの需要・太陽光発電・買電・蓄電池放電"
        >
          <ComposedChart
            data={data}
            margin={{ top: 10, right: 10, bottom: 0, left: -14 }}
            accessibilityLayer
          >
            <defs>
              <linearGradient id="solarFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#efbd50" stopOpacity={0.42} />
                <stop offset="1" stopColor="#efbd50" stopOpacity={0.025} />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke="#e8edf0"
              strokeDasharray="3 4"
            />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              interval={7}
              tick={{ fontSize: 12 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12 }}
              width={55}
            />
            <Tooltip
              formatter={(value, name) => [
                `${number(Number(value), 1)} kW`,
                name,
              ]}
              contentStyle={{
                borderRadius: 8,
                border: '1px solid #dbe5e8',
                fontSize: 12,
              }}
              labelFormatter={(v) => `${v} の電力バランス`}
            />
            <Area
              isAnimationActive={false}
              type="monotone"
              dataKey="solar"
              name="太陽光発電"
              stroke="#dfaa34"
              fill="url(#solarFill)"
              strokeWidth={2}
            />
            <Bar
              isAnimationActive={false}
              dataKey="discharge"
              name="蓄電池放電"
              fill="#c0a6d6"
              radius={[2, 2, 0, 0]}
            />
            <Line
              isAnimationActive={false}
              type="monotone"
              dataKey="load"
              name="電力需要"
              dot={false}
              stroke="#617991"
              strokeWidth={2}
              strokeDasharray="5 4"
            />
            <Line
              isAnimationActive={false}
              type="monotone"
              dataKey="grid"
              name="買電"
              dot={false}
              stroke="#158875"
              strokeWidth={2.5}
            />
            {p.strategy === 'peak' && (
              <ReferenceLine
                y={p.target}
                stroke="#ad6673"
                strokeDasharray="3 4"
              />
            )}
          </ComposedChart>
        </ChartContainer>
        <div className="energy-strip">
          <div>
            <Sun size={20} />
            <span>
              年間発電量
              <strong>
                {number(r.solar / 1000, 1)} <small>MWh</small>
              </strong>
            </span>
          </div>
          <ArrowRight size={17} />
          <div>
            <Battery size={20} />
            <span>
              太陽光からの充電
              <strong>
                {number(r.months.reduce((a, m) => a + m.charge, 0) / 1000, 1)}{' '}
                <small>MWh</small>
              </strong>
            </span>
          </div>
          <ArrowRight size={17} />
          <div>
            <Factory size={20} />
            <span>
              施設での自家消費
              <strong>
                {number(r.self / 1000, 1)} <small>MWh</small>
              </strong>
            </span>
          </div>
        </div>
      </section>
      <div className="secondary-metrics">
        <div>
          <span>年間CO₂削減量</span>
          <strong>
            {number(r.co2, 1)}
            <small> t-CO₂</small>
          </strong>
        </div>
        <div>
          <span>年間ピークの削減</span>
          <strong>
            {number(r.beforePeak - r.afterPeak, 1)}
            <small> kW</small>
          </strong>
        </div>
        <div>
          <span>需要を再エネで賄う割合</span>
          <strong>
            {number(r.autonomy, 1)}
            <small> %</small>
          </strong>
        </div>
      </div>
      <details className="data-details">
        <summary>月別データと蓄電池残量を確認</summary>
        <p className="detail-copy">
          残量は非常用の確保分を除く利用可能量です。各時点の最大値は{' '}
          {number(r.capacity)}{' '}
          kWh。グラフの平均日は、実際のピーク日とは異なります。
        </p>
        <ChartContainer config={CHART_CONFIG} className="soc-chart">
          <ComposedChart data={data}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="time" interval={11} tick={{ fontSize: 12 }} />
            <YAxis width={45} tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(v) => [`${number(Number(v), 1)} kWh`, '蓄電池残量']}
            />
            <Area
              dataKey="soc"
              stroke="#a38ac2"
              fill="#f0e8f5"
              isAnimationActive={false}
            />
          </ComposedChart>
        </ChartContainer>
        <Table className="data-table">
          <TableHeader>
            <TableRow>
              {[
                '月',
                '需要 MWh',
                '発電 MWh',
                '買電 MWh',
                '余剰 MWh',
                '削減額 万円',
              ].map((v) => (
                <TableHead key={v}>{v}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.months.map((m) => (
              <TableRow key={m.month}>
                <TableCell>{m.month + 1}月</TableCell>
                {[m.load, m.solar, m.grid, m.export].map((v, i) => (
                  <TableCell key={i}>{number(v / 1000, 1)}</TableCell>
                ))}
                <TableCell>{man(m.beforeBill - m.afterBill, 1)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </>
  );
}
export function FinanceChart({
  result: r,
  params: p,
}: {
  result: Result;
  params: Params;
}) {
  const data = r.cash.map((row) => ({
    ...row,
    cumulative: row.cumulative / 10000,
    net: row.net / 10000,
  }));
  return (
    <>
      <section className="panel finance-panel">
        <div className="panel-heading">
          <div>
            <h2>投資が、価値に変わるまで。</h2>
            <p>20年間の累積キャッシュフロー · 万円</p>
          </div>
          <span className="soft-badge">回収 {years(r.payback)}</span>
        </div>
        <ChartContainer
          config={{
            cumulative: { color: '#158875', label: '累積収支' },
            net: { color: '#dbe8e3', label: '年間収支' },
          }}
          className="real-chart"
        >
          <ComposedChart data={data} margin={{ left: 0, right: 12, top: 25 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 4" />
            <XAxis
              dataKey="year"
              tickLine={false}
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => `${v}年`}
            />
            <YAxis tickLine={false} tick={{ fontSize: 12 }} width={60} />
            <Tooltip
              formatter={(v, n) => [`${number(Number(v))}万円`, n]}
              labelFormatter={(v) => `${v}年目`}
            />
            <ReferenceLine y={0} stroke="#96a6ac" />
            <Bar
              dataKey="net"
              name="年間収支"
              fill="#d5e6df"
              isAnimationActive={false}
            />
            <Line
              dataKey="cumulative"
              name="累積収支"
              stroke="#158875"
              strokeWidth={3}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ChartContainer>
        <div className="finance-summary">
          <div>
            <span>初期投資（補助金控除後）</span>
            <strong>
              {man(r.investment)} <small>万円</small>
            </strong>
          </div>
          <div>
            <span>20年間の累積収支</span>
            <strong className={r.profit >= 0 ? 'green' : 'negative'}>
              {man(r.profit)} <small>万円</small>
            </strong>
          </div>
          <div>
            <span>現在価値での収支（NPV）</span>
            <strong>
              {man(r.npv)} <small>万円</small>
            </strong>
          </div>
        </div>
      </section>
      <div className="assumption-line">
        電気料金上昇 {p.escalation}% / 年 · 発電劣化 {p.degradation}% / 年 ·
        維持費 {p.maintenance}% / 年 · 12年目の更新費 {p.replacement}万円 ·
        割引率 {p.discount}%
      </div>
      <details className="data-details">
        <summary>年ごとの収支を確認</summary>
        <Table className="data-table">
          <TableHeader>
            <TableRow>
              {[
                '年',
                '削減＋売電 万円',
                '維持費 万円',
                '更新費 万円',
                '累積収支 万円',
              ].map((v) => (
                <TableHead key={v}>{v}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.cash.map((row) => (
              <TableRow key={row.year}>
                <TableCell>{row.year}年</TableCell>
                {[
                  row.benefit,
                  row.maintenance,
                  row.replacement,
                  row.cumulative,
                ].map((v, i) => (
                  <TableCell key={i}>{man(v, 1)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </>
  );
}
