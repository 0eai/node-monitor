export function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

export function formatMiB(mib) {
  if (mib === null || mib === undefined) return '—';
  if (mib >= 1024) return `${(mib / 1024).toFixed(1)} GiB`;
  return `${mib} MiB`;
}

export function formatMiBShort(mib) {
  if (!mib) return '0';
  if (mib >= 1024) return `${(mib / 1024).toFixed(1)}G`;
  return `${mib}M`;
}

export function getThermalColor(temp, critical = 85, warning = 75) {
  if (temp === null || temp === undefined) return 'text-slate-500';
  if (temp >= critical) return 'text-danger';
  if (temp >= warning) return 'text-warn';
  if (temp >= 60) return 'text-orange-400';
  return 'text-gpu-normal';
}

export function getThermalBg(temp, critical = 85, warning = 75) {
  if (temp === null || temp === undefined) return 'bg-slate-700';
  if (temp >= critical) return 'bg-danger';
  if (temp >= warning) return 'bg-warn';
  if (temp >= 60) return 'bg-orange-400';
  return 'bg-gpu-normal';
}

export function getUsageColor(pct) {
  if (pct >= 95) return 'bg-danger';
  if (pct >= 85) return 'bg-warn';
  if (pct >= 70) return 'bg-orange-400';
  return 'bg-accent';
}

export function getUsageTextColor(pct) {
  if (pct >= 95) return 'text-danger';
  if (pct >= 85) return 'text-warn';
  if (pct >= 70) return 'text-orange-400';
  return 'text-accent';
}

export function relativeTime(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 10000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

export function truncateCmd(cmd, maxLen = 50) {
  if (!cmd) return '—';
  const parts = cmd.split('/');
  const short = parts[parts.length - 1] || cmd;
  return short.length > maxLen ? short.slice(0, maxLen) + '…' : short;
}

export function clsx(...args) {
  return args.filter(Boolean).join(' ');
}
