import fs from 'node:fs';

import { discoverActiveLarkRuntime } from './lark-denial-live-smoke.js';
import {
  inspectLarkWebhookAcceptance,
  readLarkWebhookAcceptanceState,
  resolveLarkWebhookAcceptanceStateFile,
} from './lark-webhook-acceptance.js';

const MAX_WAIT_MS = 20 * 60_000;

const SAFE_ERROR_MESSAGES = Object.freeze({
  lark_webhook_live_active_instance_unavailable: 'Exactly one active Lark runtime is required.',
  lark_webhook_live_transport_unavailable: 'The active Lark runtime must use webhook transport.',
  lark_webhook_live_config_incomplete: 'Production webhook credentials, verification, and encryption must be configured.',
  lark_webhook_live_public_url_invalid: 'A matching public HTTPS webhook callback URL is required.',
  lark_webhook_live_local_health_unavailable: 'The local production webhook health endpoint is unavailable.',
  lark_webhook_live_public_health_unavailable: 'The public production webhook health endpoint is unavailable.',
  lark_webhook_live_pending: 'An unexpired webhook acceptance is already pending.',
  lark_webhook_live_boot_unavailable: 'The active runtime boot fingerprint could not be verified.',
  lark_webhook_live_not_prepared: 'No prepared webhook acceptance is available.',
  lark_webhook_live_not_observed: 'Required real webhook evidence has not all been observed.',
  lark_webhook_live_timeout: 'Timed out before all real webhook and restart evidence was observed.',
});

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizePath(value) {
  const path = normalizeText(value) || '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function parseWaitMs(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_WAIT_MS) {
    throw new TypeError(`--wait-ms must be an integer from 0 to ${MAX_WAIT_MS}.`);
  }
  return parsed;
}

export function parseLarkWebhookLiveSmokeArgs(argv = []) {
  const options = {
    mode: 'preflight',
    help: false,
    json: false,
    publicUrl: null,
    waitMs: 0,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--prepare') {
      if (options.mode !== 'preflight') throw new TypeError('--prepare and --verify are mutually exclusive.');
      options.mode = 'prepare';
    } else if (arg === '--verify') {
      if (options.mode !== 'preflight') throw new TypeError('--prepare and --verify are mutually exclusive.');
      options.mode = 'verify';
    } else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--public-url') {
      index += 1;
      if (argv[index] === undefined) throw new TypeError('--public-url requires a value.');
      options.publicUrl = normalizeText(argv[index]);
    } else if (arg.startsWith('--public-url=')) {
      options.publicUrl = normalizeText(arg.slice('--public-url='.length));
    } else if (arg === '--wait-ms') {
      index += 1;
      if (argv[index] === undefined) throw new TypeError('--wait-ms requires a value.');
      options.waitMs = parseWaitMs(argv[index]);
    } else if (arg.startsWith('--wait-ms=')) {
      options.waitMs = parseWaitMs(arg.slice('--wait-ms='.length));
    } else throw new TypeError(`Unknown option: ${arg}`);
  }
  if (options.waitMs && options.mode === 'preflight') {
    throw new TypeError('--wait-ms requires --prepare or --verify.');
  }
  return options;
}

export function resolveLarkWebhookPublicEndpoints(value, webhookConfig = {}) {
  const raw = normalizeText(value);
  if (!raw) return null;
  try {
    const callback = new URL(raw);
    if (callback.protocol !== 'https:'
      || callback.username
      || callback.password
      || callback.search
      || callback.hash
      || normalizePath(callback.pathname) !== normalizePath(webhookConfig.path)) {
      return null;
    }
    const health = new URL(callback.origin);
    health.pathname = normalizePath(webhookConfig.healthPath);
    return {
      callbackUrl: callback.toString(),
      healthUrl: health.toString(),
    };
  } catch {
    return null;
  }
}

export function resolveLarkWebhookLocalHealthUrl(webhookConfig = {}) {
  const rawHost = normalizeText(webhookConfig.host).replace(/^\[|\]$/g, '');
  const host = ['0.0.0.0', '::', ''].includes(rawHost) ? '127.0.0.1' : rawHost;
  const formattedHost = host.includes(':') ? `[${host}]` : host;
  return `http://${formattedHost}:${Number(webhookConfig.port)}${normalizePath(webhookConfig.healthPath)}`;
}

export function inspectLarkWebhookHealthResponse(response, payload) {
  return Boolean(
    response?.ok
    && response?.status === 200
    && payload?.ok === true
    && payload?.platform === 'lark'
    && payload?.transport === 'webhook'
    && payload?.state === 'connected'
  );
}

export function discoverActiveLarkWebhookRuntime({
  dataDir,
  fsImpl = fs,
  processRef = process,
} = {}) {
  return discoverActiveLarkRuntime({ dataDir, fsImpl, processRef }).map((runtime) => ({
    ...runtime,
    acceptanceFile: resolveLarkWebhookAcceptanceStateFile({
      dataDir,
      instanceId: runtime.instanceId,
      botProvider: runtime.botProvider,
    }),
  }));
}

export function inspectPendingLarkWebhookAcceptance(filePath, {
  fsImpl = fs,
  now = Date.now,
} = {}) {
  const state = readLarkWebhookAcceptanceState(filePath, { fsImpl });
  const inspection = inspectLarkWebhookAcceptance(state, { now });
  return {
    ...inspection,
    pending: inspection.active && !inspection.complete,
    state,
  };
}

export function formatLarkWebhookLiveSmokeError(error) {
  return SAFE_ERROR_MESSAGES[normalizeText(error?.code)] || 'Lark live webhook acceptance failed.';
}

export function createLarkWebhookLiveError(code) {
  const error = new Error(SAFE_ERROR_MESSAGES[code] || 'Lark live webhook acceptance failed.');
  error.code = code;
  return error;
}
