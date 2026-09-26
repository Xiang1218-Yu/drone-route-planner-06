export function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/** 相对时间，用于「过期于 / 创建于 3 小时前」这类提示 */
export function formatRelative(value: string | null): string {
  if (!value) return '—';
  const diffMs = new Date(value).getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const minutes = Math.round(absMs / 60000);
  const hours = Math.round(absMs / 3600000);
  const days = Math.round(absMs / 86400000);
  let text: string;
  if (minutes < 1) text = '刚刚';
  else if (minutes < 60) text = `${minutes} 分钟`;
  else if (hours < 24) text = `${hours} 小时`;
  else if (days < 60) text = `${days} 天`;
  else text = formatDateTime(value);
  return diffMs < 0 ? `${text}前` : `${text}后`;
}
