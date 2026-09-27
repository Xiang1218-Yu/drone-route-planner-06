import { ReviewError, type ReviewSnapshot } from './types';

/**
 * 公开只读审查接口。该模块刻意不依赖 api.ts / snapshotApi.ts，
 * 确保只读页面的代码包里不包含任何编辑 / 撤销请求。
 */
export async function fetchReview(token: string): Promise<ReviewSnapshot> {
  let response: Response;
  try {
    response = await fetch(`/api/review/${encodeURIComponent(token)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
  } catch {
    throw new ReviewError('unavailable', '无法连接审查服务，请稍后重试');
  }

  if (response.ok) {
    const body = (await response.json()) as { snapshot: ReviewSnapshot };
    return body.snapshot;
  }

  const body = await response.json().catch(() => ({}));
  const code: string | undefined = body.code;
  if (response.status === 410 && code === 'SNAPSHOT_REVOKED') {
    throw new ReviewError('revoked', body.message ?? '该审查链接已被撤销', { revokedAt: body.revokedAt });
  }
  if (response.status === 410 && code === 'SNAPSHOT_EXPIRED') {
    throw new ReviewError('expired', body.message ?? '该审查链接已过期', { expiresAt: body.expiresAt });
  }
  if (response.status === 404) {
    throw new ReviewError('not-found', body.message ?? '审查链接不存在');
  }
  throw new ReviewError('unavailable', body.message ?? '审查服务暂时不可用');
}
