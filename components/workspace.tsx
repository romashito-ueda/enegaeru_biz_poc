'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  ArrowDownRight,
  ArrowRight,
  Battery,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Download,
  Factory,
  FileText,
  FolderKanban,
  Leaf,
  PanelsTopLeft,
  Plus,
  Printer,
  Save,
  Search,
  Sun,
  Upload,
  Zap,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Conditions, Numeric } from './conditions';
import { EnergyChart, FinanceChart, Pick } from './energy-charts';
import {
  DEFAULTS,
  DEMO_PROJECTS,
  PROFILE_NAMES,
  simulate,
  series,
  parseSeriesCSV,
  timestamp,
  number,
  man,
  years,
  validateParams,
  type Params,
  type Profile,
  type Project,
  type Result,
} from '@/lib/simulation';
import { csvDownload, download, excelDownload } from '@/lib/exports';

type Screen = 'simulation' | 'projects' | 'report' | 'help';
const STORAGE = 'trace-workspace-v1';
const SCENARIOS = ['太陽光のみ', '太陽光 ＋ 蓄電池', 'カスタム案'];
function restoreProjects(value: unknown): value is Project[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 40 &&
    value.every(
      (p) =>
        p &&
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        p.name.length <= 80 &&
        typeof p.location === 'string' &&
        validateParams(p.params) &&
        Array.isArray(p.saved) &&
        p.saved.length <= 20 &&
        p.saved.every((s: unknown) => {
          const a = s as Project['saved'][0];
          return (
            a &&
            typeof a.name === 'string' &&
            typeof a.id === 'string' &&
            typeof a.date === 'string' &&
            validateParams(a.params)
          );
        }),
    )
  );
}

export default function Workspace() {
  const [projects, setProjects] = useState<Project[]>(DEMO_PROJECTS),
    [activeId, setActiveId] = useState('tsukuba'),
    [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>('simulation'),
    [scenario, setScenario] = useState(1),
    [tab, setTab] = useState('energy');
  const [modal, setModal] = useState<'save' | 'new' | 'demand' | null>(null),
    [name, setName] = useState(''),
    [location, setLocation] = useState(''),
    [profile, setProfile] = useState<Profile>('factory');
  const [status, setStatus] = useState('このブラウザに自動保存'),
    [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [exporting, setExporting] = useState(false);
  const project = projects.find((p) => p.id === activeId) ?? projects[0];
  const presetPV =
    DEMO_PROJECTS.find((p) => p.id === project.id)?.params.pv ?? 300;
  const options = useMemo(
    () => [
      {
        ...project.params,
        pv: presetPV,
        pcs: Math.round(presetPV * 0.85),
        battery: 0,
      },
      {
        ...project.params,
        pv: presetPV,
        pcs: Math.round(presetPV * 0.85),
        battery: 200,
      },
      project.params,
    ],
    [project.params, presetPV],
  );
  const results = useMemo(() => options.map(simulate), [options]);
  const p = options[scenario],
    r = results[scenario];
  const withoutBattery = useMemo(() => simulate({ ...p, battery: 0 }), [p]);
  const stateRef = useRef({ p, r, project });
  stateRef.current = { p, r, project };
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw) {
        const data = JSON.parse(raw);
        if (!restoreProjects(data.projects)) throw new Error('invalid');
        setProjects(data.projects);
        if (data.projects.some((q: Project) => q.id === data.activeId))
          setActiveId(data.activeId);
        setScenario([0, 1, 2].includes(data.scenario) ? data.scenario : 2);
      }
    } catch {
      setStatus('保存データを読み込めませんでした。サンプルを表示中');
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(
        STORAGE,
        JSON.stringify({ version: 1, projects, activeId, scenario }),
      );
      setStatus('このブラウザに保存済み');
    } catch {
      setStatus('保存容量が不足しています。案件データを書き出してください');
    }
  }, [projects, activeId, scenario, ready]);
  function update(partial: Partial<Params>) {
    const next = { ...p, ...partial };
    if (!validateParams(next)) {
      setError(
        '条件を反映できません。入力値と稼働時間の範囲を確認してください。',
      );
      return;
    }
    setProjects((prev) =>
      prev.map((q) =>
        q.id === project.id ? { ...q, params: next, profile: next.profile } : q,
      ),
    );
    setScenario(2);
    setError('');
  }
  function navigate(s: Screen) {
    setScreen(s);
    setError('');
  }
  function selectProject(id: string) {
    setActiveId(id);
    setScenario(2);
    navigate('simulation');
  }
  function openModal(type: 'save' | 'new' | 'demand') {
    setName(type === 'save' ? `検討案 ${project.saved.length + 1}` : '');
    setLocation('');
    setError('');
    setModal(type);
  }
  function saveScenario() {
    if (!name.trim()) {
      setError('案の名前を入力してください。');
      return;
    }
    if (project.saved.length >= 20) {
      setError('保存できる案は案件ごとに20件までです。');
      return;
    }
    setProjects((prev) =>
      prev.map((q) =>
        q.id === project.id
          ? {
              ...q,
              saved: [
                ...q.saved,
                {
                  id: crypto.randomUUID(),
                  name: name.trim(),
                  params: { ...p },
                  date: new Date().toISOString(),
                },
              ],
            }
          : q,
      ),
    );
    setModal(null);
    setTab('compare');
  }
  function createProject() {
    if (projects.length >= 40) {
      setError('案件は40件までです。');
      return;
    }
    if (!name.trim()) {
      setError('案件名を入力してください。');
      return;
    }
    const id = crypto.randomUUID();
    const defaults = DEMO_PROJECTS.find((q) => q.profile === profile)!.params;
    setProjects((prev) => [
      ...prev,
      {
        id,
        name: name.trim(),
        location: location.trim() || '所在地未設定',
        profile,
        params: { ...defaults },
        saved: [],
      },
    ]);
    setActiveId(id);
    setScenario(2);
    setModal(null);
    navigate('simulation');
  }
  async function importData(file: File | undefined, kind: 'demand' | 'pv') {
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error('5MB以下のCSVを選んでください。');
      const values = parseSeriesCSV(await file.text(), kind);
      update(
        kind === 'demand'
          ? { demandData: values, monthly: undefined }
          : { pvData: values },
      );
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'CSVを読み込めませんでした。');
    }
  }
  async function exportExcel() {
    setExporting(true);
    setError('');
    try {
      await excelDownload(project, p, r);
      setStatus('Excelファイルを書き出しました');
    } catch {
      setError('Excelを書き出せませんでした。CSV出力を利用してください。');
    } finally {
      setExporting(false);
    }
  }
  function template(kind: 'demand' | 'pv') {
    const data = series(p);
    const values = kind === 'demand' ? data.load : data.solar;
    download(
      '\uFEFF' +
        `timestamp,${kind === 'demand' ? 'demand' : 'pv'}_kwh\r\n` +
        values.map((v, i) => `${timestamp(i)},${v.toFixed(4)}`).join('\r\n'),
      `trace_${kind}_template.csv`,
      'text/csv;charset=utf-8',
    );
  }

  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            t: object,
            o: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context) return;
    const controller = new AbortController();
    const tools = [
      {
        name: 'read_energy_scenario',
        title: '現在の導入案を読む',
        description: '表示中の入力と年間削減・回収・自家消費を取得します。',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: () => {
          const s = stateRef.current;
          return {
            project: s.project.name,
            pv: s.p.pv,
            battery: s.p.battery,
            savingsYen: s.r.savings,
            paybackYears: s.r.payback,
            selfConsumptionPercent: s.r.selfRate,
            mockData: true,
          };
        },
      },
      {
        name: 'configure_energy_scenario',
        title: '設備容量を調整する',
        description:
          '表示中の案件のカスタム案を更新して再計算します。提案書の送信はしません。',
        inputSchema: {
          type: 'object',
          properties: {
            pv: { type: 'number', minimum: 0, maximum: 1000 },
            battery: { type: 'number', minimum: 0, maximum: 1000 },
          },
          additionalProperties: false,
          minProperties: 1,
        },
        annotations: { readOnlyHint: false },
        execute: (input: unknown) => {
          if (!input || typeof input !== 'object')
            throw new Error('object required');
          const changes = input as Record<string, unknown>;
          if (
            !Object.keys(changes).length ||
            Object.keys(changes).some(
              (k) =>
                !['pv', 'battery'].includes(k) ||
                typeof changes[k] !== 'number' ||
                !Number.isFinite(changes[k]) ||
                Number(changes[k]) < 0 ||
                Number(changes[k]) > 1000,
            )
          )
            throw new Error('pv/battery must be between 0 and 1000');
          const s = stateRef.current;
          if (s.p.pvData && changes.pv !== undefined)
            throw new Error(
              'PV CSV is active. Restore the generation template first.',
            );
          const next = {
            ...s.p,
            ...changes,
            pcs:
              changes.pv !== undefined
                ? Math.round(Number(changes.pv) * 0.85)
                : s.p.pcs,
          } as Params;
          flushSync(() => {
            setProjects((prev) =>
              prev.map((q) =>
                q.id === s.project.id ? { ...q, params: next } : q,
              ),
            );
            setScenario(2);
            setScreen('simulation');
          });
          const result = simulate(next);
          return {
            pv: next.pv,
            battery: next.battery,
            savingsYen: result.savings,
          };
        },
      },
    ];
    for (const tool of tools)
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: controller.signal }),
        ).catch(() => {});
      } catch {
        /* optional browser capability */
      }
    return () => controller.abort();
  }, []);

  return (
    <SidebarProvider
      style={{ '--sidebar-width': '216px' } as React.CSSProperties}
    >
      <Sidebar className="app-sidebar">
        <SidebarHeader>
          <button
            className="brand"
            aria-label="案件一覧を開く"
            onClick={() => navigate('projects')}
          >
            <span className="brand-mark">
              <Zap size={23} />
            </span>
            trace<span className="brand-dot">.</span>
          </button>
          <div className="workspace-label">ENERGY DESIGN WORKSPACE</div>
        </SidebarHeader>
        <SidebarContent>
          <div className="workspace-switch">
            <span className="workspace-avatar">T</span>
            <div>
              デモワークスペース<small>産業用エネルギー設計</small>
            </div>
          </div>
          <div className="nav-caption">ワークスペース</div>
          {(
            [
              { key: 'projects', label: '案件一覧', icon: FolderKanban },
              {
                key: 'simulation',
                label: 'シミュレーション',
                icon: PanelsTopLeft,
              },
              { key: 'report', label: '提案レポート', icon: FileText },
            ] as const
          ).map((v) => (
            <button
              key={v.key}
              className={'nav-item ' + (screen === v.key ? 'active' : '')}
              onClick={() => navigate(v.key)}
              aria-current={screen === v.key ? 'page' : undefined}
            >
              <v.icon size={18} />
              {v.label}
            </button>
          ))}
          <div className="nav-caption">最近の案件</div>
          {projects.slice(-6).map((q, i) => (
            <button
              key={q.id}
              className={
                'project-link ' + (q.id === project.id ? 'selected' : '')
              }
              onClick={() => selectProject(q.id)}
            >
              <span
                className={'project-dot ' + ['', 'blue', 'orange'][i % 3]}
              />
              {q.name}
            </button>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <div className="demo-note">
            <span className="live-dot" />
            サンプルデータで体験中<small>保存先はこのブラウザのみ</small>
          </div>
          <button
            className={'nav-item ' + (screen === 'help' ? 'active' : '')}
            onClick={() => navigate('help')}
          >
            <CircleHelp size={18} />
            前提・機能一覧
          </button>
          <div className="user-line">
            <span className="user-avatar">TU</span>
            <div>
              デモユーザー<small>プランナー</small>
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>
      <div className="app-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <SidebarTrigger className="mobile-trigger" />
            <button onClick={() => navigate('projects')}>案件</button>
            <ChevronRight size={14} />
            <span>{project.name}</span>
            <ChevronRight size={14} />
            <strong>
              {
                {
                  simulation: 'シミュレーション',
                  projects: '案件一覧',
                  report: '提案レポート',
                  help: '前提・機能一覧',
                }[screen]
              }
            </strong>
          </div>
          <span className="prototype-badge">PoC / モックデータ</span>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {screen === 'projects'
                  ? 'YOUR ENERGY PROJECTS'
                  : screen === 'help'
                    ? 'METHOD & CAPABILITIES'
                    : 'ENERGY DESIGN / ' +
                      (projects.indexOf(project) + 1)
                        .toString()
                        .padStart(3, '0')}
              </div>
              <h1>
                {screen === 'projects'
                  ? '案件一覧'
                  : screen === 'help'
                    ? '前提・機能一覧'
                    : project.name}
                {screen !== 'help' && screen !== 'projects' && (
                  <span className="status-badge">検討中</span>
                )}
              </h1>
              <p>
                {screen === 'projects' ? (
                  '施設ごとの需要から、導入の可能性を探る。'
                ) : screen === 'help' ? (
                  '確かめられた機能と、PoCで体験できること。'
                ) : (
                  <>
                    <Factory size={14} />
                    {PROFILE_NAMES[p.profile]} <span>·</span> {project.location}{' '}
                    <span>·</span> 高圧想定
                  </>
                )}
              </p>
            </div>
            <div className="heading-actions">
              {screen === 'projects' ? (
                <button
                  className="button primary"
                  onClick={() => openModal('new')}
                >
                  <Plus size={16} />
                  新しい案件
                </button>
              ) : screen === 'help' ? (
                <a
                  className="button secondary"
                  href="/feature-inventory.md"
                  download
                >
                  <Download size={16} />
                  調査・機能一覧
                </a>
              ) : (
                <>
                  <button
                    className="button secondary"
                    onClick={() => openModal('save')}
                  >
                    <Plus size={16} />
                    案を保存
                  </button>
                  <button
                    className="button primary"
                    onClick={() =>
                      navigate(screen === 'report' ? 'simulation' : 'report')
                    }
                  >
                    {screen === 'report' ? (
                      <PanelsTopLeft size={16} />
                    ) : (
                      <FileText size={16} />
                    )}{' '}
                    {screen === 'report' ? '設計に戻る' : '提案書を作成'}
                    <ArrowRight size={15} />
                  </button>
                </>
              )}
            </div>
          </div>
          {error && !modal && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {screen === 'simulation' && (
            <div className="work-grid">
              <div className="results-column">
                <div className="section-heading">
                  <h2>導入シナリオ</h2>
                  <span className="subtle">同じ需要・料金条件で比較</span>
                </div>
                <div className="scenario-grid">
                  {SCENARIOS.map((name, i) => (
                    <button
                      key={name}
                      aria-pressed={scenario === i}
                      className={
                        'scenario-card ' + (scenario === i ? 'selected' : '')
                      }
                      onClick={() => setScenario(i)}
                    >
                      <div className="scenario-top">
                        <span>
                          {i === 1 ? (
                            <Battery size={16} />
                          ) : i === 0 ? (
                            <Sun size={16} />
                          ) : (
                            <SlidersIcon />
                          )}
                          {name}
                        </span>
                        {scenario === i ? <Check size={16} /> : null}
                      </div>
                      <div className="scenario-spec">
                        {options[i].pv} kW /{' '}
                        {options[i].battery > 0
                          ? `${options[i].battery} kWh`
                          : '蓄電池なし'}
                      </div>
                      <span className="scenario-value">
                        {man(results[i].savings)}
                        <small>万円 / 年 削減</small>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="metrics">
                  <button
                    className="metric lead metric-button"
                    onClick={() => setTab('compare')}
                  >
                    <span>年間電気代の削減額</span>
                    <div className="metric-value">
                      {man(r.savings)}
                      <small>万円</small>
                    </div>
                    <span className="positive">
                      <ArrowDownRight size={16} />
                      {number(
                        r.beforeBill > 0 ? (r.savings / r.beforeBill) * 100 : 0,
                        1,
                      )}
                      % 削減 <ChevronRight size={12} />
                    </span>
                  </button>
                  <button
                    className="metric metric-button"
                    onClick={() => setTab('finance')}
                  >
                    <span>投資回収期間</span>
                    <div className="metric-value">
                      {r.payback === null ? '20' : number(r.payback, 1)}
                      <small>{r.payback === null ? '年超' : '年'}</small>
                    </div>
                    <span className="subtle">
                      維持・更新費を反映 <ChevronRight size={12} />
                    </span>
                  </button>
                  <button
                    className="metric metric-button"
                    onClick={() => setTab('energy')}
                  >
                    <span>自家消費率</span>
                    <div className="metric-value">
                      {number(r.selfRate, 1)}
                      <small>%</small>
                    </div>
                    <span className="subtle">発電量のうち施設で利用</span>
                  </button>
                </div>
                <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
                  <TabsList className="result-tabs" variant="line">
                    <TabsTrigger value="energy">エネルギーの流れ</TabsTrigger>
                    <TabsTrigger value="finance">長期収支</TabsTrigger>
                    <TabsTrigger value="compare">案を比較</TabsTrigger>
                  </TabsList>
                  <TabsContent value="energy">
                    <EnergyChart result={r} params={p} />
                  </TabsContent>
                  <TabsContent value="finance">
                    <FinanceChart result={r} params={p} />
                  </TabsContent>
                  <TabsContent value="compare">
                    <Comparison
                      results={results}
                      options={options}
                      active={scenario}
                      onSelect={setScenario}
                    />
                  </TabsContent>
                </Tabs>
                <Insight
                  result={r}
                  params={p}
                  base={withoutBattery}
                  onCompare={() => setTab('compare')}
                />
                {tab === 'compare' && (
                  <section className="saved-section">
                    <div className="section-heading">
                      <h2>保存した案</h2>
                      <button
                        className="button text-button"
                        onClick={() => openModal('save')}
                      >
                        <Plus size={14} />
                        現在の案を保存
                      </button>
                    </div>
                    {project.saved.length === 0 ? (
                      <div className="empty-saved">
                        <Save size={20} />
                        <p>
                          検討の節目に、条件を名前付きで保存。
                          <small>
                            保存時の需要・料金・設備条件をまとめて復元できます。
                          </small>
                        </p>
                      </div>
                    ) : (
                      project.saved.map((s) => (
                        <div className="saved-row" key={s.id}>
                          <div>
                            <strong>{s.name}</strong>
                            <small>
                              {s.params.pv} kW / {s.params.battery} kWh ·{' '}
                              {new Date(s.date).toLocaleDateString('ja-JP')}
                            </small>
                          </div>
                          <button
                            className="button secondary"
                            onClick={() => {
                              setProjects((prev) =>
                                prev.map((q) =>
                                  q.id === project.id
                                    ? {
                                        ...q,
                                        params: { ...s.params },
                                        profile: s.params.profile,
                                      }
                                    : q,
                                ),
                              );
                              setScenario(2);
                              setStatus(`「${s.name}」の条件を復元しました`);
                            }}
                          >
                            この案を開く
                            <ArrowRight size={14} />
                          </button>
                        </div>
                      ))
                    )}
                  </section>
                )}
                <div className="save-status" role="status">
                  <Check size={12} />
                  {status}
                </div>
              </div>
              <Conditions
                params={p}
                onChange={update}
                onDemand={() => openModal('demand')}
                onReset={() => {
                  const defaults =
                    DEMO_PROJECTS.find((q) => q.id === project.id)?.params ??
                    DEFAULTS;
                  setProjects((prev) =>
                    prev.map((q) =>
                      q.id === project.id
                        ? {
                            ...q,
                            params: { ...defaults },
                            profile: defaults.profile,
                          }
                        : q,
                    ),
                  );
                  setScenario(2);
                }}
              />
            </div>
          )}
          {screen === 'projects' && (
            <>
              <div className="project-toolbar">
                <div className="search-field">
                  <Search size={17} />
                  <Input
                    aria-label="案件を検索"
                    placeholder="案件名・所在地で検索"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <span className="subtle">
                  {projects.length} 案件 · ブラウザ内に保存
                </span>
              </div>
              <div className="project-cards">
                {projects
                  .filter((q) => (q.name + q.location).includes(search))
                  .map((q) => (
                    <button
                      className="project-card"
                      key={q.id}
                      onClick={() => selectProject(q.id)}
                    >
                      <span className="factory-icon">
                        <Factory size={25} />
                      </span>
                      <span className="soft-badge">
                        {PROFILE_NAMES[q.params.profile]}
                      </span>
                      <h2>{q.name}</h2>
                      <p>{q.location}</p>
                      <div className="project-card-stats">
                        <span>
                          太陽光
                          <strong>
                            {q.params.pv}
                            <small> kW</small>
                          </strong>
                        </span>
                        <span>
                          蓄電池
                          <strong>
                            {q.params.battery}
                            <small> kWh</small>
                          </strong>
                        </span>
                      </div>
                      <div className="project-card-footer">
                        シミュレーションを開く
                        <ArrowRight size={16} />
                      </div>
                    </button>
                  ))}
              </div>
              {!projects.some((q) =>
                (q.name + q.location).includes(search),
              ) && (
                <p className="empty-text">
                  該当する案件がありません。検索語を変えてください。
                </p>
              )}
              <div className="backup-row">
                <span>端末を移るときは、案件データを書き出せます。</span>
                <button
                  className="button secondary"
                  onClick={() =>
                    download(
                      JSON.stringify(
                        { version: 1, projects, activeId, scenario },
                        null,
                        2,
                      ),
                      'trace-projects.json',
                      'application/json',
                    )
                  }
                >
                  <Download size={15} />
                  案件データを書き出す
                </button>
                <label className="button secondary file-button">
                  <Upload size={15} />
                  案件データを読み込む
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={async (e) => {
                      try {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 4 * 1024 * 1024)
                          throw new Error(
                            '4MB以下のファイルを選んでください。',
                          );
                        const data = JSON.parse(await file.text());
                        if (!restoreProjects(data.projects))
                          throw new Error(
                            'TRACEの案件ファイルとして読み込めません。',
                          );
                        const imported = data.projects.map((q: Project) => ({
                          ...q,
                          id: crypto.randomUUID(),
                          name: q.name + '（取込）',
                        }));
                        if (projects.length + imported.length > 40)
                          throw new Error('案件は合計40件まで読み込めます。');
                        setProjects((prev) => [...prev, ...imported]);
                        setStatus('案件を追加しました');
                      } catch (e) {
                        setError(
                          e instanceof Error
                            ? e.message
                            : '読み込みに失敗しました',
                        );
                      }
                    }}
                  />
                </label>
              </div>
            </>
          )}
          {screen === 'report' && (
            <Report
              project={project}
              params={p}
              result={r}
              exporting={exporting}
              onExcel={exportExcel}
              onCSV={() => csvDownload(r, project.name)}
              onPrint={() => window.print()}
            />
          )}
          {screen === 'help' && <Help />}
        </main>
      </div>
      <Dialog
        open={modal !== null}
        onOpenChange={(v) => {
          if (!v) setModal(null);
        }}
      >
        <DialogContent
          className={
            modal === 'demand' ? 'trace-dialog demand-dialog' : 'trace-dialog'
          }
        >
          <DialogHeader>
            <DialogTitle>
              {modal === 'save'
                ? '現在の案を保存'
                : modal === 'new'
                  ? '新しい案件'
                  : '需要・発電データ'}
            </DialogTitle>
            <DialogDescription>
              {modal === 'save'
                ? '現在の設備・需要・料金・投資条件をまとめて保存します。'
                : modal === 'new'
                  ? 'まずは業種のサンプルから。条件はあとで変更できます。'
                  : 'データがなくても、業種と使用量から検討を始められます。'}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {(modal === 'new' || modal === 'save') && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                modal === 'new' ? createProject() : saveScenario();
              }}
            >
              <label className="field-caption" htmlFor="record-name">
                {modal === 'new' ? '案件名' : '案の名前'}
              </label>
              <Input
                id="record-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoFocus
                placeholder={
                  modal === 'new'
                    ? '例：千葉第二工場'
                    : '例：補助金を使わない場合'
                }
              />
              {modal === 'new' && (
                <>
                  <label className="field-caption" htmlFor="record-location">
                    所在地
                  </label>
                  <Input
                    id="record-location"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    maxLength={100}
                    placeholder="例：千葉県千葉市"
                  />
                  <label className="field-caption">業種</label>
                  <Pick
                    label="新しい案件の業種"
                    value={profile}
                    onChange={(v) => setProfile(v as Profile)}
                    options={Object.entries(PROFILE_NAMES).map(
                      ([value, label]) => ({ value, label }),
                    )}
                  />
                </>
              )}
              <button type="submit" className="button primary dialog-submit">
                {modal === 'new' ? '案件を作成' : 'この条件で保存'}
                <ArrowRight size={15} />
              </button>
            </form>
          )}
          {modal === 'demand' && (
            <div className="demand-content">
              <div className="data-mode">
                <span className="soft-badge">
                  {p.demandData
                    ? 'CSVデータを使用中'
                    : '業種テンプレートを使用中'}
                </span>
                <button
                  className="button text-button"
                  onClick={() =>
                    update({
                      demandData: undefined,
                      monthly: undefined,
                      pvData: undefined,
                    })
                  }
                >
                  テンプレートに戻す
                </button>
              </div>
              <div className="field-grid">
                <div>
                  <label className="field-caption">業種テンプレート</label>
                  <Pick
                    label="需要の業種テンプレート"
                    value={p.profile}
                    onChange={(v) => {
                      const d = DEMO_PROJECTS.find(
                        (q) => q.profile === v,
                      )!.params;
                      update({
                        profile: v as Profile,
                        weekend: d.weekend,
                        start: d.start,
                        end: d.end,
                        demandData: undefined,
                      });
                    }}
                    options={Object.entries(PROFILE_NAMES).map(
                      ([value, label]) => ({ value, label }),
                    )}
                  />
                </div>
                <Numeric
                  label="年間使用量"
                  value={p.annual}
                  min={10}
                  max={20000}
                  unit="MWh"
                  disabled={Boolean(p.demandData)}
                  onChange={(annual) => update({ annual, monthly: undefined })}
                />
                <Numeric
                  label="稼働開始"
                  value={p.start}
                  min={0}
                  max={p.end - 1}
                  unit="時"
                  onChange={(start) => update({ start })}
                />
                <Numeric
                  label="稼働終了"
                  value={p.end}
                  min={p.start + 1}
                  max={24}
                  unit="時"
                  onChange={(end) => update({ end })}
                />
                <Numeric
                  label="土日の需要（平日比）"
                  value={p.weekend}
                  max={150}
                  unit="%"
                  onChange={(weekend) => update({ weekend })}
                />
              </div>
              <p className="detail-copy">
                {p.demandData
                  ? 'CSV使用中は、年間使用量・業種・稼働時間による推計は適用されません。'
                  : '入力した総使用量を、業種・稼働時間・土日比率で30分値に配分します。祝日カレンダーはこのPoCでは省略します。'}
              </p>
              <details className="data-details">
                <summary>12か月の使用量を個別に入力</summary>
                <div className="monthly-inputs">
                  {r.months.map((m) => (
                    <Numeric
                      key={m.month}
                      label={`${m.month + 1}月`}
                      value={p.monthly?.[m.month] ?? Math.round(m.load / 1000)}
                      unit="MWh"
                      max={20000}
                      disabled={Boolean(p.demandData)}
                      onChange={(v) => {
                        const monthly =
                          p.monthly ??
                          r.months.map((m) => Math.round(m.load / 1000));
                        update({
                          monthly: monthly.map((n, i) =>
                            i === m.month ? v : n,
                          ),
                        });
                      }}
                    />
                  ))}
                </div>
              </details>
              <div className="upload-section">
                <h3>CSVを使って試す</h3>
                <p>
                  2025年の30分値、17,520行。テンプレートを編集して読み込めます。
                </p>
                {(['demand', 'pv'] as const).map((kind) => (
                  <div className="upload-row" key={kind}>
                    <span>
                      {kind === 'demand' ? '需要データ' : '発電データ'}
                    </span>
                    <button
                      className="button text-button"
                      onClick={() => template(kind)}
                    >
                      <Download size={14} />
                      テンプレート
                    </button>
                    <label className="button secondary file-button">
                      <Upload size={14} />
                      CSV読込
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        aria-label={
                          kind === 'demand'
                            ? '需要CSVを読み込む'
                            : '発電CSVを読み込む'
                        }
                        onChange={(e) => {
                          void importData(e.target.files?.[0], kind);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                ))}
                <p className="detail-copy">
                  発電CSVは設備容量・方位・日射設定より優先されます。ファイルはサーバーへ送信せず、このブラウザで処理します。
                </p>
              </div>
              <button
                className="button primary dialog-submit"
                onClick={() => setModal(null)}
              >
                条件を反映して閉じる
                <Check size={15} />
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
function SlidersIcon() {
  return <PanelsTopLeft size={16} />;
}
function Insight({
  result: r,
  params: p,
  base,
  onCompare,
}: {
  result: Result;
  params: Params;
  base: Result;
  onCompare: () => void;
}) {
  let title = '余剰電力を減らすと、設備をより有効に使えます。',
    body = `年間 ${number(r.exported / 1000, 1)} MWh が余剰になります。設備容量と蓄電池容量のバランスを比較しましょう。`;
  if (
    p.battery > 0 &&
    r.investment > base.investment &&
    r.savings > base.savings
  ) {
    const marginal =
      (r.investment - base.investment) / (r.savings - base.savings);
    title = `蓄電池の追加投資は、削減額だけで見ると約 ${number(marginal, 1)} 年。`;
    body =
      '維持・更新費を除く追加投資の単純回収です。ピーク対策や非常用容量も含めて、採用理由を検討できます。';
  } else if (p.battery > 0 && r.savings <= base.savings) {
    title = 'この条件では、蓄電池の追加で電気代削減は増えていません。';
    body =
      '運転方針、充放電出力、余剰電力量を確認し、太陽光のみの案と比較してください。';
  }
  if (p.pv === 0 && !p.pvData) {
    title = '太陽光の容量を設定すると、発電による効果を確認できます。';
    body = '右側の設備容量から調整してください。蓄電池だけの運転も試せます。';
  }
  return (
    <button className="insight" onClick={onCompare}>
      <span className="insight-icon">
        <Leaf size={21} />
      </span>
      <span>
        <strong>{title}</strong>
        <span className="insight-copy">{body}</span>
      </span>
      <ArrowRight size={18} />
    </button>
  );
}
function Comparison({
  results,
  options,
  active,
  onSelect,
}: {
  results: Result[];
  options: Params[];
  active: number;
  onSelect: (v: number) => void;
}) {
  const rows: [string, (r: Result, p: Params) => string][] = [
    ['太陽光 / 蓄電池', (_, p) => `${p.pv} kW / ${p.battery} kWh`],
    ['初期投資', (r) => `${man(r.investment)} 万円`],
    ['年間電気代削減', (r) => `${man(r.savings)} 万円`],
    ['年間維持費', (r) => `${man(r.maintenance)} 万円`],
    ['投資回収', (r) => years(r.payback)],
    ['自家消費率', (r) => `${number(r.selfRate, 1)} %`],
    ['年間余剰電力', (r) => `${number(r.exported / 1000, 1)} MWh`],
    ['年間ピーク削減', (r) => `${number(r.beforePeak - r.afterPeak, 1)} kW`],
    ['20年累積収支', (r) => `${man(r.profit)} 万円`],
    ['現在価値の収支 / NPV', (r) => `${man(r.npv)} 万円`],
  ];
  return (
    <section className="panel compare-panel">
      <div className="panel-heading">
        <div>
          <h2>どの案が、この施設に合うか。</h2>
          <p>費用・自家消費・ピーク対策を並べて判断</p>
        </div>
      </div>
      <Table className="comparison-table">
        <TableHeader>
          <TableRow>
            <TableHead>比較項目</TableHead>
            {SCENARIOS.map((s, i) => (
              <TableHead className={active === i ? 'selected-col' : ''} key={s}>
                {s}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(([label, fn]) => (
            <TableRow key={label}>
              <TableCell>{label}</TableCell>
              {results.map((r, i) => (
                <TableCell
                  key={i}
                  className={active === i ? 'selected-col' : ''}
                >
                  {fn(r, options[i])}
                </TableCell>
              ))}
            </TableRow>
          ))}
          <TableRow>
            <TableCell>表示する案</TableCell>
            {results.map((_, i) => (
              <TableCell key={i}>
                <button
                  className={
                    'button ' + (active === i ? 'primary' : 'secondary')
                  }
                  onClick={() => onSelect(i)}
                >
                  {active === i ? '選択中' : 'この案を選ぶ'}
                </button>
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
      <p className="detail-copy">
        需要・料金・投資単価は現在の共通条件です。太陽光のみと蓄電池併設は標準容量、カスタム案は調整した容量で比較します。
      </p>
    </section>
  );
}
function Report({
  project,
  params: p,
  result: r,
  exporting,
  onExcel,
  onCSV,
  onPrint,
}: {
  project: Project;
  params: Params;
  result: Result;
  exporting: boolean;
  onExcel: () => void;
  onCSV: () => void;
  onPrint: () => void;
}) {
  return (
    <div className="report-layout">
      <article className="report-paper">
        <div className="report-top">
          <span className="report-logo">trace.</span>
          <span>ENERGY TRANSITION PROPOSAL</span>
        </div>
        <div className="report-eyebrow">太陽光・蓄電池 導入検討資料</div>
        <h2>
          {project.name}
          <br />
          エネルギーを、次の資産へ。
        </h2>
        <p className="report-subtitle">
          {project.location} · {PROFILE_NAMES[p.profile]} · 自己所有モデル
        </p>
        <div className="report-equipment">
          <span>
            <Sun size={19} />
            太陽光 <strong>{p.pv} kW</strong>
          </span>
          <span>
            <Battery size={19} />
            蓄電池 <strong>{p.battery} kWh</strong>
          </span>
        </div>
        <div className="report-main-metric">
          <span>年間電気代の削減見込み</span>
          <strong>
            {man(r.savings)}
            <small>万円 / 年</small>
          </strong>
          <p>
            導入前 {man(r.beforeBill)}万円 → 導入後 {man(r.afterBill)}万円
          </p>
        </div>
        <div className="report-three">
          <div>
            <span>投資回収</span>
            <strong>{years(r.payback)}</strong>
          </div>
          <div>
            <span>自家消費率</span>
            <strong>{number(r.selfRate, 1)}%</strong>
          </div>
          <div>
            <span>CO₂削減</span>
            <strong>
              {number(r.co2, 1)}
              <small> t/年</small>
            </strong>
          </div>
        </div>
        <h3>投資判断の要点</h3>
        <ul>
          <li>
            補助金 {man(r.subsidy)}万円を控除した初期投資は {man(r.investment)}
            万円。
          </li>
          <li>
            年間維持費は {man(r.maintenance, 1)}万円。12年目に設備更新費{' '}
            {p.replacement}万円を想定。
          </li>
          <li>
            20年間の累積収支は {man(r.profit)}万円、割引率 {p.discount}%
            でのNPVは {man(r.npv)}万円。
          </li>
          <li>
            年間 {number(r.exported / 1000, 1)} MWh
            の余剰電力が発生。余剰売電単価は {p.sell}円/kWh。
          </li>
        </ul>
        <div className="report-assumptions">
          <strong>試算の前提</strong>
          <p>
            需要・発電・料金はサンプルデータ。2025年の30分値で計算。基本料金は
            {p.tariffMode === 'peak' ? '年間最大買電電力' : '固定契約電力'}
            で概算。電気代上昇 {p.escalation}%/年、劣化 {p.degradation}
            %/年。税・融資・実際の料金制度・独立した蓄電池劣化は未反映。導入効果を保証する資料ではありません。
          </p>
        </div>
        <div className="report-footer">
          <span>TRACE / SAMPLE PROPOSAL</span>
          <span>PoC・体験用データ</span>
        </div>
      </article>
      <aside className="report-controls panel">
        <h2>提案資料を書き出す</h2>
        <p>表示中の条件と計算結果を、検討資料としてまとめます。</p>
        <button className="button primary" onClick={onPrint}>
          <Printer size={16} />
          印刷 / PDFに保存
        </button>
        <button
          className="button secondary"
          onClick={onExcel}
          disabled={exporting}
        >
          <Download size={16} />
          {exporting ? 'Excelを作成中…' : 'Excelレポート'}
        </button>
        <button className="button secondary" onClick={onCSV}>
          <Download size={16} />
          30分値をCSVで出力
        </button>
        <div className="detail-copy">
          Excelには試算サマリー、入力条件、月別電力と料金、20年収支、30分値の5シートを収録します。
        </div>
        <div className="notice-box">
          PDFは印刷画面で「PDFに保存」を選択します。
        </div>
      </aside>
    </div>
  );
}
function Help() {
  const groups = [
    [
      '案件・施設',
      '案件作成、切替、名前付き案の保存と復元、JSON入出力',
      'ブラウザ内の保存',
    ],
    [
      '需要推計',
      '3業種のロードカーブ、年間・月別使用量、稼働時間、土日比率',
      'モック曲線で動作',
    ],
    [
      '需要・発電CSV',
      '2025年の30分値17,520行を取込、形式と欠損を検証',
      'ブラウザ内で処理',
    ],
    [
      '太陽光',
      '容量、方位、傾斜、原単位、PCS上限、自家消費・余剰',
      '1面に集約した簡易計算',
    ],
    [
      '蓄電池',
      '容量、出力、効率、残量制約、自家消費・ピーク優先、夜間充電',
      '時系列で計算',
    ],
    [
      '電気料金',
      '昼夜単価、基本料金、燃調、賦課金、売電',
      'サンプル単価で概算',
    ],
    [
      '投資・環境',
      '補助金、維持更新費、上昇・劣化、20年収支、回収、NPV、CO₂',
      '簡易モデルで計算',
    ],
    ['比較・提案', '3案比較、根拠表示、Excel・CSV・印刷用提案書', '実装済み'],
  ];
  return (
    <div className="help-layout">
      <section className="panel help-intro">
        <BookOpen size={26} />
        <h2>機能の網羅と、判断のしやすさを両立する。</h2>
        <p>
          エネがえるBizの公開マニュアル・公式資料を調べ、主要な提案業務を一つのワークスペースで試せる形にしています。製品を実際に操作した比較評価ではありません。
        </p>
        <div className="help-principles">
          <div>
            <strong>条件のすぐ隣に、結果</strong>
            <span>画面を往復せず、設備と効果を調整。</span>
          </div>
          <div>
            <strong>メリットと追加費用を一緒に</strong>
            <span>蓄電池の追加投資が見合うかも表示。</span>
          </div>
          <div>
            <strong>数字から根拠へ</strong>
            <span>30分値、料金の内訳、年別収支まで確認。</span>
          </div>
        </div>
      </section>
      <section className="panel help-panel">
        <h2>PoCの機能一覧</h2>
        <Table className="data-table">
          <TableHeader>
            <TableRow>
              <TableHead>領域</TableHead>
              <TableHead>体験できる機能</TableHead>
              <TableHead>実装範囲</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((row) => (
              <TableRow key={row[0]}>
                {row.map((v, i) => (
                  <TableCell key={i}>{v}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <a href="/feature-inventory.md" download className="button secondary">
          <Download size={16} />
          詳細な機能対応表をダウンロード
        </a>
      </section>
      <section className="panel help-panel">
        <h2>計算の読み方</h2>
        <dl className="definition-list">
          <dt>年間電気代削減</dt>
          <dd>
            導入前の電気代 −
            導入後の電気代。売電収入・維持費は含まず、収支計算で別途反映。
          </dd>
          <dt>自家消費率</dt>
          <dd>
            （直接消費＋太陽光由来の放電）÷
            発電量。系統充電からの放電・蓄電ロスは含まない。
          </dd>
          <dt>投資回収</dt>
          <dd>
            補助金控除後の投資を、維持・更新費を含む累積収支が初めて上回る時期。
          </dd>
          <dt>長期収支</dt>
          <dd>
            初年度の効果に料金上昇・劣化率を適用した概算。設備別劣化や毎年の運転再計算は未実装。
          </dd>
        </dl>
      </section>
      <section className="panel help-panel">
        <h2>今回の対象外</h2>
        <p>
          商用の料金・日射データ接続、50業種のテンプレート再現、6面の屋根別計算、祝日別カレンダー、目標ピークの自動探索、自由な充放電時間帯、PPA/FIPの詳細計算、組織権限、監査ログ、共同編集。データ調達の実現性は今回調査していません。
        </p>
        <h3>調査元（確認日：2026年9月8日）</h3>
        <div className="source-links">
          <a
            href="https://biz.enegaeru.com/pricing"
            target="_blank"
            rel="noreferrer"
          >
            公式機能一覧 ↗
          </a>
          <a
            href="https://www-biz.enegaeru.com/bizweb11/manual/step/pv.html"
            target="_blank"
            rel="noreferrer"
          >
            太陽光マニュアル ↗
          </a>
          <a
            href="https://www-biz.enegaeru.com/bizweb11/manual/step/cell.html"
            target="_blank"
            rel="noreferrer"
          >
            蓄電池マニュアル ↗
          </a>
          <a
            href="https://www.enegaeru.com/roi-biz"
            target="_blank"
            rel="noreferrer"
          >
            長期収支・ROI機能 ↗
          </a>
        </div>
      </section>
    </div>
  );
}
