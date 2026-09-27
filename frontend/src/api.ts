import type { RoutePlan, ValidationResult } from './types';

export const apiRequest = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
    ...options
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    const error = new Error(body.message ?? '请求失败');
    (error as Error & { status?: number }).status = response.status;
    (error as Error & { code?: string }).code = body.code;
    throw error;
  }
  return response.status === 204 ? (undefined as T) : response.json();
};

/** 编辑侧方案接口（仅限编辑工作台使用，只读审查页不会加载本模块） */
export const planApi = {
  list: () => apiRequest<{ plans: RoutePlan[] }>('/api/plans'),
  save: (plan: RoutePlan) => apiRequest<{ plan: RoutePlan; validation: ValidationResult }>('/api/plans', {
    method: 'POST',
    body: JSON.stringify(plan)
  }),
  remove: (id: string) => apiRequest<void>(`/api/plans/${id}`, { method: 'DELETE' })
};
