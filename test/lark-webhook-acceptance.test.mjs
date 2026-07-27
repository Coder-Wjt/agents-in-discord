import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createLarkWebhookAcceptanceRecorder,
  createLarkWebhookPreparedState,
  inspectLarkWebhookAcceptance,
  mergeLarkWebhookAcceptanceEvidence,
  readLarkWebhookAcceptanceState,
  resolveLarkProcessBootFingerprint,
  resolveLarkWebhookAcceptanceStateFile,
  writeLarkWebhookAcceptanceState,
} from '../src/lark-webhook-acceptance.js';

test('Lark webhook acceptance stores only boolean evidence in isolated mode-0600 state', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lark-webhook-acceptance-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const stateFile = resolveLarkWebhookAcceptanceStateFile({
    dataDir: directory,
    instanceId: 'prod',
    botProvider: 'codex',
  });
  assert.equal(path.basename(stateFile), 'lark-webhook-acceptance.codex.lark.prod.json');
  const initialTime = Date.parse('2026-07-27T00:00:00.000Z');
  writeLarkWebhookAcceptanceState(stateFile, createLarkWebhookPreparedState({
    bootFingerprint: 'boot-before-restart',
    localHealthReady: true,
    publicHealthReady: true,
    now: () => initialTime,
  }));

  const recorder = createLarkWebhookAcceptanceRecorder({
    stateFile,
    bootFingerprint: 'boot-after-restart',
    now: () => initialTime + 1000,
  });
  await recorder.recordVerifiedRequest({
    encrypted: true,
    challenge: true,
    signed: true,
    signature: 'signature-private',
    body: 'decrypted-private-body',
  });
  await recorder.recordAcceptedEvent('message', { messageId: 'om_private' });
  await recorder.recordAcceptedEvent('nativeSlashCommand', { actorId: 'ou_private' });
  await recorder.recordAcceptedEvent('botMenu', { eventId: 'evt_private' });
  await recorder.recordAcceptedEvent('cardAction', { chatId: 'oc_private' });
  assert.equal(mergeLarkWebhookAcceptanceEvidence(stateFile, {
    proxyRestartObserved: true,
    ignoredPrivateField: 'secret',
  }, { now: () => initialTime + 2000 }), true);

  const state = readLarkWebhookAcceptanceState(stateFile);
  const inspection = inspectLarkWebhookAcceptance(state, { now: () => initialTime + 3000 });
  assert.equal(inspection.complete, true);
  assert.deepEqual(inspection.missing, []);
  assert.equal(state.status, 'observed');
  assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);
  assert.doesNotMatch(
    JSON.stringify(state),
    /signature-private|decrypted-private-body|om_private|ou_private|evt_private|oc_private|secret/,
  );
});

test('Lark webhook acceptance ignores unknown events and expired receipt windows', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lark-webhook-acceptance-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, 'state.json');
  const initialTime = Date.parse('2026-07-27T00:00:00.000Z');
  writeLarkWebhookAcceptanceState(stateFile, createLarkWebhookPreparedState({
    bootFingerprint: 'boot-a',
    now: () => initialTime,
    ttlMs: 60_000,
  }));
  const activeRecorder = createLarkWebhookAcceptanceRecorder({
    stateFile,
    bootFingerprint: 'boot-a',
    now: () => initialTime + 1000,
  });
  assert.equal(await activeRecorder.recordAcceptedEvent('unknown'), false);
  const expiredRecorder = createLarkWebhookAcceptanceRecorder({
    stateFile,
    bootFingerprint: 'boot-b',
    now: () => initialTime + 60_001,
  });
  assert.equal(await expiredRecorder.recordVerifiedRequest({ encrypted: true }), false);
  assert.equal(readLarkWebhookAcceptanceState(stateFile).status, 'prepared');
});

test('Lark webhook acceptance derives a stable non-identifier boot fingerprint', () => {
  const first = resolveLarkProcessBootFingerprint(process.pid);
  const second = resolveLarkProcessBootFingerprint(process.pid);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(second, first);
  assert.equal(first.includes(String(process.pid)), false);
});
