const SUPPORTED_PLATFORMS = new Set(['discord', 'lark']);

export function normalizeBotPlatform(value, fallback = 'discord') {
  const normalized = String(value || '').trim().toLowerCase();
  if (SUPPORTED_PLATFORMS.has(normalized)) return normalized;
  const normalizedFallback = String(fallback || '').trim().toLowerCase();
  return SUPPORTED_PLATFORMS.has(normalizedFallback) ? normalizedFallback : 'discord';
}

export function normalizePlatformInstanceId(value, fallback = 'default') {
  const normalized = String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || fallback;
}

export function appendPlatformInstanceSuffix(filename, {
  platformId = 'discord',
  instanceId = 'default',
  preserveDiscordDefault = true,
} = {}) {
  const normalized = String(filename || '').trim();
  if (!normalized) return normalized;
  const platform = normalizeBotPlatform(platformId);
  const instance = normalizePlatformInstanceId(instanceId);
  if (preserveDiscordDefault && platform === 'discord' && instance === 'default') {
    return normalized;
  }
  const suffix = `${platform}.${instance}`;
  const lastDot = normalized.lastIndexOf('.');
  if (lastDot <= 0) return `${normalized}.${suffix}`;
  return `${normalized.slice(0, lastDot)}.${suffix}${normalized.slice(lastDot)}`;
}
