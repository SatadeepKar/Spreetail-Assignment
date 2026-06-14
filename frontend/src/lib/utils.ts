export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function splitTypeLabel(type: string): string {
  const map: Record<string, string> = {
    equal: 'Equal',
    exact: 'Exact',
    percentage: 'Percentage',
    ratio: 'Ratio',
    settlement: 'Settlement',
    refund: 'Refund',
  };
  return map[type] ?? type;
}

export function splitTypeBadgeClass(type: string): string {
  const map: Record<string, string> = {
    equal: 'badge-blue',
    exact: 'badge-purple',
    percentage: 'badge-yellow',
    ratio: 'badge-blue',
    settlement: 'badge-green',
    refund: 'badge-red',
  };
  return map[type] ?? 'badge-gray';
}

export function anomalySeverityClass(severity: string): string {
  const map: Record<string, string> = {
    error: 'severity-error',
    warning: 'severity-warning',
    info: 'severity-info',
  };
  return map[severity] ?? '';
}

export function anomalyBadgeClass(severity: string): string {
  const map: Record<string, string> = {
    error: 'badge-red',
    warning: 'badge-yellow',
    info: 'badge-blue',
  };
  return map[severity] ?? 'badge-gray';
}
