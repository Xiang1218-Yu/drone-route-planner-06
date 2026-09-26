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

/** 审查快照的可达状态：expired 在读取时按 expiresAt 实时计算 */
export type SnapshotStatus = 'active' | 'expired' | 'revoked';

/**
 * 不可变的方案审查快照。
 * plan / validation 在创建时深拷贝并冻结，之后原方案的任何改动都不会影响这里。
 * token 是对外的短令牌；manageToken 只在创建响应与方案管理列表中返回，
 * 只读接口 /api/review/:token 绝不会带出它。
 */
export type PlanSnapshot = {
  id: string;
  token: string;
  manageToken: string;
  planId: string;
  planName: string;
  plan: RoutePlan;
  validation: RouteValidation;
  contentHash: string;
  sizeBytes: number;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
};
