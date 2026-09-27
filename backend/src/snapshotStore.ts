import { randomBytes, randomUUID } from 'node:crypto';
import { validateRoute } from './geometry.js';
import type { ReviewSnapshotRecord, RoutePlan, SnapshotStatus } from './types.js';

/** 单个方案允许同时存在的有效快照数量上限，防止无限生成 */
export const MAX_ACTIVE_SNAPSHOTS_PER_PLAN = Number(process.env.SNAPSHOT_MAX_PER_PLAN ?? 20);
/** 快照体（方案 JSON）大小上限，超过返回快照过大的错误 */
export const MAX_SNAPSHOT_BYTES = Number(process.env.SNAPSHOT_MAX_BYTES ?? 256 * 1024);
/** 默认有效期（小时），0 表示长期有效 */
export const DEFAULT_SNAPSHOT_TTL_HOURS = Number(process.env.SNAPSHOT_DEFAULT_TTL_HOURS ?? 24 * 7);
/** 允许的最大有效期（小时），避免传入离谱的过期时间 */
export const MAX_SNAPSHOT_TTL_HOURS = 24 * 90;

/** 公开令牌：12 字节随机数的 base64url 编码，16 个字符 */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16}$/;

export class SnapshotError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const snapshotsById = new Map<string, ReviewSnapshotRecord>();
const snapshotsByToken = new Map<string, ReviewSnapshotRecord>();

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function isExpired(record: ReviewSnapshotRecord, now: Date = new Date()): boolean {
  return record.expiresAt !== null && record.expiresAt <= now.toISOString();
}

export function snapshotStatus(record: ReviewSnapshotRecord, now: Date = new Date()): SnapshotStatus {
  if (record.revokedAt) return 'revoked';
  if (isExpired(record, now)) return 'expired';
  return 'active';
}

function newToken(): string {
  // 令牌空间约 2^96，碰撞概率极低；仍做一次防御性重试
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = randomBytes(12).toString('base64url');
    if (!snapshotsByToken.has(token)) return token;
  }
  throw new SnapshotError(500, 'TOKEN_ALLOCATION_FAILED', '令牌分配失败，请重试');
}

function resolveTtlHours(ttlHours: unknown): number {
  if (ttlHours === undefined || ttlHours === null) return DEFAULT_SNAPSHOT_TTL_HOURS;
  const value = Number(ttlHours);
  if (!Number.isFinite(value) || value < 0 || value > MAX_SNAPSHOT_TTL_HOURS) {
    throw new SnapshotError(400, 'INVALID_TTL', `ttlHours 必须是 0 ~ ${MAX_SNAPSHOT_TTL_HOURS} 之间的数字（0 表示长期有效）`);
  }
  return value;
}

function activeSnapshotsOf(planId: string, now: Date): ReviewSnapshotRecord[] {
  return [...snapshotsById.values()].filter((record) => record.planId === planId && snapshotStatus(record, now) === 'active');
}

export function createSnapshot(input: {
  plan: RoutePlan;
  ttlHours?: number | null;
  idempotencyKey?: string;
}): { record: ReviewSnapshotRecord; reused: boolean } {
  const { plan } = input;
  const now = new Date();

  // 幂等：同一方案 + 同一幂等键直接返回首次创建的快照（重复点击 / 网络重试安全）
  if (input.idempotencyKey) {
    for (const record of snapshotsById.values()) {
      if (record.planId === plan.id && record.idempotencyKey === input.idempotencyKey) {
        return { record, reused: true };
      }
    }
  }

  // 大方案保护：快照需要长期持有完整方案副本，超出上限拒绝创建
  const size = Buffer.byteLength(JSON.stringify(plan), 'utf8');
  if (size > MAX_SNAPSHOT_BYTES) {
    throw new SnapshotError(413, 'SNAPSHOT_TOO_LARGE', `方案数据过大（${(size / 1024).toFixed(0)} KB），超过快照大小上限 ${(MAX_SNAPSHOT_BYTES / 1024).toFixed(0)} KB，请精简航点或禁飞区后再试`);
  }

  if (activeSnapshotsOf(plan.id, now).length >= MAX_ACTIVE_SNAPSHOTS_PER_PLAN) {
    throw new SnapshotError(409, 'SNAPSHOT_LIMIT', `该方案的有效审查链接已达上限（${MAX_ACTIVE_SNAPSHOTS_PER_PLAN} 个），请先撤销不再使用的链接`);
  }

  const ttlHours = resolveTtlHours(input.ttlHours);
  const record: ReviewSnapshotRecord = {
    id: randomUUID(),
    token: newToken(),
    planId: plan.id,
    sourcePlanUpdatedAt: plan.updatedAt,
    idempotencyKey: input.idempotencyKey,
    createdAt: now.toISOString(),
    expiresAt: ttlHours > 0 ? new Date(now.getTime() + ttlHours * 3_600_000).toISOString() : null,
    revokedAt: null,
    // 深拷贝 + 冻结：此后对原方案的任何修改都不会渗入快照
    plan: deepFreeze(structuredClone(plan)),
    validation: deepFreeze(structuredClone(validateRoute(plan)))
  };

  snapshotsById.set(record.id, record);
  snapshotsByToken.set(record.token, record);
  return { record, reused: false };
}

export function listSnapshotsForPlan(planId: string): ReviewSnapshotRecord[] {
  return [...snapshotsById.values()]
    .filter((record) => record.planId === planId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findSnapshotByToken(token: string): ReviewSnapshotRecord | undefined {
  return snapshotsByToken.get(token);
}

export function revokeSnapshot(id: string): ReviewSnapshotRecord | undefined {
  const record = snapshotsById.get(id);
  if (!record) return undefined;
  if (!record.revokedAt) {
    // revokedAt 是可变的审计字段；方案与校验结果本身保持冻结
    (record as { revokedAt: string | null }).revokedAt = new Date().toISOString();
  }
  return record;
}
