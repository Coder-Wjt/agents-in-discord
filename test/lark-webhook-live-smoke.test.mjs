import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createLarkWebhookPreparedState,
  writeLarkWebhookAcceptanceState,
} from '../src/lark-webhook-acceptance.js';
import {
  discoverActiveLarkWebhookRuntime,
  formatLarkWebhookLiveSmokeError,
  inspectLarkWebhookHealthResponse,
  inspectPendingLarkWebhookAcceptance,
  parseLarkWebhookLiveSmokeArgs,
  resolveLarkWebhookLocalHealthUrl,
  resolveLarkWebhookPublicEndpoints,
} from '../src/lark-webhook-live-smoke.js';

test('Lark live webhook smoke keeps state writes and observation explicit', () => {
  assert.deepEqual(parseLarkWebhookLiveSmokeArgs([]), {
    mode: 'preflight',
    help: false,
    json: false,
    publicUrl: null,
    waitMs: 0,
  });
  assert.deepEqual(parseLarkWebhookLiveSmokeArgs([
    '--prepare', '--public-url', 'https://example.test/lark/events', '--wait-ms=60000', '--json',
  ]), {
    mode: 'prepare',
    help: false,
    json: true,
    publicUrl: 'https://example.test/lark/events',
    waitMs: 60000,
  });
  assert.deepEqual(parseLarkWebhookLiveSmokeArgs(['--verify', '--wait-ms', '1000']), {
    mode: 'verify',
    help: false,
    json: false,
    publicUrl: null,
    waitMs: 1000,
  });
  assert.throws(() => parseLarkWebhookLiveSmokeArgs(['--wait-ms', '1']), /requires/);
  assert.throws(() => parseLarkWebhookLiveSmokeArgs(['--prepare', '--verify']), /mutually exclusive/);
});

test('Lark live webhook smoke accepts only a matching public HTTPS callback URL', () => {
  const config = { path: '/lark/events', healthPath: '/healthz' };
  assert.deepEqual(resolveLarkWebhookPublicEndpoints(
    'https://hooks.example.test/lark/events',
    config,
  ), {
    callbackUrl: 'https://hooks.example.test/lark/events',
    healthUrl: 'https://hooks.example.test/healthz',
  });
  assert.equal(resolveLarkWebhookPublicEndpoints('http://hooks.example.test/lark/events', config), null);
  assert.equal(resolveLarkWebhookPublicEndpoints('https://hooks.example.test/wrong', config), null);
  assert.equal(resolveLarkWebhookPublicEndpoints('https://user@hooks.example.test/lark/events', config), null);
  assert.equal(resolveLarkWebhookPublicEndpoints('https://hooks.example.test/lark/events?token=x', config), null);
  assert.equal(resolveLarkWebhookLocalHealthUrl({
    host: '0.0.0.0', port: 3000, healthPath: '/healthz',
  }), 'http://127.0.0.1:3000/healthz');
});

test('Lark live webhook smoke validates only the non-sensitive health contract', () => {
  assert.equal(inspectLarkWebhookHealthResponse({ ok: true, status: 200 }, {
    ok: true,
    platform: 'lark',
    transport: 'webhook',
    state: 'connected',
  }), true);
  assert.equal(inspectLarkWebhookHealthResponse({ ok: true, status: 200 }, {
    ok: true,
    platform: 'lark',
    transport: 'websocket',
    state: 'connected',
  }), false);
});

test('Lark live webhook smoke discovers provider-instance state and pending receipts', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lark-webhook-live-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'bot.codex.lark.prod.lock'), JSON.stringify({ pid: 42 }));
  const runtimes = discoverActiveLarkWebhookRuntime({
    dataDir: directory,
    processRef: { kill() {} },
  });
  assert.equal(runtimes.length, 1);
  assert.equal(runtimes[0].pid, 42);
  assert.equal(
    path.basename(runtimes[0].acceptanceFile),
    'lark-webhook-acceptance.codex.lark.prod.json',
  );
  const now = Date.parse('2026-07-27T00:00:00.000Z');
  writeLarkWebhookAcceptanceState(runtimes[0].acceptanceFile, createLarkWebhookPreparedState({
    bootFingerprint: 'boot',
    now: () => now,
  }));
  assert.equal(inspectPendingLarkWebhookAcceptance(
    runtimes[0].acceptanceFile,
    { now: () => now + 1000 },
  ).pending, true);
  assert.doesNotMatch(
    formatLarkWebhookLiveSmokeError({ message: 'secret URL and callback body' }),
    /secret|URL and callback body/,
  );
});
