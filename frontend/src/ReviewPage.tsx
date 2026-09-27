import { useEffect, useMemo, useState } from 'react';
import { fetchReview } from './reviewApi';
import { buildReviewUrl, copyText } from './reviewLinks';
import { formatDateTime, relativeExpiry } from './format';
import RouteCanvas from './RouteCanvas';
import { routePoints } from './geometry';
import { ReviewError, type ReviewSnapshot } from './types';

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; snapshot: ReviewSnapshot }
  | { phase: 'error'; error: ReviewError };

const pointText = (point: { x: number; y: number }) => `${point.x.toFixed(1)}, ${point.y.toFixed(1)}`;
const formatDistance = (value: number) => `${value.toFixed(1)} km`;

const INVALID_META: Record<ReviewError['kind'], { badge: string; title: string; hint: string }> = {
  'not-found': { badge: '⊘', title: '审查链接无效', hint: '链接中的快照编号不存在，可能是复制时缺少了字符，或该快照已被系统清理。' },
  revoked: { badge: '⛔', title: '审查链接已被撤销', hint: '方案编制人已经撤销此链接，你无法继续查看该快照。如需复核，请联系对方重新生成。' },
  expired: { badge: '⏱', title: '审查链接已过期', hint: '该链接超过了创建时设定的有效期，快照内容不再开放。如需查看，请联系方案编制人重新生成。' },
  unavailable: { badge: '⚡', title: '暂时无法打开', hint: '审查服务连接失败，请检查网络后刷新页面重试。' }
};

function InvalidPage({ error }: { error: ReviewError }) {
  const meta = INVALID_META[error.kind];
  return (
    <div className="review-invalid-shell">
      <div className="review-invalid-card">
        <div className={`review-invalid-badge ${error.kind}`}>{meta.badge}</div>
        <h1>{meta.title}</h1>
        <p>{error.message && error.message !== meta.title ? error.message : meta.hint}</p>
        {error.kind === 'revoked' && error.detail?.revokedAt && <div className="review-invalid-meta">撤销时间：{formatDateTime(error.detail.revokedAt)}</div>}
        {error.kind === 'expired' && error.detail?.expiresAt && <div className="review-invalid-meta">有效期至：{formatDateTime(error.detail.expiresAt)}</div>}
        <a className="review-home-link" href="/">返回 SkyRoute 工作台</a>
      </div>
    </div>
  );
}

function ReviewContent({ snapshot }: { snapshot: ReviewSnapshot }) {
  const { plan, validation, source } = snapshot;
  const [copied, setCopied] = useState(false);
  const points = useMemo(() => routePoints(plan), [plan]);
  const riskSegments = useMemo(() => new Set(validation.issues.map((issue) => issue.segmentIndex).filter((index): index is number => index !== undefined)), [validation]);

  const sourceChanged = source.exists && source.updatedAt !== undefined &&
    source.sourcePlanUpdatedAt !== undefined && source.updatedAt !== source.sourcePlanUpdatedAt;

  useEffect(() => {
    document.title = `只读审查 · ${plan.name} · SkyRoute`;
  }, [plan.name]);

  const copyLink = async () => {
    if (await copyText(buildReviewUrl(snapshot.token))) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <div className="review-shell">
      <header className="review-topbar">
        <div className="brand-lockup">
          <div className="brand-mark">✦</div>
          <div><strong>SkyRoute</strong><span>只读安全复核</span></div>
        </div>
        <div className="review-topbar-right">
          <span className="readonly-pill"><i>🔒</i> 只读快照 · 无法编辑</span>
          <button className="ghost-button" onClick={copyLink}>{copied ? '链接已复制 ✓' : '复制本页地址'}</button>
        </div>
      </header>

      <div className="review-banner">
        <b>只读审查视图</b>
        <span>以下内容为创建链接时冻结的方案快照，源方案之后的任何修改都不会影响本页；本页也不提供任何编辑入口。</span>
      </div>

      <main className="workspace review-workspace">
        <aside className="sidebar review-sidebar">
          <section className="side-section">
            <div className="section-eyebrow">来源方案</div>
            <div className="review-plan-name">{plan.name}</div>
            <div className="subtle-text">{source.exists ? `方案编号 ${source.planId}` : '源方案已从工作区删除（快照内容保留）'}</div>
            {sourceChanged && <div className="review-source-drift">源方案在快照之后又被编辑过，本页仍显示快照版本</div>}
          </section>

          <section className="side-section">
            <div className="section-title"><span>航点列表</span><strong>{plan.waypoints.length}</strong></div>
            <div className="node-row start-row"><span className="node-badge start">S</span><div><b>起点</b><small>{pointText(plan.start)}</small></div></div>
            {plan.waypoints.map((waypoint, index) => (
              <div className="node-row" key={`${waypoint.x}-${waypoint.y}-${index}`}><span className="node-badge waypoint">{index + 1}</span><div><b>航点 {String(index + 1).padStart(2, '0')}</b><small>{pointText(waypoint)}</small></div></div>
            ))}
            <div className="node-row end-row"><span className="node-badge end">E</span><div><b>终点</b><small>{pointText(plan.end)}</small></div></div>
          </section>

          <section className="side-section">
            <div className="section-title"><span>禁飞区</span><strong>{plan.noFlyZones.length}</strong></div>
            {plan.noFlyZones.length === 0 && <div className="empty-row">快照创建时没有禁飞区</div>}
            {plan.noFlyZones.map((zone) => (
              <div className="zone-row" key={zone.id}><span className="zone-swatch" style={{ background: zone.color ?? '#fb7185' }} /><div><b>{zone.name}</b><small>{zone.kind === 'rectangle' ? '矩形区域' : `${zone.points.length} 边形区域`}</small></div></div>
            ))}
          </section>
        </aside>

        <section className="canvas-panel">
          <div className="canvas-toolbar">
            <div><span className="breadcrumb">只读审查 / </span><strong>{plan.name}</strong></div>
            <div className="toolbar-right">
              <span className="canvas-size">{plan.canvas.width} × {plan.canvas.height} km</span>
              <span className={`validation-chip ${validation.valid ? 'valid' : 'invalid'}`}>{validation.valid ? '快照校验通过' : `${validation.issues.length} 项当前风险`}</span>
            </div>
          </div>
          <div className="canvas-wrap">
            <RouteCanvas plan={plan} riskSegments={riskSegments} />
            <div className="readonly-watermark">只读 SNAPSHOT</div>
            <div className="canvas-compass"><span>北</span><b>↑</b></div>
            <div className="canvas-legend"><span><i className="legend-line" />规划航线</span><span><i className="legend-zone" />禁飞区</span><span><i className="legend-risk" />风险航段</span></div>
          </div>
          <div className="canvas-footer">
            <span>快照创建于 {formatDateTime(snapshot.createdAt)} · {relativeExpiry(snapshot.expiresAt)}</span>
            <span>所有坐标均以左下角为原点，单位 km</span>
          </div>
        </section>

        <aside className="inspector review-inspector">
          <section className="snapshot-meta-card">
            <div className="section-eyebrow">快照信息</div>
            <div className="snapshot-meta-list">
              <div><span>创建时间</span><b>{formatDateTime(snapshot.createdAt)}</b></div>
              <div><span>来源方案</span><b title={source.planId}>{source.planName}</b></div>
              <div><span>基于版本</span><b>{formatDateTime(source.sourcePlanUpdatedAt)}</b></div>
              <div><span>有效期</span><b>{snapshot.expiresAt ? `至 ${formatDateTime(snapshot.expiresAt)}` : '长期有效'}</b></div>
              <div><span>快照编号</span><b className="snapshot-id">{snapshot.id.slice(0, 8)}</b></div>
            </div>
          </section>

          <section className="metric-card primary-metric">
            <div className="metric-label">快照航线总距离</div>
            <div className="metric-value">{formatDistance(validation.distance)}</div>
            <div className="metric-caption">{points.length - 1} 个航段 · 冻结时计算</div>
          </section>

          <section className={`validation-card ${validation.valid ? 'is-valid' : 'has-error'}`}>
            <div className="validation-heading">
              <span className="validation-icon">{validation.valid ? '✓' : '!'}</span>
              <div><b>{validation.valid ? '校验通过' : '存在当前风险'}</b><small>校验结果为创建快照时冻结，不会随后续编辑变化</small></div>
            </div>
            {validation.issues.length > 0 && (
              <div className="issue-list">{validation.issues.map((issue, index) => <div className="issue-item" key={`${issue.message}-${index}`}><span>×</span>{issue.message}</div>)}</div>
            )}
          </section>

          <section className="inspector-section">
            <div className="section-title"><span>航线摘要</span></div>
            <div className="summary-list">
              <div><span>起点</span><b>{pointText(plan.start)}</b></div>
              <div><span>终点</span><b>{pointText(plan.end)}</b></div>
              <div><span>航点</span><b>{plan.waypoints.length} 个</b></div>
              <div><span>禁飞区</span><b>{plan.noFlyZones.length} 个</b></div>
            </div>
          </section>

          <section className="api-note review-note">
            <div className="api-icon">🔒</div>
            <div><b>只读页面</b><small>复核人无法修改方案；如需调整请联系方案编制人</small></div>
          </section>
        </aside>
      </main>
    </div>
  );
}

export default function ReviewPage({ token }: { token: string }) {
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchReview(token)
      .then((snapshot) => { if (!cancelled) setState({ phase: 'ready', snapshot }); })
      .catch((error: unknown) => { if (!cancelled) setState({ phase: 'error', error: error instanceof ReviewError ? error : new ReviewError('unavailable', '审查服务暂时不可用') }); });
    return () => { cancelled = true; };
  }, [token]);

  if (state.phase === 'loading') {
    return <div className="review-loading"><div className="review-spinner" /><div>正在加载只读审查快照…</div></div>;
  }
  if (state.phase === 'error') return <InvalidPage error={state.error} />;
  return <ReviewContent snapshot={state.snapshot} />;
}
