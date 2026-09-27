import { apiRequest } from './api';
import type { SnapshotMeta } from './types';

/** 编辑侧快照管理接口；只读审查页不加载本模块，避免把撤销能力暴露给复核人 */
export const snapshotApi = {
  create: (planId: string, ttlHours: number, idempotencyKey?: string) =>
    apiRequest<{ snapshot: SnapshotMeta; reused: boolean }>(`/api/plans/${planId}/snapshots`, {
      method: 'POST',
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      body: JSON.stringify({ ttlHours })
    }),
  list: (planId: string) =>
    apiRequest<{ snapshots: SnapshotMeta[] }>(`/api/plans/${planId}/snapshots`),
  revoke: (snapshotId: string) =>
    apiRequest<void>(`/api/snapshots/${snapshotId}`, { method: 'DELETE' })
};
