function safeSnapshot(readSnapshot) {
  if (typeof readSnapshot !== 'function') return null;
  try {
    const value = readSnapshot();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value;
  } catch (error) {
    return {
      available: false,
      error: String(error?.message || error || 'unknown error'),
    };
  }
}

export function createPlatformHealthReader({
  platformId,
  getLifecycle = () => null,
  getMessageDelivery = () => null,
  now = Date.now,
} = {}) {
  const resolvedPlatformId = String(platformId || '').trim();
  if (!resolvedPlatformId) {
    throw new TypeError('Platform health reader requires platformId.');
  }

  return function getPlatformHealthSnapshot() {
    const lifecycle = getLifecycle();
    const messageDelivery = getMessageDelivery();
    const connection = safeSnapshot(lifecycle?.getHealthSnapshot?.bind(lifecycle));
    const delivery = safeSnapshot(messageDelivery?.getMetricsSnapshot?.bind(messageDelivery));
    if (!connection && !delivery) return null;
    return {
      platformId: resolvedPlatformId,
      observedAt: Number(now()) || Date.now(),
      connection,
      delivery,
    };
  };
}
