import { createHash, randomBytes } from 'node:crypto';
import type { PlanSnapshot, RoutePlan, RouteValidation, SnapshotStatus } from './types.js';

const snapshots = new Map<string, PlanSnapshot>();

/** 单个方案快照的序列化体积上限（约 512 KB），防止大方案无限膨胀内存 */
export const MAX_SNAPSHOT_BYTES = 512 * 1024;

/** 只读令牌：URL 安全、无歧义字符，20 位 */
const TOKEN_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
/** 管理令牌（撤销凭据）：更长、更宽的字符集，只通过受控接口返回 */
const MANAGE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export class SnapshotTooLargeError extends Error {
  constructor(public readonly sizeBytes: number) {
    super(`方案快照体积过大（${sizeBytes} 字节，上限 ${MAX_SNAPSHOT_BYTES} 字节）`);
    this.name = 'SnapshotTooLargeError';
  }
}

function randomToken(alphabet: string, length: number): string {
  const bytes = randomBytes(length);
  let token = '';
  for (let i = 0; i < length; i += 1) token += alphabet[bytes[i] % alphabet.length];
  return token;
}

/** 仅供只读路径使用：粗校验令牌格式，格式不合法直接 404，避免命中存储探测 */
export function isReviewToken(value: string): boolean {
  return /^[a-z2-9]{8,32}$/.test(value);
}

/** 对对象键递归排序后再哈希，使相同方案内容始终得到相同指纹 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashPlan(plan: RoutePlan): string {
  return createHash('sha256').update(stableStringify(plan)).digest('hex');
}

export function snapshotStatus(snapshot: PlanSnapshot, now: Date = new Date()): SnapshotStatus {
  if (snapshot.revokedAt) return 'revoked';
  if (snapshot.expiresAt && now.getTime() > new Date(snapshot.expiresAt).getTime()) return 'expired';
  return 'active';
}

function toSummary(snapshot: PlanSnapshot) {
  const status = snapshotStatus(snapshot);
  return {
    id: snapshot.id,
    token: snapshot.token,
    planId: snapshot.planId,
    planName: snapshot.planName,
    contentHash: snapshot.contentHash,
    sizeBytes: snapshot.sizeBytes,
    status,
    createdAt: snapshot.createdAt,
    expiresAt: snapshot.expiresAt,
    revokedAt: snapshot.revokedAt,
    // 仅方案管理面需要撤销凭据；只读 DTO 绝不能包含它
    manageToken: snapshot.manageToken
  };
}

export type SnapshotSummary = ReturnType<typeof toSummary>;

export type CreateSnapshotInput = {
  plan: RoutePlan;
  validation: RouteValidation;
  ttlSeconds?: number | null;
  force?: boolean;
};

export type CreateSnapshotResult = {
  snapshot: SnapshotSummary;
  reused: boolean;
};

/**
 * 创建快照。默认对「同一方案 + 内容指纹相同」的活动快照做复用（重复生成幂等）；
 * force=true 时跳过复用，重新生成一个短链接。
 */
export function createSnapshot(input: CreateSnapshotInput): CreateSnapshotResult {
  const sizeBytes = Buffer.byteLength(JSON.stringify(input.plan), 'utf8');
  if (sizeBytes > MAX_SNAPSHOT_BYTES) throw new SnapshotTooLargeError(sizeBytes);

  const now = new Date();
  const contentHash = hashPlan(input.plan);

  if (!input.force) {
    for (const existing of snapshots.values()) {
      if (
        existing.planId === input.plan.id &&
        existing.contentHash === contentHash &&
        snapshotStatus(existing, now) === 'active'
      ) {
        return { snapshot: toSummary(existing), reused: true };
      }
    }
  }

  let token = randomToken(TOKEN_ALPHABET, 20);
  // 极端情况下碰撞则重新生成
  while (snapshots.has(token)) token = randomToken(TOKEN_ALPHABET, 20);

  // 深拷贝 + 冻结：即使调用方之后继续修改入参对象，已发出的快照也不会变化
  const frozenPlan = Object.freeze(structuredClone(input.plan));
  const frozenValidation = Object.freeze(structuredClone(input.validation));
  const snapshot: PlanSnapshot = {
    id: randomBytes(8).toString('hex'),
    token,
    manageToken: randomToken(MANAGE_ALPHABET, 24),
    planId: input.plan.id,
    planName: input.plan.name,
    plan: frozenPlan,
    validation: frozenValidation,
    contentHash,
    sizeBytes,
    createdAt: now.toISOString(),
    expiresAt: input.ttlSeconds ? new Date(now.getTime() + input.ttlSeconds * 1000).toISOString() : null,
    revokedAt: null
  };
  snapshots.set(token, snapshot);
  return { snapshot: toSummary(snapshot), reused: false };
}

/** 只读读取：返回的 plan/validation 是冻结对象，调用方不得改写 */
export function getSnapshotForReview(token: string): PlanSnapshot | undefined {
  return snapshots.get(token);
}

export function listSnapshotsForPlan(planId: string): SnapshotSummary[] {
  return [...snapshots.values()]
    .filter((snapshot) => snapshot.planId === planId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toSummary);
}

export type RevokeResult = 'revoked' | 'already-revoked' | 'not-found' | 'forbidden';

/** 撤销必须同时持有该快照的 manageToken，只读短链接本身不能用来撤销 */
export function revokeSnapshot(planId: string, token: string, manageToken: string | undefined): RevokeResult {
  const snapshot = snapshots.get(token);
  if (!snapshot || snapshot.planId !== planId) return 'not-found';
  if (!manageToken || snapshot.manageToken !== manageToken) return 'forbidden';
  if (snapshot.revokedAt) return 'already-revoked';
  snapshot.revokedAt = new Date().toISOString();
  return 'revoked';
}
