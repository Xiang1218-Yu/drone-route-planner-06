/** 只读审查链接统一使用 hash 形式：/ <origin>/#/r/<token>，无需服务端配合路由回退 */

export function buildReviewUrl(token: string): string {
  return `${window.location.origin}${window.location.pathname}#/r/${token}`;
}

/** 从当前地址中解析审查令牌；非法格式返回 null */
export function readReviewTokenFromHash(hash: string): string | null {
  const match = /^#\/r\/([A-Za-z0-9_-]{16})$/.exec(hash);
  return match ? match[1] : null;
}

/** 复制失败时返回 false，由调用方提供手动复制的兜底（只读场景不能弹编辑态提示） */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 非安全上下文或权限被拒绝时走兜底
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
