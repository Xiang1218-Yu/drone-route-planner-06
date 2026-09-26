import type { ReviewErrorReason, ReviewSnapshot, RoutePlan, SnapshotSummary, ValidationResult } from './types';

const api = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
    ...options
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw Object.assign(new Error(body.message ?? '请求失败'), { status: response.status, body });
  }
  return response.status === 204 ? (undefined as T) : response.json();
};

export const planApi = {
  list: () => api<{ plans: RoutePlan[] }>('/api/plans'),
  save: (plan: RoutePlan) => api<{ plan: RoutePlan; validation: ValidationResult }>('/api/plans', {
    method: 'POST',
    body: JSON.stringify(plan)
  }),
  remove: (id: string) => api<void>(`/api/plans/${id}`, { method: 'DELETE' })
};

export const snapshotApi = {
  create: (planId: string, payload: { ttlSeconds?: number | null; force?: boolean }) =>
    api<{ snapshot: SnapshotSummary; reused: boolean }>(`/api/plans/${planId}/snapshots`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  list: (planId: string) => api<{ snapshots: SnapshotSummary[] }>(`/api/plans/${planId}/snapshots`),
  revoke: (planId: string, token: string, manageToken: string) =>
    api<void>(`/api/plans/${planId}/snapshots/${token}`, {
      method: 'DELETE',
      headers: { 'X-Manage-Token': manageToken }
    }),
  /** 只读页唯一调用的接口；404/410 时抛出带 reason 的错误 */
  review: async (token: string): Promise<ReviewSnapshot> => {
    try {
      return await api<ReviewSnapshot>(`/api/review/${token}`);
    } catch (error) {
      const reason = (error as { body?: { reason?: ReviewErrorReason } }).body?.reason;
      throw Object.assign(error instanceof Error ? error : new Error('请求失败'), {
        status: (error as { status?: number }).status,
        reason: reason ?? 'not-found'
      });
    }
  }
};

/** 审查短链接（以源站为根，便于复制给他人） */
export function reviewUrl(token: string): string {
  return `${window.location.origin}/r/${token}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 非安全上下文（http 局域网分享）时降级到临时输入框
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(input);
    return ok;
  }
}
