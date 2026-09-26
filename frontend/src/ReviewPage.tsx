import { useEffect, useState } from 'react';
import { snapshotApi, reviewUrl, copyText } from './api';
import ReadonlyCanvas from './ReadonlyCanvas';
import { formatDateTime, formatRelative } from './format';
import { routePoints } from './geometry';
import type { ReviewErrorReason, ReviewSnapshot } from './types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; snapshot: ReviewSnapshot }
  | { kind: 'invalid'; reason: ReviewErrorReason; detail?: string; expiredAt?: string | null; revokedAt?: string | null }
  | { kind: 'offline' };

function pointText(point: { x: number; y: number }) {
  return `${point.x.toFixed(1)}, ${point.y.toFixed(1)}`;
}

function InvalidPanel({ state }: { state: Extract<LoadState, { kind: 'invalid' }> }) {
  const meta = {
    'not-found': {
      icon: '🔍',
      title: '审查链接不存在',
      desc: state.detail ?? '链接地址可能不完整或输入有误，也可能该快照从未生成或已被清理。请联系方案提交人重新获取链接。'
    },
    expired: {
      icon: '⏳',
      title: '审查链接已过期',
      desc: `该快照已于 ${formatDateTime(state.expiredAt ?? null)} 到期（${formatRelative(state.expiredAt ?? null)}）。过期快照不可查看，请联系方案提交人重新生成。`
    },
    revoked: {
      icon: '⛔',
      title: '审查链接已被撤销',
      desc: `方案所有者已于 ${formatDateTime(state.revokedAt ?? null)} 撤销了这条审查链接。请联系提交人确认方案是否更新，并索取新的链接。`
    }
  }[state.reason];

  return (
    <div className="review-dead">
      <div className="review-dead-card">
        <div className="review-dead-icon">{meta.icon}</div>
        <h1>{meta.title}</h1>
        <p>{meta.desc}</p>
        <a className="primary-button" href="/">返回航线规划工作台</a>
      </div>
    </div>
  );
}

function OfflinePanel({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="review-dead">
      <div className="review-dead-card">
        <div className="review-dead-icon">📡</div>
        <h1>无法加载审查快照</h1>
        <p>无法连接到方案服务，可能是后端未启动或网络中断。链接本身没有失效，请稍后重试。</p>
        <button className="primary-button" onClick={onRetry}>重新加载</button>
      </div>
    </div>
  );
}

export default function ReviewPage({ token }: { token: string }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [copied, setCopied] = useState(false);

  const load = () => {
    setState({ kind: 'loading' });
    snapshotApi
      .review(token)
      .then((snapshot) => setState({ kind: 'ready', snapshot }))
      .catch((error: { status?: number; reason?: ReviewErrorReason; message?: string; body?: { expiredAt?: string; revokedAt?: string } }) => {
        if (error?.status === 410 && (error.reason === 'expired' || error.reason === 'revoked')) {
          // 410 的具体时间在 body 中，文案需要展示何时过期 / 撤销
          setState({
            kind: 'invalid',
            reason: error.reason,
            expiredAt: error.body?.expiredAt ?? null,
            revokedAt: error.body?.revokedAt ?? null
          });
        } else if (error?.status === 404) {
          setState({ kind: 'invalid', reason: error.reason ?? 'not-found' });
        } else {
          setState({ kind: 'offline' });
        }
      });
  };

  useEffect(() => {
    document.title = '只读审查 · SkyRoute';
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (state.kind === 'loading') {
    return <div className="review-dead"><div className="review-dead-card loading"><div className="review-spinner" /><h1>正在加载审查快照…</h1></div></div>;
  }
  if (state.kind === 'offline') return <OfflinePanel onRetry={load} />;
  if (state.kind === 'invalid') return <InvalidPanel state={state} />;

  const { snapshot } = state;
  const { plan, validation } = snapshot;
  const points = routePoints(plan);
  const url = reviewUrl(snapshot.token);
  const expired = snapshot.expiresAt ? new Date(snapshot.expiresAt).getTime() - Date.now() : null;

  const copy = async () => {
    if (await copyText(url)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <div className="app-shell review-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">✦</div>
          <div><strong>SkyRoute</strong><span>无人机航线只读审查</span></div>
        </div>
        <div className="topbar-actions">
          <span className="readonly-badge"><i>🔒</i> 只读视图 · 无法编辑</span>
          <button className="ghost-button" onClick={copy}>{copied ? '已复制 ✓' : '复制审查地址'}</button>
        </div>
      </header>

      <div className="readonly-ribbon">
        <b>只读审查模式</b>
        <span>以下为提交时固化的方案快照与当时校验结果，后续编辑不会改变本页面内容。</span>
      </div>

      <main className="workspace review-workspace">
        <aside className="sidebar">
          <section className="side-section project-section">
            <div className="section-eyebrow">快照来源</div>
            <div className="review-plan-name">{snapshot.sourcePlan.name}</div>
            <div className="subtle-text">来源方案 ID：{snapshot.sourcePlan.id}</div>
          </section>

          <section className="side-section">
            <div className="section-title"><span>快照信息</span></div>
            <div className="summary-list">
              <div><span>创建时间</span><b>{formatDateTime(snapshot.createdAt)}</b></div>
              <div><span>有效期</span><b>{snapshot.expiresAt ? `${formatDateTime(snapshot.expiresAt)}（${formatRelative(snapshot.expiresAt)}过期）` : '长期有效'}</b></div>
              <div><span>快照体积</span><b>{(snapshot.sizeBytes / 1024).toFixed(1)} KB</b></div>
              <div><span>链接令牌</span><b className="token-text">{snapshot.token}</b></div>
            </div>
          </section>

          <section className="side-section">
            <div className="section-title"><span>航点坐标</span><strong>{points.length}</strong></div>
            <div className="node-row start-row"><span className="node-badge start">S</span><div><b>起点</b><small>{pointText(plan.start)}</small></div></div>
            {plan.waypoints.map((waypoint, index) => (
              <div className="node-row" key={`${waypoint.x}-${waypoint.y}-${index}`}>
                <span className="node-badge waypoint">{index + 1}</span>
                <div><b>航点 {String(index + 1).padStart(2, '0')}</b><small>{pointText(waypoint)}</small></div>
              </div>
            ))}
            <div className="node-row end-row"><span className="node-badge end">E</span><div><b>终点</b><small>{pointText(plan.end)}</small></div></div>
          </section>

          <section className="side-section" style={{ borderBottom: 0 }}>
            <div className="section-title"><span>禁飞区</span><strong>{plan.noFlyZones.length}</strong></div>
            {plan.noFlyZones.length === 0 && <div className="empty-row">快照中没有禁飞区</div>}
            {plan.noFlyZones.map((zone) => (
              <div className="zone-row" key={zone.id}>
                <span className="zone-swatch" style={{ background: zone.color || '#fb7185' }} />
                <div><b>{zone.name}</b><small>{zone.kind === 'rectangle' ? '矩形区域' : `${zone.points.length} 边形区域`}</small></div>
              </div>
            ))}
          </section>
        </aside>

        <section className="canvas-panel">
          <div className="canvas-toolbar">
            <div><span className="breadcrumb">只读审查 / </span><strong>{plan.name}</strong></div>
            <div className="toolbar-right">
              <span className="canvas-size">{plan.canvas.width} × {plan.canvas.height} km</span>
              <span className={`validation-chip ${validation.valid ? 'valid' : 'invalid'}`}>
                {validation.valid ? '快照校验：通过' : `快照校验：${validation.issues.length} 项风险`}
              </span>
            </div>
          </div>
          <ReadonlyCanvas plan={plan} issues={validation.issues} />
          <div className="canvas-footer">
            <span>快照创建于 {formatDateTime(snapshot.createdAt)}，坐标与禁飞区均为提交时数据</span>
            <span>{expired !== null && expired > 0 ? `链接将在 ${formatRelative(snapshot.expiresAt)}过期` : '审查内容不可编辑'}</span>
          </div>
        </section>

        <aside className="inspector">
          <section className="metric-card primary-metric">
            <div className="metric-label">航线总距离（快照计算）</div>
            <div className="metric-value">{validation.distance.toFixed(1)} km</div>
            <div className="metric-caption">{points.length - 1} 个航段</div>
          </section>

          <section className={`validation-card ${validation.valid ? 'is-valid' : 'has-error'}`}>
            <div className="validation-heading">
              <span className="validation-icon">{validation.valid ? '✓' : '!'}</span>
              <div>
                <b>{validation.valid ? '校验通过' : '存在当前风险'}</b>
                <small>{validation.valid ? '未发现越界或穿越禁飞区' : `创建快照时检出 ${validation.issues.length} 项风险`}</small>
              </div>
            </div>
            {validation.issues.length > 0 && (
              <div className="issue-list">
                {validation.issues.map((issue, index) => (
                  <div className="issue-item" key={`${issue.message}-${index}`}><span>×</span>{issue.message}</div>
                ))}
              </div>
            )}
          </section>

          <section className="inspector-section">
            <div className="section-title"><span>方案摘要</span><small>快照固化</small></div>
            <div className="summary-list">
              <div><span>起点</span><b>{pointText(plan.start)}</b></div>
              <div><span>终点</span><b>{pointText(plan.end)}</b></div>
              <div><span>航点</span><b>{plan.waypoints.length} 个</b></div>
              <div><span>禁飞区</span><b>{plan.noFlyZones.length} 个</b></div>
            </div>
          </section>

          <section className="api-note review-note">
            <div className="api-icon">🔒</div>
            <div><b>这是只读页面</b><small>不提供保存、修改或撤销入口；如需调整请联系方案提交人</small></div>
          </section>
        </aside>
      </main>
    </div>
  );
}
