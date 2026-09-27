import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { planApi } from './api';
import { snapshotApi } from './snapshotApi';
import { routePoints, validateRoute } from './geometry';
import { buildReviewUrl, copyText } from './reviewLinks';
import { formatDateTime, relativeExpiry } from './format';
import RouteCanvas from './RouteCanvas';
import type { NoFlyZone, Point, RoutePlan, SnapshotMeta, ValidationResult } from './types';

const CANVAS = { width: 100, height: 70 };
const ZONE_COLORS = ['#fb7185', '#f59e0b', '#a78bfa', '#38bdf8'];

const REVIEW_TTL_OPTIONS = [
  { label: '24 小时', value: 24 },
  { label: '72 小时', value: 72 },
  { label: '7 天', value: 168 },
  { label: '30 天', value: 720 },
  { label: '长期有效', value: 0 }
];

type Tool = 'select' | 'start' | 'end' | 'waypoint' | 'rectangle' | 'polygon';

const initialPlan: RoutePlan = {
  name: '北侧巡检任务',
  canvas: CANVAS,
  start: { x: 12, y: 56 },
  end: { x: 87, y: 14 },
  waypoints: [{ x: 33, y: 46 }, { x: 65, y: 28 }],
  noFlyZones: [
    { id: 'zone-demo', name: '高压线保护区', kind: 'rectangle', points: [{ x: 43, y: 17 }, { x: 64, y: 17 }, { x: 64, y: 38 }, { x: 43, y: 38 }], color: '#fb7185' }
  ]
};

function formatDistance(value: number) {
  return `${value.toFixed(1)} km`;
}

function pointFromEvent(event: ReactPointerEvent<SVGSVGElement>, svg: SVGSVGElement): Point {
  const rect = svg.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(CANVAS.width, ((event.clientX - rect.left) / rect.width) * CANVAS.width)),
    y: Math.max(0, Math.min(CANVAS.height, ((event.clientY - rect.top) / rect.height) * CANVAS.height))
  };
}

function pointText(point: Point) {
  return `${point.x.toFixed(1)}, ${point.y.toFixed(1)}`;
}

export default function App() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [plan, setPlan] = useState<RoutePlan>(initialPlan);
  const [tool, setTool] = useState<Tool>('select');
  const [draftPolygon, setDraftPolygon] = useState<Point[]>([]);
  const [validation, setValidation] = useState<ValidationResult>(() => validateRoute(initialPlan));
  const [savedPlans, setSavedPlans] = useState<RoutePlan[]>([]);
  const [activePlanId, setActivePlanId] = useState<string>();
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [notice, setNotice] = useState('点击画布或使用左侧工具编辑航线');

  // 只读审查相关状态
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [snapshotsVersion, setSnapshotsVersion] = useState(0);
  const [ttlHours, setTtlHours] = useState(168);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [copiedToken, setCopiedToken] = useState<string>();
  const [confirmingRevoke, setConfirmingRevoke] = useState<string>();

  useEffect(() => {
    planApi.list().then(({ plans }) => setSavedPlans(plans)).catch(() => setNotice('API 尚未启动，仍可在本地编辑方案'));
  }, []);

  useEffect(() => setValidation(validateRoute(plan)), [plan]);

  // 切换当前方案或快照变动时，重新加载其全部审查快照
  useEffect(() => {
    if (!activePlanId) {
      setSnapshots([]);
      return;
    }
    let cancelled = false;
    snapshotApi.list(activePlanId).then(({ snapshots: list }) => {
      if (!cancelled) setSnapshots(list);
    }).catch(() => { if (!cancelled) setSnapshots([]); });
    return () => { cancelled = true; };
  }, [activePlanId, snapshotsVersion]);

  const points = useMemo(() => routePoints(plan), [plan]);
  const activeSegment = new Set(validation.issues.map((issue) => issue.segmentIndex).filter((index): index is number => index !== undefined));
  const activeSnapshots = snapshots.filter((snapshot) => snapshot.status === 'active');

  const updatePlan = (patch: Partial<RoutePlan>) => setPlan((current) => ({ ...current, ...patch }));

  const handleCanvasClick = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const point = pointFromEvent(event, svgRef.current);
    if (tool === 'start') {
      updatePlan({ start: point });
      setNotice(`起点已更新为 ${pointText(point)}`);
    } else if (tool === 'end') {
      updatePlan({ end: point });
      setNotice(`终点已更新为 ${pointText(point)}`);
    } else if (tool === 'waypoint') {
      updatePlan({ waypoints: [...plan.waypoints, point] });
      setNotice(`已添加航点 ${pointText(point)}`);
    } else if (tool === 'polygon') {
      setDraftPolygon((draft) => [...draft, point]);
    }
  };

  const finishPolygon = () => {
    if (draftPolygon.length < 3) {
      setNotice('多边形至少需要 3 个点');
      return;
    }
    const index = plan.noFlyZones.length;
    const zone: NoFlyZone = {
      id: `zone-${Date.now()}`,
      name: `禁飞区 ${index + 1}`,
      kind: 'polygon',
      points: draftPolygon,
      color: ZONE_COLORS[index % ZONE_COLORS.length]
    };
    updatePlan({ noFlyZones: [...plan.noFlyZones, zone] });
    setDraftPolygon([]);
    setTool('select');
    setNotice(`已创建 ${zone.name}`);
  };

  const handleRectangle = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (tool !== 'rectangle' || !svgRef.current) return;
    const point = pointFromEvent(event, svgRef.current);
    const width = 13;
    const height = 11;
    const x = Math.max(1, Math.min(CANVAS.width - width - 1, point.x - width / 2));
    const y = Math.max(1, Math.min(CANVAS.height - height - 1, point.y - height / 2));
    const index = plan.noFlyZones.length;
    const zone: NoFlyZone = {
      id: `zone-${Date.now()}`,
      name: `矩形禁飞区 ${index + 1}`,
      kind: 'rectangle',
      points: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }],
      color: ZONE_COLORS[index % ZONE_COLORS.length]
    };
    updatePlan({ noFlyZones: [...plan.noFlyZones, zone] });
    setTool('select');
    setNotice(`已创建 ${zone.name}`);
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (tool === 'rectangle') handleRectangle(event);
  };

  const removeWaypoint = (index: number) => updatePlan({ waypoints: plan.waypoints.filter((_, waypointIndex) => waypointIndex !== index) });
  const removeZone = (id: string) => updatePlan({ noFlyZones: plan.noFlyZones.filter((zone) => zone.id !== id) });

  /** 保存（或更新）当前方案并回写状态；生成审查链接前复用此逻辑 */
  const persistPlan = async (): Promise<RoutePlan> => {
    const { plan: saved } = await planApi.save({ ...plan, id: activePlanId });
    setActivePlanId(saved.id);
    setPlan(saved);
    setSavedPlans((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    return saved;
  };

  const save = async () => {
    setSaveState('saving');
    try {
      await persistPlan();
      setSaveState('saved');
      setNotice('方案已保存到内存 API');
      window.setTimeout(() => setSaveState('idle'), 1800);
    } catch {
      setSaveState('error');
      setNotice('保存失败：请确认后端运行在 http://localhost:4000');
    }
  };

  const createReview = async () => {
    if (reviewBusy) return; // 防止重复点击产生多个快照
    setReviewBusy(true);
    setReviewError('');
    try {
      // 始终先保存当前编辑内容，确保快照与画布所见一致（快照必须基于已保存方案）
      const saved = await persistPlan();
      if (!saved.id) throw new Error('方案保存失败，无法生成审查链接');
      // 每次生成使用独立幂等键：网络重试不会产生重复快照，连续点击会被 busy 拦截
      const idempotencyKey = globalThis.crypto?.randomUUID?.() ?? `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const { snapshot } = await snapshotApi.create(saved.id, ttlHours, idempotencyKey);
      setSnapshotsVersion((version) => version + 1);
      const url = buildReviewUrl(snapshot.token);
      if (await copyText(url)) {
        setCopiedToken(snapshot.token);
        window.setTimeout(() => setCopiedToken((current) => (current === snapshot.token ? undefined : current)), 2000);
      }
      setNotice('只读审查链接已生成并复制，可发送给复核安全员');
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : '生成审查链接失败');
      setNotice('审查链接生成失败，请检查后端服务');
    } finally {
      setReviewBusy(false);
    }
  };

  const copyReview = async (snapshot: SnapshotMeta) => {
    if (await copyText(buildReviewUrl(snapshot.token))) {
      setCopiedToken(snapshot.token);
      window.setTimeout(() => setCopiedToken((current) => (current === snapshot.token ? undefined : current)), 2000);
    }
  };

  const revokeReview = (snapshot: SnapshotMeta) => {
    // 两步确认：第一次点击进入确认态，再次点击才真正撤销
    if (confirmingRevoke !== snapshot.id) {
      setConfirmingRevoke(snapshot.id);
      window.setTimeout(() => setConfirmingRevoke((current) => (current === snapshot.id ? undefined : current)), 4000);
      return;
    }
    setConfirmingRevoke(undefined);
    snapshotApi.revoke(snapshot.id)
      .then(() => {
        setSnapshotsVersion((version) => version + 1);
        setNotice('审查链接已撤销，复核人将无法再打开该快照');
      })
      .catch(() => setNotice('撤销失败：请确认后端运行在 http://localhost:4000'));
  };

  const loadPlan = (saved: RoutePlan) => {
    setPlan(saved);
    setActivePlanId(saved.id);
    setDraftPolygon([]);
    setReviewError('');
    setNotice(`已加载「${saved.name}」`);
  };

  const newPlan = () => {
    setPlan({ ...initialPlan, name: '未命名航线', id: undefined, waypoints: [], noFlyZones: [] });
    setActivePlanId(undefined);
    setDraftPolygon([]);
    setReviewError('');
    setNotice('已新建空白方案');
  };

  const toolItems: Array<{ id: Tool; label: string; icon: string; hint: string }> = [
    { id: 'select', label: '选择', icon: '↖', hint: '浏览画布' },
    { id: 'start', label: '起点', icon: 'S', hint: '点击设置起点' },
    { id: 'end', label: '终点', icon: 'E', hint: '点击设置终点' },
    { id: 'waypoint', label: '航点', icon: '✦', hint: '点击添加航点' },
    { id: 'rectangle', label: '矩形禁飞区', icon: '▧', hint: '点击放置矩形' },
    { id: 'polygon', label: '多边形禁飞区', icon: '⬠', hint: '逐点绘制后完成' }
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">✦</div>
          <div><strong>SkyRoute</strong><span>无人机航线规划工作台</span></div>
        </div>
        <div className="topbar-actions">
          <span className="status-dot"><i /> 本地工作区</span>
          <button className="ghost-button" onClick={newPlan}>＋ 新建方案</button>
          <button className="primary-button" onClick={save}>{saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '已保存 ✓' : '保存方案'}</button>
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <section className="side-section project-section">
            <div className="section-eyebrow">当前任务</div>
            <input className="plan-name" value={plan.name} onChange={(event) => updatePlan({ name: event.target.value })} aria-label="方案名称" />
            <div className="subtle-text">二维航线 · 坐标单位 km</div>
          </section>

          <section className="side-section">
            <div className="section-title"><span>编辑工具</span><small>{tool === 'polygon' ? '绘制中' : '选择操作'}</small></div>
            <div className="tool-grid">
              {toolItems.map((item) => <button key={item.id} className={`tool-button ${tool === item.id ? 'active' : ''}`} onClick={() => { setTool(item.id); if (item.id !== 'polygon') setDraftPolygon([]); }} title={item.hint}><b>{item.icon}</b><span>{item.label}</span></button>)}
            </div>
            {tool === 'polygon' && <button className="complete-button" onClick={finishPolygon}>完成多边形 ({draftPolygon.length} 点)</button>}
            <div className="tool-hint">{toolItems.find((item) => item.id === tool)?.hint}</div>
          </section>

          <section className="side-section">
            <div className="section-title"><span>航点列表</span><strong>{plan.waypoints.length}</strong></div>
            <div className="node-row start-row"><span className="node-badge start">S</span><div><b>起点</b><small>{pointText(plan.start)}</small></div></div>
            {plan.waypoints.map((waypoint, index) => <div className="node-row" key={`${waypoint.x}-${waypoint.y}-${index}`}><span className="node-badge waypoint">{index + 1}</span><div><b>航点 {String(index + 1).padStart(2, '0')}</b><small>{pointText(waypoint)}</small></div><button className="remove-button" onClick={() => removeWaypoint(index)}>×</button></div>)}
            <div className="node-row end-row"><span className="node-badge end">E</span><div><b>终点</b><small>{pointText(plan.end)}</small></div></div>
          </section>

          <section className="side-section">
            <div className="section-title"><span>禁飞区</span><strong>{plan.noFlyZones.length}</strong></div>
            {plan.noFlyZones.length === 0 && <div className="empty-row">暂无禁飞区</div>}
            {plan.noFlyZones.map((zone) => <div className="zone-row" key={zone.id}><span className="zone-swatch" style={{ background: zone.color }} /><div><b>{zone.name}</b><small>{zone.kind === 'rectangle' ? '矩形区域' : `${zone.points.length} 边形区域`}</small></div><button className="remove-button" onClick={() => removeZone(zone.id)}>×</button></div>)}
          </section>

          <section className="side-section saved-section">
            <div className="section-title"><span>已保存方案</span><strong>{savedPlans.length}</strong></div>
            {savedPlans.length === 0 && <div className="empty-row">保存后将在这里显示</div>}
            {savedPlans.slice(0, 4).map((saved) => <button className="saved-plan" key={saved.id} onClick={() => loadPlan(saved)}><span>{saved.name}</span><small>{saved.updatedAt ? new Date(saved.updatedAt).toLocaleDateString('zh-CN') : '—'}</small></button>)}
          </section>
        </aside>

        <section className="canvas-panel">
          <div className="canvas-toolbar"><div><span className="breadcrumb">航线规划 / </span><strong>{plan.name}</strong></div><div className="toolbar-right"><span className="canvas-size">100 × 70 km</span><span className={`validation-chip ${validation.valid ? 'valid' : 'invalid'}`}>{validation.valid ? '路径可执行' : `${validation.issues.length} 项风险`}</span></div></div>
          <div className="canvas-wrap">
            <RouteCanvas ref={svgRef} plan={plan} riskSegments={activeSegment} draftPolygon={draftPolygon} interactive onCanvasClick={handleCanvasClick} onCanvasPointerUp={handlePointerUp} />
            <div className="canvas-compass"><span>北</span><b>↑</b></div>
            <div className="canvas-legend"><span><i className="legend-line" />规划航线</span><span><i className="legend-zone" />禁飞区</span><span><i className="legend-risk" />风险航段</span></div>
          </div>
          <div className="canvas-footer"><span>{notice}</span><span>提示：所有坐标均以左下角为原点</span></div>
        </section>

        <aside className="inspector">
          <section className="metric-card primary-metric"><div className="metric-label">航线总距离</div><div className="metric-value">{formatDistance(validation.distance)}</div><div className="metric-caption">{points.length - 1} 个航段 · 预计 18 分钟</div><div className="metric-spark"><span style={{ height: '35%' }} /><span style={{ height: '55%' }} /><span style={{ height: '42%' }} /><span style={{ height: '75%' }} /><span style={{ height: '65%' }} /><span style={{ height: '92%' }} /><span style={{ height: '78%' }} /><span style={{ height: '100%' }} /></div></section>
          <section className={`validation-card ${validation.valid ? 'is-valid' : 'has-error'}`}><div className="validation-heading"><span className="validation-icon">{validation.valid ? '✓' : '!'}</span><div><b>{validation.valid ? '校验通过' : '需要调整'}</b><small>{validation.valid ? '未发现越界或穿越禁飞区' : '请查看下方风险项'}</small></div></div>{validation.issues.length > 0 && <div className="issue-list">{validation.issues.slice(0, 4).map((issue, index) => <div className="issue-item" key={`${issue.message}-${index}`}><span>×</span>{issue.message}</div>)}</div>}</section>
          <section className="inspector-section"><div className="section-title"><span>航线摘要</span><small>实时计算</small></div><div className="summary-list"><div><span>起点</span><b>{pointText(plan.start)}</b></div><div><span>终点</span><b>{pointText(plan.end)}</b></div><div><span>航点</span><b>{plan.waypoints.length} 个</b></div><div><span>禁飞区</span><b>{plan.noFlyZones.length} 个</b></div></div></section>
          <section className="inspector-section"><div className="section-title"><span>快捷操作</span></div><button className="outline-action" onClick={() => { updatePlan({ waypoints: [] }); setNotice('已清空所有航点'); }}>清空航点</button><button className="outline-action" onClick={() => { updatePlan({ noFlyZones: [] }); setNotice('已移除所有禁飞区'); }}>移除禁飞区</button><button className="outline-action" onClick={() => setValidation(validateRoute(plan))}>重新校验路径 <span>⌘↵</span></button></section>

          <section className="inspector-section review-section">
            <div className="section-title"><span>只读审查链接</span><strong>{activeSnapshots.length} 个有效</strong></div>
            <div className="review-create-row">
              <select className="ttl-select" value={ttlHours} onChange={(event) => setTtlHours(Number(event.target.value))} aria-label="审查链接有效期">
                {REVIEW_TTL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <button className="primary-button review-create-button" onClick={createReview} disabled={reviewBusy}>
                {reviewBusy ? '生成中…' : '生成审查链接'}
              </button>
            </div>
            <div className="tool-hint">生成前会自动保存当前方案，快照冻结此刻的坐标、禁飞区与校验结果；后续编辑不影响已发出的链接。</div>
            {reviewError && <div className="review-error">⚠ {reviewError}</div>}
            {snapshots.length === 0 && <div className="empty-row">还没有审查链接，生成后可复制发送给复核安全员</div>}
            {snapshots.map((snapshot) => (
              <div className={`snapshot-row ${snapshot.status}`} key={snapshot.id}>
                <div className="snapshot-row-main">
                  <b>{snapshot.status === 'active' ? `🔗 ${formatDateTime(snapshot.createdAt)}` : snapshot.status === 'revoked' ? `⛔ 已撤销 · ${formatDateTime(snapshot.revokedAt)}` : '⏱ 已过期'}
                  </b>
                  <small>{snapshot.status === 'active' ? relativeExpiry(snapshot.expiresAt) : `创建于 ${formatDateTime(snapshot.createdAt)}`}</small>
                </div>
                {snapshot.status === 'active' && (
                  <div className="snapshot-row-actions">
                    <button className="snapshot-action copy" onClick={() => copyReview(snapshot)} title="复制审查地址">{copiedToken === snapshot.token ? '已复制 ✓' : '复制'}</button>
                    <button className={`snapshot-action revoke ${confirmingRevoke === snapshot.id ? 'confirm' : ''}`} onClick={() => revokeReview(snapshot)}>{confirmingRevoke === snapshot.id ? '确认撤销？' : '撤销'}</button>
                  </div>
                )}
              </div>
            ))}
          </section>

          <section className="api-note"><div className="api-icon">⌁</div><div><b>内存 REST API</b><small>保存到当前 Node.js 进程，重启后清空</small></div></section>
        </aside>
      </main>
    </div>
  );
}
