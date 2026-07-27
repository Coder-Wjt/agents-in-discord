import crypto from 'node:crypto';
import dns from 'node:dns';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { Agent } from 'undici';

import {
  EventDispatcher,
  LoggerLevel,
  generateChallenge,
} from '@larksuiteoapi/node-sdk';

import { installLarkWebhookServer } from './lark-webhook-channel.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_MS = 1000;

const SAFE_ERROR_MESSAGES = Object.freeze({
  lark_webhook_edge_cloudflared_exited: 'The temporary TLS tunnel exited before becoming ready.',
  lark_webhook_edge_cloudflared_timeout: 'The temporary TLS tunnel did not become ready in time.',
  lark_webhook_edge_health_timeout: 'The public webhook health endpoint did not become ready in time.',
  lark_webhook_edge_invalid_tunnel_url: 'The temporary tunnel returned an unexpected public endpoint.',
  lark_webhook_edge_dns_unavailable: 'The temporary tunnel hostname could not be resolved.',
  lark_webhook_edge_assertion_failed: 'The public webhook edge smoke returned an unexpected response.',
});

function normalizePositiveInteger(value, fallback, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return parsed || fallback;
}

function createSmokeError(code) {
  const error = new Error(SAFE_ERROR_MESSAGES[code] || 'Lark webhook edge smoke failed.');
  error.code = code;
  return error;
}

function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

function assertResponse(response, predicate) {
  if (predicate(response)) return response;
  throw createSmokeError('lark_webhook_edge_assertion_failed');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(url, {
  method = 'GET',
  body,
  headers = {},
  timeoutMs = 15_000,
  fetchFn = globalThis.fetch,
  dispatcher,
} = {}) {
  if (typeof fetchFn !== 'function') throw new TypeError('Lark webhook edge smoke requires fetch().');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchFn(url, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { statusCode: response.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveTunnelAddress(hostname, {
  fetchFn = globalThis.fetch,
  timeoutMs = 60_000,
  pollMs = DEFAULT_POLL_MS,
} = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const resolved = await dns.promises.lookup(hostname, { family: 4 });
      if (net.isIP(resolved?.address) === 4) {
        return { address: resolved.address, mode: 'system' };
      }
    } catch {
      // Newly-created quick-tunnel records may not be visible to the host resolver yet.
    }

    try {
      const query = new URL('https://cloudflare-dns.com/dns-query');
      query.searchParams.set('name', hostname);
      query.searchParams.set('type', 'A');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      timer.unref?.();
      let response;
      try {
        response = await fetchFn(query, {
          headers: { accept: 'application/dns-json' },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (response.ok) {
        const payload = await response.json();
        const address = (payload?.Answer || [])
          .find((answer) => Number(answer?.type) === 1 && net.isIP(String(answer?.data || '')) === 4)
          ?.data;
        if (address) return { address, mode: 'doh-fallback' };
      }
    } catch {
      // Retry boundedly while the quick-tunnel DNS record propagates.
    }
    await delay(pollMs);
  }
  throw createSmokeError('lark_webhook_edge_dns_unavailable');
}

function createPinnedTlsDispatcher(hostname, address) {
  return new Agent({
    connect: {
      lookup(candidate, options, callback) {
        if (candidate !== hostname) {
          dns.lookup(candidate, options, callback);
          return;
        }
        if (options?.all) {
          callback(null, [{ address, family: 4 }]);
          return;
        }
        callback(null, address, 4);
      },
    },
  });
}

async function waitForResponse(request, predicate, {
  timeoutMs,
  pollMs,
  timeoutCode,
} = {}) {
  const startedAt = Date.now();
  let attempts = 0;
  while (Date.now() - startedAt < timeoutMs) {
    attempts += 1;
    try {
      const response = await request();
      if (predicate(response)) {
        return {
          response,
          attempts,
          elapsedMs: Math.max(0, Date.now() - startedAt),
        };
      }
    } catch {
      // The public tunnel may exist before its edge route or local origin is ready.
    }
    await delay(pollMs);
  }
  throw createSmokeError(timeoutCode);
}

function stopChildProcess(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null || child.signalCode) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      child.kill('SIGKILL');
      finish();
    }, timeoutMs);
    forceTimer.unref?.();
    child.once('exit', finish);
    child.kill('SIGTERM');
  });
}

async function reserveLocalPort(host = '127.0.0.1') {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw createSmokeError('lark_webhook_edge_assertion_failed');
  return port;
}

async function openQuickTunnel({
  tunnelBin,
  originUrl,
  timeoutMs,
  spawnFn = spawn,
} = {}) {
  const child = spawnFn(tunnelBin, [
    'tunnel',
    '--url', originUrl,
    '--no-autoupdate',
    '--loglevel', 'info',
    '--metrics', '127.0.0.1:0',
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let buffer = '';
  let settled = false;
  let discoveredUrl = null;
  let registered = false;

  try {
    const publicUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(createSmokeError('lark_webhook_edge_cloudflared_timeout'));
      }, timeoutMs);
      timer.unref?.();

      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };

      child.stderr?.on('data', (chunk) => {
        buffer = `${buffer}${stripAnsi(chunk)}`.slice(-32_768);
        discoveredUrl ||= extractCloudflaredQuickTunnelUrl(buffer);
        registered ||= buffer.includes('Registered tunnel connection');
        if (discoveredUrl && registered) finish(resolve, discoveredUrl);
      });
      child.once('error', () => finish(reject, createSmokeError('lark_webhook_edge_cloudflared_exited')));
      child.once('exit', () => finish(reject, createSmokeError('lark_webhook_edge_cloudflared_exited')));
    });
    return {
      publicUrl,
      stop: () => stopChildProcess(child),
    };
  } catch (error) {
    await stopChildProcess(child);
    throw error;
  }
}

function createSignedRequest(payload, { encryptKey, now = Date.now } = {}) {
  const body = { encrypt: encryptLarkWebhookPayload(payload, encryptKey) };
  const timestamp = String(Math.floor((Number(now()) || Date.now()) / 1000));
  const nonce = crypto.randomBytes(12).toString('hex');
  return {
    body,
    headers: {
      'x-lark-request-timestamp': timestamp,
      'x-lark-request-nonce': nonce,
      'x-lark-signature': signLarkWebhookBody(body, encryptKey, timestamp, nonce),
    },
  };
}

export function parseLarkWebhookEdgeSmokeArgs(argv = []) {
  const options = {
    apply: false,
    help: false,
    json: false,
    tunnelBin: 'cloudflared',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    pollMs: DEFAULT_POLL_MS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--tunnel-bin') {
      index += 1;
      if (!argv[index]) throw new TypeError('--tunnel-bin requires a value.');
      options.tunnelBin = argv[index];
    } else if (arg.startsWith('--tunnel-bin=')) {
      options.tunnelBin = arg.slice('--tunnel-bin='.length);
    } else if (arg === '--timeout-ms') {
      index += 1;
      if (!argv[index]) throw new TypeError('--timeout-ms requires a value.');
      options.timeoutMs = normalizePositiveInteger(argv[index], options.timeoutMs, '--timeout-ms');
    } else if (arg.startsWith('--timeout-ms=')) {
      options.timeoutMs = normalizePositiveInteger(arg.slice('--timeout-ms='.length), options.timeoutMs, '--timeout-ms');
    } else if (arg === '--poll-ms') {
      index += 1;
      if (!argv[index]) throw new TypeError('--poll-ms requires a value.');
      options.pollMs = normalizePositiveInteger(argv[index], options.pollMs, '--poll-ms');
    } else if (arg.startsWith('--poll-ms=')) {
      options.pollMs = normalizePositiveInteger(arg.slice('--poll-ms='.length), options.pollMs, '--poll-ms');
    } else {
      throw new TypeError(`Unknown option: ${arg}`);
    }
  }
  options.tunnelBin = String(options.tunnelBin || '').trim();
  if (!options.tunnelBin) throw new TypeError('--tunnel-bin requires a value.');
  return options;
}

export function extractCloudflaredQuickTunnelUrl(value) {
  const match = stripAnsi(value).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i);
  return match?.[0] || null;
}

export function encryptLarkWebhookPayload(payload, encryptKey, {
  iv = crypto.randomBytes(16),
} = {}) {
  const key = crypto.createHash('sha256').update(String(encryptKey || '')).digest();
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, encrypted]).toString('base64');
}

export function signLarkWebhookBody(body, encryptKey, timestamp, nonce) {
  return crypto.createHash('sha256')
    .update(`${timestamp}${nonce}${encryptKey}${JSON.stringify(body)}`)
    .digest('hex');
}

export function formatLarkWebhookEdgeSmokeError(error) {
  return SAFE_ERROR_MESSAGES[String(error?.code || '').trim()] || 'Lark webhook edge smoke failed.';
}

export async function runLarkWebhookEdgeSmoke({
  tunnelBin = 'cloudflared',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
  fetchFn = globalThis.fetch,
  spawnFn = spawn,
  now = Date.now,
} = {}) {
  const timeout = normalizePositiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs');
  const poll = normalizePositiveInteger(pollMs, DEFAULT_POLL_MS, 'pollMs');
  const verificationToken = crypto.randomBytes(24).toString('base64url');
  const encryptKey = crypto.randomBytes(24).toString('base64url');
  const challengeValue = crypto.randomBytes(12).toString('hex');
  const port = await reserveLocalPort();
  const dispatcher = new EventDispatcher({
    verificationToken,
    encryptKey,
    loggerLevel: LoggerLevel.fatal,
  });
  dispatcher.register({
    'edge.smoke': async (event) => ({ ok: true, sequence: event.sequence }),
  });
  const channel = installLarkWebhookServer({
    dispatcher,
    async connect() {},
    async disconnect() {},
  }, {
    host: '127.0.0.1',
    port,
    path: '/lark/events',
    healthPath: '/healthz',
    generateChallenge,
    logger: { log() {}, warn() {} },
  });
  let tunnel = null;
  let edgeDispatcher = null;
  let dnsMode = null;
  const results = [];

  const publicRequest = (path, options = {}) => requestJson(`${tunnel.publicUrl}${path}`, {
    ...options,
    fetchFn,
    dispatcher: edgeDispatcher,
  });

  try {
    await channel.connect();
    tunnel = await openQuickTunnel({
      tunnelBin,
      originUrl: `http://127.0.0.1:${port}`,
      timeoutMs: Math.min(timeout, 60_000),
      spawnFn,
    });
    const parsedUrl = new URL(tunnel.publicUrl);
    if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname.endsWith('.trycloudflare.com')) {
      throw createSmokeError('lark_webhook_edge_invalid_tunnel_url');
    }
    const resolvedTunnel = await resolveTunnelAddress(parsedUrl.hostname, {
      fetchFn,
      timeoutMs: Math.min(timeout, 60_000),
      pollMs: poll,
    });
    dnsMode = resolvedTunnel.mode;
    edgeDispatcher = createPinnedTlsDispatcher(parsedUrl.hostname, resolvedTunnel.address);

    const health = await waitForResponse(
      () => publicRequest('/healthz'),
      (response) => response.statusCode === 200 && response.body?.ok === true,
      { timeoutMs: timeout, pollMs: poll, timeoutCode: 'lark_webhook_edge_health_timeout' },
    );
    results.push({ id: 'public_tls_health', ok: true, attempts: health.attempts, elapsedMs: health.elapsedMs });

    const challenge = createSignedRequest({
      type: 'url_verification',
      token: verificationToken,
      challenge: challengeValue,
    }, { encryptKey, now });
    const challengeResponse = await publicRequest('/lark/events', {
      method: 'POST',
      body: challenge.body,
      headers: challenge.headers,
    });
    assertResponse(challengeResponse, (response) => (
      response.statusCode === 200 && response.body?.challenge === challengeValue
    ));
    results.push({ id: 'signed_encrypted_challenge', ok: true });

    const firstEvent = createSignedRequest({
      schema: '2.0',
      header: { event_type: 'edge.smoke', token: verificationToken },
      event: { sequence: 1 },
    }, { encryptKey, now });
    const firstEventResponse = await publicRequest('/lark/events', {
      method: 'POST',
      body: firstEvent.body,
      headers: firstEvent.headers,
    });
    assertResponse(firstEventResponse, (response) => (
      response.statusCode === 200 && response.body?.ok === true && response.body?.sequence === 1
    ));
    results.push({ id: 'signed_encrypted_event', ok: true });

    const rejectedResponse = await publicRequest('/lark/events', {
      method: 'POST',
      body: firstEvent.body,
      headers: { ...firstEvent.headers, 'x-lark-signature': 'invalid-signature' },
    });
    assertResponse(rejectedResponse, (response) => (
      response.statusCode === 400
      && response.body?.ok === false
      && response.body?.error === 'invalid webhook request'
    ));
    results.push({ id: 'invalid_signature_rejected', ok: true });

    await channel.disconnect();
    await waitForResponse(
      () => publicRequest('/healthz'),
      (response) => response.statusCode !== 200,
      { timeoutMs: Math.min(timeout, 30_000), pollMs: poll, timeoutCode: 'lark_webhook_edge_assertion_failed' },
    );
    await channel.connect();
    const recovered = await waitForResponse(
      () => publicRequest('/healthz'),
      (response) => response.statusCode === 200 && response.body?.ok === true,
      { timeoutMs: timeout, pollMs: poll, timeoutCode: 'lark_webhook_edge_health_timeout' },
    );
    const secondEvent = createSignedRequest({
      schema: '2.0',
      header: { event_type: 'edge.smoke', token: verificationToken },
      event: { sequence: 2 },
    }, { encryptKey, now });
    const secondEventResponse = await publicRequest('/lark/events', {
      method: 'POST',
      body: secondEvent.body,
      headers: secondEvent.headers,
    });
    assertResponse(secondEventResponse, (response) => (
      response.statusCode === 200 && response.body?.ok === true && response.body?.sequence === 2
    ));
    results.push({ id: 'origin_restart_recovery', ok: true, attempts: recovered.attempts, elapsedMs: recovered.elapsedMs });

    return {
      ok: results.every((result) => result.ok),
      applied: true,
      tunnelProvider: 'trycloudflare',
      tls: true,
      dnsMode,
      results,
    };
  } finally {
    await channel.disconnect().catch(() => {});
    await tunnel?.stop?.().catch(() => {});
    await edgeDispatcher?.close?.().catch(() => {});
  }
}
