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

// ---------- 只读审查快照 ----------

export type SnapshotStatus = 'active' | 'revoked' | 'expired';

/** 编辑侧可见的快照元信息 */
export type SnapshotMeta = {
  id: string;
  token: string;
  planId: string;
  planName: string;
  sourcePlanUpdatedAt?: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  status: SnapshotStatus;
};

/** 只读审查页加载到的完整快照 */
export type ReviewSnapshot = {
  id: string;
  token: string;
  createdAt: string;
  expiresAt: string | null;
  status: SnapshotStatus;
  plan: RoutePlan;
  validation: ValidationResult;
  source: {
    planId: string;
    planName: string;
    sourcePlanUpdatedAt?: string;
    exists: boolean;
    updatedAt?: string;
  };
};

export type ReviewErrorKind = 'not-found' | 'revoked' | 'expired' | 'unavailable';

export class ReviewError extends Error {
  constructor(
    public readonly kind: ReviewErrorKind,
    message: string,
    public readonly detail?: { revokedAt?: string | null; expiresAt?: string | null }
  ) {
    super(message);
    this.name = 'ReviewError';
  }
}
