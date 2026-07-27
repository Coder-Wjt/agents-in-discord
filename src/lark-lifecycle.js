function defaultSleep(ms, { signal } = {}) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (completed) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.('abort', onAbort);
      resolve(completed);
    };
    const timer = setTimeout(() => finish(true), ms);
    function onAbort() {
      clearTimeout(timer);
      finish(false);
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

function isFatalConnectError(error) {
  if (error?.fatal === true) return true;
  const code = String(error?.code || '').trim().toLowerCase();
  if (code === 'permission_denied' || code === 'format_error') return true;
  const text = [
    error?.message,
    error?.cause?.message,
    error?.cause?.response?.data?.msg,
  ].filter(Boolean).join(' ').toLowerCase();
  return text.includes('invalid app id')
    || text.includes('invalid app secret')
    || text.includes('app_id or app_secret is invalid')
    || (text.includes('failed to get tenant_access_token') && text.includes('invalid param'))
    || text.includes('permission denied');
}

export function createLarkLifecycle({
  createClient,
  bindClientHandlers,
  transport = 'sdk',
  cancelAllChannelWork = () => {},
  selfHealEnabled = true,
  restartDelayMs = 5000,
  maxLoginBackoffMs = 60000,
  logger = console,
  safeError = (error) => error?.message || String(error),
  processRef = process,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  sleep = defaultSleep,
  now = Date.now,
} = {}) {
  let client = null;
  let selfHealTimer = null;
  let selfHealInFlight = false;
  let lifecycleState = 'idle';
  let connectAttempts = 0;
  let connectRetries = 0;
  let selfHealRestarts = 0;
  let lastConnectAttemptAt = null;
  let lastConnectedAt = null;
  let nextRetryAt = null;
  let lastReason = null;
  let lastError = null;
  let lastErrorAt = null;
  let processHooksInstalled = false;
  let shuttingDown = false;
  let shutdownPromise = null;
  const shutdownController = new AbortController();

  function timestamp() {
    return Number(now()) || Date.now();
  }

  function recordError(error) {
    lastError = String(safeError(error) || 'unknown error');
    lastErrorAt = timestamp();
  }

  function createShutdownError() {
    const error = new Error('Lark lifecycle is shutting down.');
    error.code = 'lark_lifecycle_shutdown';
    return error;
  }

  async function connectWithRetry(channel, reason) {
    let attempt = 0;
    const baseDelay = Math.max(1000, Number(restartDelayMs) || 5000);
    const maxDelay = Math.max(baseDelay, Number(maxLoginBackoffMs) || 60000);
    while (true) {
      if (shuttingDown) throw createShutdownError();
      attempt += 1;
      connectAttempts += 1;
      lastConnectAttemptAt = timestamp();
      lastReason = reason;
      lifecycleState = attempt > 1 || String(reason || '').startsWith('self_heal:')
        ? 'reconnecting'
        : 'connecting';
      try {
        await channel.connect();
        lifecycleState = 'connected';
        lastConnectedAt = timestamp();
        nextRetryAt = null;
        logger.log(`✅ Lark connected${attempt > 1 ? ` after ${attempt} attempts` : ''} (reason=${reason}).`);
        return channel;
      } catch (error) {
        if (shuttingDown) throw createShutdownError();
        recordError(error);
        if (!selfHealEnabled || isFatalConnectError(error)) {
          lifecycleState = 'failed';
          nextRetryAt = null;
          throw error;
        }
        connectRetries += 1;
        const delay = Math.min(maxDelay, baseDelay * (2 ** Math.min(10, attempt - 1)));
        lifecycleState = 'reconnecting';
        nextRetryAt = timestamp() + delay;
        logger.error(`Lark connect failed (reason=${reason}, attempt=${attempt}): ${safeError(error)}; retrying in ${delay}ms`);
        const completed = await sleep(delay, { signal: shutdownController.signal });
        if (completed === false || shuttingDown) throw createShutdownError();
      }
    }
  }

  async function bootClient(reason = 'startup') {
    if (shuttingDown) throw createShutdownError();
    if (!client) {
      client = createClient();
      bindClientHandlers(client, lifecycleApi);
    }
    return connectWithRetry(client, reason);
  }

  async function restartClient(reason = 'self_heal') {
    if (shuttingDown || selfHealInFlight) return client;
    selfHealInFlight = true;
    selfHealRestarts += 1;
    lifecycleState = 'reconnecting';
    try {
      await client?.disconnect?.().catch?.(() => {});
      client = createClient();
      bindClientHandlers(client, lifecycleApi);
      return await connectWithRetry(client, `self_heal:${reason}`);
    } finally {
      selfHealInFlight = false;
    }
  }

  function scheduleSelfHeal(reason, error = null) {
    if (!selfHealEnabled || shuttingDown || selfHealTimer || selfHealInFlight) return;
    if (error) logger.error(`♻️ Lark self-heal triggered by ${reason}: ${safeError(error)}`);
    if (error) recordError(error);
    const delay = Math.max(1000, Number(restartDelayMs) || 5000);
    selfHealTimer = setTimeoutFn(() => {
      selfHealTimer = null;
      restartClient(reason).catch((restartError) => {
        logger.error('Lark self-heal restart failed:', restartError);
        scheduleSelfHeal('restart_failed', restartError);
      });
    }, delay);
    selfHealTimer?.unref?.();
  }

  async function shutdownClient(reason = 'shutdown') {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    lastReason = reason;
    nextRetryAt = null;
    shutdownController.abort();
    if (selfHealTimer) {
      clearTimeoutFn(selfHealTimer);
      selfHealTimer = null;
    }
    try {
      cancelAllChannelWork();
    } catch (error) {
      recordError(error);
      logger.error(`Lark shutdown could not cancel active work: ${safeError(error)}`);
    }
    shutdownPromise = (async () => {
      try {
        await client?.disconnect?.();
      } catch (error) {
        recordError(error);
        logger.error(`Lark disconnect failed during ${reason}: ${safeError(error)}`);
      } finally {
        lifecycleState = 'idle';
        selfHealInFlight = false;
      }
      return client;
    })();
    return shutdownPromise;
  }

  function getHealthSnapshot() {
    let channelStatus = null;
    let statusError = null;
    try {
      channelStatus = client?.getConnectionStatus?.() || null;
    } catch (error) {
      statusError = String(safeError(error) || 'connection status unavailable');
    }
    const channelState = String(channelStatus?.state || '').trim().toLowerCase();
    const state = ['idle', 'connecting', 'connected', 'reconnecting', 'failed'].includes(channelState)
      ? channelState
      : lifecycleState;
    return {
      available: true,
      transport: String(transport || 'sdk').trim().toLowerCase() || 'sdk',
      state,
      connected: state === 'connected',
      connectAttempts,
      connectRetries,
      reconnectAttempts: Math.max(0, Number(channelStatus?.reconnectAttempts) || 0),
      totalReconnects: Number.isFinite(Number(channelStatus?.totalReconnects))
        ? Math.max(0, Number(channelStatus.totalReconnects))
        : null,
      selfHealRestarts,
      selfHealScheduled: Boolean(selfHealTimer),
      selfHealInFlight,
      lastReason,
      lastConnectAt: Number(channelStatus?.lastConnectTime) || lastConnectAttemptAt,
      lastConnectedAt,
      nextReconnectAt: Number(channelStatus?.nextConnectTime) || nextRetryAt,
      lastError: lastError ? { at: lastErrorAt, error: lastError } : null,
      statusError,
      ...(Number.isFinite(Number(channelStatus?.consumerCount)) ? {
        consumerCount: Number(channelStatus.consumerCount),
      } : {}),
      ...(Number.isFinite(Number(channelStatus?.expectedConsumerCount)) ? {
        expectedConsumerCount: Number(channelStatus.expectedConsumerCount),
      } : {}),
    };
  }

  function setupProcessSelfHeal() {
    if (processHooksInstalled) return;
    processHooksInstalled = true;
    if (selfHealEnabled) {
      processRef.on('unhandledRejection', (reason) => {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        logger.error('Unhandled rejection:', error);
        scheduleSelfHeal('unhandled_rejection', error);
      });
      processRef.on('uncaughtException', (error) => {
        logger.error('Uncaught exception:', error);
        scheduleSelfHeal('uncaught_exception', error);
      });
    }
    processRef.once('SIGTERM', () => {
      void shutdownClient('SIGTERM');
    });
    processRef.once('SIGINT', () => {
      void shutdownClient('SIGINT');
    });
  }

  const lifecycleApi = {
    bootClient,
    loginClientWithRetry: connectWithRetry,
    scheduleSelfHeal,
    restartClient,
    shutdownClient,
    setupProcessSelfHeal,
    getClient: () => client,
    getHealthSnapshot,
  };
  return lifecycleApi;
}
