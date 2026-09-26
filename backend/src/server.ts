import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { validateRoute } from './geometry.js';
import { deletePlan, getPlan, listPlans, savePlan } from './store.js';
import {
  createSnapshot,
  getSnapshotForReview,
  isReviewToken,
  listSnapshotsForPlan,
  revokeSnapshot,
  snapshotStatus,
  SnapshotTooLargeError,
  MAX_SNAPSHOT_BYTES
} from './snapshotStore.js';
import type { PlanSnapshot, RoutePlan } from './types.js';

const app = express();
const port = Number(process.env.PORT ?? 4000);

/**
 * 方案编辑接口允许 1MB；单个快照另在 snapshotStore 中限制 MAX_SNAPSHOT_BYTES。
 * 大方案在超过快照上限时返回 413。
 */
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'drone-route-planner_api' });
});

app.get('/api/plans', (_req, res) => {
  res.json({ plans: listPlans() });
});

app.get('/api/plans/:id', (req, res) => {
  const plan = getPlan(req.params.id);
  if (!plan) return res.status(404).json({ message: '找不到该航线方案' });
  return res.json({ plan });
});

app.post('/api/plans', (req: Request<unknown, unknown, Partial<RoutePlan>>, res: Response) => {
  const body = req.body;
  if (!body || !body.name || !body.canvas || !body.start || !body.end) {
    return res.status(400).json({ message: 'name、canvas、start、end 为必填字段' });
  }

  const plan = savePlan({
    id: body.id,
    createdAt: body.createdAt,
    name: String(body.name),
    canvas: body.canvas,
    start: body.start,
    end: body.end,
    waypoints: Array.isArray(body.waypoints) ? body.waypoints : [],
    noFlyZones: Array.isArray(body.noFlyZones) ? body.noFlyZones : []
  });

  return res.status(body.id ? 200 : 201).json({ plan, validation: validateRoute(plan) });
});

// 删除方案不会连带删除已发出的快照：快照内嵌了方案副本，审查链接仍可打开。
app.delete('/api/plans/:id', (req, res) => {
  if (!deletePlan(req.params.id)) return res.status(404).json({ message: '找不到该航线方案' });
  return res.status(204).send();
});

// ── 审查快照：方案管理面（创建 / 列表 / 撤销） ──────────────────────────────

type CreateSnapshotBody = { ttlSeconds?: number | null; force?: boolean };

app.post('/api/plans/:id/snapshots', (req: Request<{ id: string }, unknown, CreateSnapshotBody>, res: Response) => {
  const plan = getPlan(req.params.id);
  if (!plan) return res.status(404).json({ message: '找不到该航线方案，请先保存方案后再生成审查链接' });

  const ttl = req.body?.ttlSeconds ?? null;
  if (ttl !== null && ttl !== undefined && (!Number.isInteger(ttl) || ttl <= 0)) {
    return res.status(400).json({ message: 'ttlSeconds 必须为正整数（秒），或不传 / null 表示不过期' });
  }

  try {
    const result = createSnapshot({
      plan,
      validation: validateRoute(plan),
      ttlSeconds: ttl ?? null,
      force: req.body?.force === true
    });
    return res.status(result.reused ? 200 : 201).json(result);
  } catch (error) {
    if (error instanceof SnapshotTooLargeError) {
      return res.status(413).json({ message: error.message, maxBytes: MAX_SNAPSHOT_BYTES, sizeBytes: error.sizeBytes });
    }
    throw error;
  }
});

app.get('/api/plans/:id/snapshots', (req, res) => {
  if (!getPlan(req.params.id)) return res.status(404).json({ message: '找不到该航线方案' });
  res.json({ snapshots: listSnapshotsForPlan(req.params.id) });
});

app.delete('/api/plans/:id/snapshots/:token', (req, res) => {
  const manageToken = req.header('X-Manage-Token');
  const result = revokeSnapshot(req.params.id, req.params.token, manageToken);
  if (result === 'not-found') return res.status(404).json({ message: '找不到该审查快照' });
  if (result === 'forbidden') return res.status(403).json({ message: '缺少有效的撤销凭据' });
  // revoked / already-revoked 都视为幂等成功
  return res.status(204).send();
});

// ── 审查快照：只读面（供复核人打开，不含任何编辑能力） ──────────────────────

function reviewPayload(snapshot: PlanSnapshot) {
  return {
    token: snapshot.token,
    createdAt: snapshot.createdAt,
    expiresAt: snapshot.expiresAt,
    sourcePlan: { id: snapshot.planId, name: snapshot.planName },
    plan: snapshot.plan,
    validation: snapshot.validation,
    sizeBytes: snapshot.sizeBytes
  };
}

app.get('/api/review/:token', (req, res) => {
  // 失效页内容也禁止缓存：撤销后刷新不应看到旧内容
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.set('Pragma', 'no-cache');

  const token = req.params.token;
  if (!isReviewToken(token)) {
    return res.status(404).json({ reason: 'not-found', message: '审查链接格式不正确，或快照不存在' });
  }

  const snapshot = getSnapshotForReview(token);
  if (!snapshot) {
    return res.status(404).json({ reason: 'not-found', message: '审查快照不存在：链接可能有误，或方案从未生成过审查链接' });
  }

  const status = snapshotStatus(snapshot);
  if (status === 'revoked') {
    return res.status(410).json({
      reason: 'revoked',
      message: '该审查链接已被方案所有者撤销，无法再查看',
      revokedAt: snapshot.revokedAt
    });
  }
  if (status === 'expired') {
    return res.status(410).json({
      reason: 'expired',
      message: '该审查链接已过期',
      createdAt: snapshot.createdAt,
      expiredAt: snapshot.expiresAt
    });
  }

  return res.json(reviewPayload(snapshot));
});

// JSON body 解析失败 / 体积超限的统一 JSON 错误处理（不能交给 Express 默认 HTML 错误页）
const jsonErrorHandler: express.ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof SyntaxError) {
    return res.status(400).json({ message: '请求体不是合法的 JSON' });
  }
  if (error && typeof error === 'object' && 'type' in error) {
    const type = (error as { type?: string }).type;
    if (type === 'entity.too.large') {
      return res.status(413).json({ message: '请求体超过 1MB 体积上限' });
    }
    if (type === 'entity.parse.failed') {
      return res.status(400).json({ message: '请求体不是合法的 JSON' });
    }
  }
  console.error(error);
  return res.status(500).json({ message: '服务器内部错误' });
};

app.use(jsonErrorHandler);

app.listen(port, () => {
  console.log(`Drone Route Planner API listening on http://localhost:${port}`);
});
