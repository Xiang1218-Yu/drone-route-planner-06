import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { validateRoute } from './geometry.js';
import { deletePlan, getPlan, listPlans, savePlan } from './store.js';
import {
  createSnapshot,
  findSnapshotByToken,
  listSnapshotsForPlan,
  revokeSnapshot,
  snapshotStatus,
  SnapshotError,
  TOKEN_PATTERN
} from './snapshotStore.js';
import type { NoFlyZone, Point, ReviewSnapshotRecord, RoutePlan } from './types.js';

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(value: unknown): value is Point {
  return !!value && typeof value === 'object' && isFiniteNumber((value as Point).x) && isFiniteNumber((value as Point).y);
}

function isNoFlyZone(value: unknown): value is NoFlyZone {
  if (!value || typeof value !== 'object') return false;
  const zone = value as NoFlyZone;
  return (
    typeof zone.id === 'string' &&
    typeof zone.name === 'string' &&
    (zone.kind === 'rectangle' || zone.kind === 'polygon') &&
    Array.isArray(zone.points) &&
    zone.points.every(isPoint)
  );
}

/** 解析并校验方案请求体，非法结构返回 null（由调用方返回 400） */
function parsePlanBody(body: Partial<RoutePlan> | undefined): Omit<RoutePlan, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<RoutePlan, 'id' | 'createdAt'>> | null {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.name !== 'string' || body.name.trim().length === 0) return null;
  if (!body.canvas || !isFiniteNumber(body.canvas.width) || !isFiniteNumber(body.canvas.height)) return null;
  if (!isPoint(body.start) || !isPoint(body.end)) return null;
  if (body.waypoints !== undefined && (!Array.isArray(body.waypoints) || !body.waypoints.every(isPoint))) return null;
  if (body.noFlyZones !== undefined && (!Array.isArray(body.noFlyZones) || !body.noFlyZones.every(isNoFlyZone))) return null;
  return {
    id: body.id,
    createdAt: body.createdAt,
    name: body.name,
    canvas: body.canvas,
    start: body.start,
    end: body.end,
    waypoints: body.waypoints ?? [],
    noFlyZones: body.noFlyZones ?? []
  };
}

/** 编辑侧使用的快照元信息（不含方案体与校验结果） */
function snapshotMeta(record: ReviewSnapshotRecord) {
  return {
    id: record.id,
    token: record.token,
    planId: record.planId,
    planName: record.plan.name,
    sourcePlanUpdatedAt: record.sourcePlanUpdatedAt,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    status: snapshotStatus(record)
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'drone-route-planner-api' });
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
  const parsed = parsePlanBody(req.body);
  if (!parsed) {
    return res.status(400).json({ message: '请求体不合法：name、canvas、start、end 为必填字段，坐标必须是有限数字' });
  }

  const plan = savePlan(parsed);
  return res.status(req.body?.id ? 200 : 201).json({ plan, validation: validateRoute(plan) });
});

app.delete('/api/plans/:id', (req, res) => {
  if (!deletePlan(req.params.id)) return res.status(404).json({ message: '找不到该航线方案' });
  return res.status(204).send();
});

// ---------- 只读审查快照（编辑侧管理接口） ----------

/** 为指定方案创建不可变快照，返回短令牌；支持 Idempotency-Key 去重 */
app.post('/api/plans/:id/snapshots', (req, res) => {
  const plan = getPlan(req.params.id);
  if (!plan) return res.status(404).json({ message: '找不到该航线方案，请先保存方案' });

  const body = (req.body ?? {}) as { ttlHours?: number | null };
  const idempotencyKeyHeader = req.header('Idempotency-Key');
  const idempotencyKey = typeof idempotencyKeyHeader === 'string' && idempotencyKeyHeader.trim() ? idempotencyKeyHeader.trim().slice(0, 128) : undefined;

  try {
    const { record, reused } = createSnapshot({ plan, ttlHours: body.ttlHours, idempotencyKey });
    return res.status(reused ? 200 : 201).json({ snapshot: snapshotMeta(record), reused });
  } catch (error) {
    if (error instanceof SnapshotError) {
      return res.status(error.status).json({ code: error.code, message: error.message });
    }
    throw error;
  }
});

/** 列出指定方案的全部快照（含已撤销 / 已过期，便于审计） */
app.get('/api/plans/:id/snapshots', (req, res) => {
  if (!getPlan(req.params.id)) return res.status(404).json({ message: '找不到该航线方案' });
  return res.json({ snapshots: listSnapshotsForPlan(req.params.id).map(snapshotMeta) });
});

/** 撤销快照：立即生效，再次撤销是幂等操作 */
app.delete('/api/snapshots/:id', (req, res) => {
  const record = revokeSnapshot(req.params.id);
  if (!record) return res.status(404).json({ message: '找不到该审查快照，可能已被清理' });
  return res.status(204).send();
});

// ---------- 只读审查快照（公开只读接口，不接受任何修改） ----------

app.get('/api/review/:token', (req, res) => {
  const { token } = req.params;
  if (!TOKEN_PATTERN.test(token)) {
    return res.status(404).json({ code: 'SNAPSHOT_NOT_FOUND', message: '审查链接无效' });
  }
  const record = findSnapshotByToken(token);
  if (!record) {
    return res.status(404).json({ code: 'SNAPSHOT_NOT_FOUND', message: '审查链接不存在或已被清理' });
  }
  const status = snapshotStatus(record);
  if (status === 'revoked') {
    return res.status(410).json({ code: 'SNAPSHOT_REVOKED', message: '该审查链接已被撤销', revokedAt: record.revokedAt });
  }
  if (status === 'expired') {
    return res.status(410).json({ code: 'SNAPSHOT_EXPIRED', message: '该审查链接已过期', expiresAt: record.expiresAt });
  }

  const source = getPlan(record.planId);
  res.set('Cache-Control', 'no-store');
  return res.json({
    snapshot: {
      id: record.id,
      token: record.token,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      status,
      plan: record.plan,
      validation: record.validation,
      source: {
        planId: record.planId,
        planName: record.plan.name,
        sourcePlanUpdatedAt: record.sourcePlanUpdatedAt,
        exists: source !== undefined,
        updatedAt: source?.updatedAt
      }
    }
  });
});

// 审查令牌只允许只读访问，任何写方法一律 405，避免被当作编辑入口
app.all('/api/review/:token', (_req, res) => {
  res.set('Allow', 'GET');
  return res.status(405).json({ code: 'METHOD_NOT_ALLOWED', message: '审查链接为只读，仅支持 GET' });
});

// 未匹配的 API 路径统一返回 404 JSON
app.use('/api', (_req, res) => {
  res.status(404).json({ code: 'NOT_FOUND', message: '接口不存在' });
});

// 统一错误处理：请求体过大 / JSON 解析失败给出明确提示
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const err = error as { type?: string; status?: number; message?: string };
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', message: '请求体过大，方案数据超出服务器接收上限' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ code: 'INVALID_JSON', message: '请求体不是合法的 JSON' });
  }
  console.error(error);
  return res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务器内部错误' });
});

app.listen(port, () => {
  console.log(`Drone Route Planner API listening on http://localhost:${port}`);
});
