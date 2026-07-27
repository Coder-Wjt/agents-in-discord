import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  LARK_WEBHOOK_ACCEPTANCE_EVIDENCE_KEYS,
  readLarkWebhookAcceptanceState,
  writeLarkWebhookAcceptanceState,
} from '../src/lark-webhook-acceptance.js';
import { runLarkWebhookLiveSmoke } from '../src/lark-webhook-live-runner.js';

function createHealthResponse() {
  return {
    ok: true,
    status: 200,
    async json() {
      return { ok: true, platform: 'lark', transport: 'webhook', state: 'connected' };
    },
  };
}

function createHarness(t, { transport = 'webhook' } = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lark-webhook-live-runner-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const dataDir = path.join(rootDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, '.env'), [
    `LARK_TRANSPORT=${transport}`,
    'LARK_APP_ID=cli_test_app',
    'LARK_APP_SECRET=app-secret',
    'LARK_WEBHOOK_VERIFICATION_TOKEN=verification-secret',
    'LARK_WEBHOOK_ENCRYPT_KEY=encryption-secret',
    'LARK_WEBHOOK_HOST=127.0.0.1',
    'LARK_WEBHOOK_PORT=3000',
    'LARK_WEBHOOK_PATH=/lark/events',
    'LARK_WEBHOOK_HEALTH_PATH=/healthz',
    'LARK_ALLOWED_USER_IDS=ou_owner',
  ].join('\n'));
  fs.writeFileSync(path.join(dataDir, 'bot.lark.prod.lock'), JSON.stringify({ pid: process.pid }));
  const fetched = [];
  const fetchFn = async (url) => {
    fetched.push(String(url));
    return createHealthResponse();
  };
  return {
    rootDir,
    dataDir,
    env: {},
    processRef: { kill() {} },
    fetchFn,
    fetched,
    publicUrl: 'https://hooks.example.test/lark/events',
    acceptanceFile: path.join(dataDir, 'lark-webhook-acceptance.lark.prod.json'),
  };
}

test('Lark live webhook runner keeps preflight read-only and requires the production transport', async (t) => {
  const harness = createHarness(t);
  const report = await runLarkWebhookLiveSmoke({
    ...harness,
    options: { mode: 'preflight', publicUrl: harness.publicUrl, waitMs: 0 },
  });
  assert.equal(report.ok, true);
  assert.equal(report.webhookTransport, true);
  assert.equal(report.encryptionReady, true);
  assert.equal(report.localHealthReady, true);
  assert.equal(report.publicHealthReady, true);
  assert.equal(fs.existsSync(harness.acceptanceFile), false);
  assert.equal(harness.fetched.length, 2);
  assert.doesNotMatch(JSON.stringify(report), /hooks\.example|app-secret|verification-secret|encryption-secret|ou_owner/);

  const cliHarness = createHarness(t, { transport: 'cli' });
  const rejected = await runLarkWebhookLiveSmoke({
    ...cliHarness,
    options: { mode: 'preflight', publicUrl: cliHarness.publicUrl, waitMs: 0 },
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.webhookTransport, false);
  assert.equal(cliHarness.fetched.length, 0);
});

test('Lark live webhook runner prepares and verifies a boolean-only real-event receipt', async (t) => {
  const harness = createHarness(t);
  const nowValue = Date.parse('2026-07-27T00:00:00.000Z');
  const prepare = await runLarkWebhookLiveSmoke({
    ...harness,
    options: { mode: 'prepare', publicUrl: harness.publicUrl, waitMs: 0 },
    now: () => nowValue,
  });
  assert.equal(prepare.ok, true);
  assert.equal(prepare.prepared, true);
  const state = readLarkWebhookAcceptanceState(harness.acceptanceFile);
  assert.equal(state.status, 'prepared');
  assert.equal(state.evidence.localHealthReady, true);
  assert.equal(state.evidence.publicHealthReady, true);

  writeLarkWebhookAcceptanceState(harness.acceptanceFile, {
    ...state,
    status: 'observed',
    evidence: Object.fromEntries(LARK_WEBHOOK_ACCEPTANCE_EVIDENCE_KEYS.map((key) => [key, true])),
  });
  const verify = await runLarkWebhookLiveSmoke({
    ...harness,
    options: { mode: 'verify', publicUrl: harness.publicUrl, waitMs: 0 },
    now: () => nowValue + 1000,
  });
  assert.equal(verify.ok, true);
  assert.equal(verify.result.complete, true);
  assert.deepEqual(verify.result.missing, []);
  assert.equal(readLarkWebhookAcceptanceState(harness.acceptanceFile).status, 'verified');
  assert.doesNotMatch(JSON.stringify(verify), /hooks\.example|app-secret|verification-secret|encryption-secret|ou_owner/);
});

test('Lark live webhook runner observes separate app and public-proxy recovery while waiting', async (t) => {
  const harness = createHarness(t);
  const baseTime = Date.parse('2026-07-27T00:00:00.000Z');
  await runLarkWebhookLiveSmoke({
    ...harness,
    options: { mode: 'prepare', publicUrl: harness.publicUrl, waitMs: 0 },
    now: () => baseTime,
  });
  const state = readLarkWebhookAcceptanceState(harness.acceptanceFile);
  const evidence = Object.fromEntries(
    LARK_WEBHOOK_ACCEPTANCE_EVIDENCE_KEYS.map((key) => [key, true]),
  );
  evidence.applicationRestartObserved = false;
  evidence.proxyRestartObserved = false;
  writeLarkWebhookAcceptanceState(harness.acceptanceFile, {
    ...state,
    status: 'observed',
    preparedBootFingerprint: 'previous-runtime-boot',
    evidence,
  });

  let publicCalls = 0;
  let tick = 0;
  const fetchFn = async (url) => {
    if (String(url).startsWith('https:')) {
      publicCalls += 1;
      if (publicCalls === 2) throw new Error('proxy restarting');
    }
    return createHealthResponse();
  };
  const verify = await runLarkWebhookLiveSmoke({
    ...harness,
    fetchFn,
    options: { mode: 'verify', publicUrl: harness.publicUrl, waitMs: 5000 },
    now: () => baseTime + tick * 1000,
    delayFn: async () => { tick += 1; },
  });
  assert.equal(verify.ok, true);
  assert.equal(verify.result.applicationRestartObserved, true);
  assert.equal(verify.result.proxyRestartObserved, true);
  assert.equal(publicCalls >= 3, true);
});

test('Lark live webhook runner rejects an expired unverified receipt', async (t) => {
  const harness = createHarness(t);
  const baseTime = Date.parse('2026-07-27T00:00:00.000Z');
  await runLarkWebhookLiveSmoke({
    ...harness,
    options: { mode: 'prepare', publicUrl: harness.publicUrl, waitMs: 0 },
    now: () => baseTime,
  });
  const state = readLarkWebhookAcceptanceState(harness.acceptanceFile);
  writeLarkWebhookAcceptanceState(harness.acceptanceFile, {
    ...state,
    status: 'observed',
    expiresAt: new Date(baseTime + 60_000).toISOString(),
    evidence: Object.fromEntries(
      LARK_WEBHOOK_ACCEPTANCE_EVIDENCE_KEYS.map((key) => [key, true]),
    ),
  });
  const verify = await runLarkWebhookLiveSmoke({
    ...harness,
    options: { mode: 'verify', publicUrl: harness.publicUrl, waitMs: 0 },
    now: () => baseTime + 60_001,
  });
  assert.equal(verify.ok, false);
  assert.match(verify.error, /No prepared webhook acceptance/);
  assert.equal(readLarkWebhookAcceptanceState(harness.acceptanceFile).status, 'observed');
});
