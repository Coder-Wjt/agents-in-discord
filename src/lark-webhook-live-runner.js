import fs from 'node:fs';
import path from 'node:path';

import { loadRuntimeEnv } from './env-loader.js';
import { inspectLarkRuntimeConfig } from './lark-runtime-config.js';
import {
  createLarkWebhookPreparedState,
  inspectLarkWebhookAcceptance,
  mergeLarkWebhookAcceptanceEvidence,
  readLarkWebhookAcceptanceState,
  resolveLarkProcessBootFingerprint,
  writeLarkWebhookAcceptanceState,
} from './lark-webhook-acceptance.js';
import {
  createLarkWebhookLiveError,
  discoverActiveLarkWebhookRuntime,
  formatLarkWebhookLiveSmokeError,
  inspectLarkWebhookHealthResponse,
  inspectPendingLarkWebhookAcceptance,
  resolveLarkWebhookLocalHealthUrl,
  resolveLarkWebhookPublicEndpoints,
} from './lark-webhook-live-smoke.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeHealth(url, {
  fetchFn = globalThis.fetch,
  timeoutMs = 5000,
} = {}) {
  if (!url || typeof fetchFn !== 'function') return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(100, Number(timeoutMs) || 5000));
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
    });
    const payload = await response.json();
    return inspectLarkWebhookHealthResponse(response, payload);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function createResult(state, { now = Date.now } = {}) {
  const inspection = inspectLarkWebhookAcceptance(state, { now });
  return {
    complete: inspection.complete,
    missing: [...inspection.missing],
    ...inspection.evidence,
  };
}

function markVerified(filePath, state, { fsImpl = fs, now = Date.now } = {}) {
  writeLarkWebhookAcceptanceState(filePath, {
    ...state,
    status: 'verified',
    verifiedAt: new Date(Number(now()) || Date.now()).toISOString(),
  }, { fsImpl });
}

export async function runLarkWebhookLiveSmoke({
  options,
  rootDir = process.cwd(),
  dataDir = path.join(rootDir, 'data'),
  env = process.env,
  fsImpl = fs,
  processRef = process,
  fetchFn = globalThis.fetch,
  now = Date.now,
  delayFn = delay,
} = {}) {
  const report = {
    ok: false,
    mode: options?.mode || 'preflight',
    activeRuntime: false,
    webhookTransport: false,
    credentialsReady: false,
    encryptionReady: false,
    publicEndpointConfigured: false,
    localHealthReady: false,
    publicHealthReady: false,
    prepared: false,
    result: null,
  };
  try {
    const runtimes = discoverActiveLarkWebhookRuntime({ dataDir, fsImpl, processRef });
    if (runtimes.length !== 1) {
      throw createLarkWebhookLiveError('lark_webhook_live_active_instance_unavailable');
    }
    const runtime = runtimes[0];
    report.activeRuntime = true;
    const runtimeEnv = { ...env };
    if (runtime.botProvider) runtimeEnv.BOT_PROVIDER = runtime.botProvider;
    else delete runtimeEnv.BOT_PROVIDER;
    loadRuntimeEnv({ rootDir, env: runtimeEnv });
    const inspection = inspectLarkRuntimeConfig({
      botProvider: runtime.botProvider,
      env: runtimeEnv,
    });
    const config = inspection.config;
    const publicEndpoints = resolveLarkWebhookPublicEndpoints(
      options?.publicUrl || runtimeEnv.LARK_WEBHOOK_PUBLIC_URL,
      config.webhook,
    );
    report.publicEndpointConfigured = Boolean(publicEndpoints);
    report.webhookTransport = config.transport === 'webhook';
    if (!report.webhookTransport) {
      throw createLarkWebhookLiveError('lark_webhook_live_transport_unavailable');
    }
    report.credentialsReady = Boolean(
      !inspection.errors.length
      && config.appId
      && config.appSecret
      && config.webhook.verificationToken
    );
    report.encryptionReady = Boolean(config.webhook.encryptKey);
    if (!report.credentialsReady || !report.encryptionReady) {
      throw createLarkWebhookLiveError('lark_webhook_live_config_incomplete');
    }

    if (!publicEndpoints) {
      throw createLarkWebhookLiveError('lark_webhook_live_public_url_invalid');
    }
    const localHealthUrl = resolveLarkWebhookLocalHealthUrl(config.webhook);
    [report.localHealthReady, report.publicHealthReady] = await Promise.all([
      probeHealth(localHealthUrl, { fetchFn }),
      probeHealth(publicEndpoints.healthUrl, { fetchFn }),
    ]);
    if (!report.localHealthReady) {
      throw createLarkWebhookLiveError('lark_webhook_live_local_health_unavailable');
    }
    if (!report.publicHealthReady) {
      throw createLarkWebhookLiveError('lark_webhook_live_public_health_unavailable');
    }

    let pending = inspectPendingLarkWebhookAcceptance(runtime.acceptanceFile, { fsImpl, now });
    if (report.mode === 'preflight') {
      if (pending.active) throw createLarkWebhookLiveError('lark_webhook_live_pending');
      report.ok = true;
      return report;
    }

    if (report.mode === 'prepare') {
      if (pending.active) throw createLarkWebhookLiveError('lark_webhook_live_pending');
      const bootFingerprint = resolveLarkProcessBootFingerprint(runtime.pid, { fsImpl });
      if (!bootFingerprint) {
        throw createLarkWebhookLiveError('lark_webhook_live_boot_unavailable');
      }
      writeLarkWebhookAcceptanceState(runtime.acceptanceFile, createLarkWebhookPreparedState({
        bootFingerprint,
        localHealthReady: true,
        publicHealthReady: true,
        now,
      }), { fsImpl });
      report.prepared = true;
      pending = inspectPendingLarkWebhookAcceptance(runtime.acceptanceFile, { fsImpl, now });
      if (!options?.waitMs) {
        report.ok = true;
        return report;
      }
    } else if (!pending.exists || (!pending.active && !pending.verified)) {
      throw createLarkWebhookLiveError('lark_webhook_live_not_prepared');
    }

    let proxyDownSeen = false;
    const deadline = (Number(now()) || Date.now()) + Math.max(0, Number(options?.waitMs) || 0);
    do {
      const currentState = readLarkWebhookAcceptanceState(runtime.acceptanceFile, { fsImpl });
      if (!currentState) throw createLarkWebhookLiveError('lark_webhook_live_not_prepared');
      const currentRuntimes = discoverActiveLarkWebhookRuntime({ dataDir, fsImpl, processRef });
      const currentRuntime = currentRuntimes.length === 1 ? currentRuntimes[0] : null;
      const [localReady, publicReady] = await Promise.all([
        probeHealth(localHealthUrl, { fetchFn }),
        probeHealth(publicEndpoints.healthUrl, { fetchFn }),
      ]);
      if (localReady && !publicReady) proxyDownSeen = true;
      const currentBootFingerprint = currentRuntime
        ? resolveLarkProcessBootFingerprint(currentRuntime.pid, { fsImpl })
        : '';
      const applicationRestartObserved = Boolean(
        localReady
        && currentBootFingerprint
        && currentBootFingerprint !== currentState.preparedBootFingerprint
      );
      const proxyRestartObserved = Boolean(proxyDownSeen && localReady && publicReady);
      if (applicationRestartObserved || proxyRestartObserved) {
        mergeLarkWebhookAcceptanceEvidence(runtime.acceptanceFile, {
          applicationRestartObserved,
          proxyRestartObserved,
        }, { fsImpl, now });
      }
      const refreshed = readLarkWebhookAcceptanceState(runtime.acceptanceFile, { fsImpl });
      report.localHealthReady = localReady;
      report.publicHealthReady = publicReady;
      report.result = createResult(refreshed, { now });
      if (report.result.complete && localReady && publicReady) {
        markVerified(runtime.acceptanceFile, refreshed, { fsImpl, now });
        report.ok = true;
        return report;
      }
      if (!options?.waitMs || (Number(now()) || Date.now()) >= deadline) break;
      await delayFn(Math.min(1000, Math.max(100, deadline - (Number(now()) || Date.now()))));
    } while (true);

    throw createLarkWebhookLiveError(
      options?.waitMs ? 'lark_webhook_live_timeout' : 'lark_webhook_live_not_observed',
    );
  } catch (error) {
    report.ok = false;
    report.error = formatLarkWebhookLiveSmokeError(error);
    return report;
  }
}
