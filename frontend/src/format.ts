export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function relativeExpiry(expiresAt: string | null): string {
  if (!expiresAt) return '长期有效';
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(diffMs)) return formatDateTime(expiresAt);
  if (diffMs <= 0) return '已过期';
  const days = Math.floor(diffMs / 86_400_000);
  const hours = Math.floor((diffMs % 86_400_000) / 3_600_000);
  if (days >= 1) return `${days} 天 ${hours} 小时后过期`;
  if (hours >= 1) return `${hours} 小时后过期`;
  return `${Math.max(1, Math.floor(diffMs / 60_000))} 分钟后过期`;
}
