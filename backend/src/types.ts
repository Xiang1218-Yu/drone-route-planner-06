export type Point = {
  x: number;
  y: number;
};

export type NoFlyZone = {
  id: string;
  name: string;
  kind: 'rectangle' | 'polygon';
  points: Point[];
  color?: string;
};

export type RoutePlan = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  canvas: { width: number; height: number };
  start: Point;
  end: Point;
  waypoints: Point[];
  noFlyZones: NoFlyZone[];
};

export type RouteIssue = {
  type: 'out-of-bounds' | 'no-fly-zone';
  message: string;
  segmentIndex?: number;
  zoneId?: string;
};

export type RouteValidation = {
  valid: boolean;
  distance: number;
  issues: RouteIssue[];
};

export type SnapshotStatus = 'active' | 'revoked' | 'expired';

/**
 * 只读审查快照：创建时对航线方案做深拷贝并冻结，
 * 同时保存当时的校验结果；之后对原方案的任何编辑都不会影响该记录。
 */
export type ReviewSnapshotRecord = {
  id: string;
  /** 公开短令牌，出现在审查链接中，仅用于只读访问 */
  token: string;
  /** 快照来源方案 id；源方案被删除后快照仍然可读 */
  planId: string;
  /** 创建快照时源方案的版本时间，便于核对「快照基于哪一版」 */
  sourcePlanUpdatedAt?: string;
  /** 创建时是否携带了幂等键（用于重复生成去重） */
  idempotencyKey?: string;
  createdAt: string;
  /** null 表示长期有效 */
  expiresAt: string | null;
  revokedAt: string | null;
  /** 创建时的不可变方案内容（深拷贝 + 冻结） */
  plan: RoutePlan;
  /** 创建时服务端计算的校验结果（冻结） */
  validation: RouteValidation;
};
