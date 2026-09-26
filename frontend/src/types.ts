export type Point = { x: number; y: number };

export type NoFlyZone = {
  id: string;
  name: string;
  kind: 'rectangle' | 'polygon';
  points: Point[];
  color: string;
};

export type RoutePlan = {
  id?: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  canvas: { width: number; height: number };
  start: Point;
  end: Point;
  waypoints: Point[];
  noFlyZones: NoFlyZone[];
};

export type ValidationIssue = {
  type: 'out-of-bounds' | 'no-fly-zone';
  message: string;
  segmentIndex?: number;
  zoneId?: string;
};

export type ValidationResult = {
  valid: boolean;
  distance: number;
  issues: ValidationIssue[];
};

export type SnapshotStatus = 'active' | 'expired' | 'revoked';

/** 管理面看到的快照摘要（含撤销凭据，仅用于同一方案的管理操作） */
export type SnapshotSummary = {
  id: string;
  token: string;
  planId: string;
  planName: string;
  contentHash: string;
  sizeBytes: number;
  status: SnapshotStatus;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  manageToken: string;
};

/** 只读审查页的数据：没有任何可用于写操作的字段（无 manageToken） */
export type ReviewSnapshot = {
  token: string;
  createdAt: string;
  expiresAt: string | null;
  sourcePlan: { id: string; name: string };
  plan: RoutePlan;
  validation: ValidationResult;
  sizeBytes: number;
};

export type ReviewErrorReason = 'not-found' | 'expired' | 'revoked';
