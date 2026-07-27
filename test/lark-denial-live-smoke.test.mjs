import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildConversationKey } from '../src/platforms/conversation-key.js';
import {
  createLarkDenialPreparedState,
  discoverActiveLarkRuntime,
  extractLarkSessionConversationIds,
  formatLarkDenialLiveSmokeError,
  inspectLarkDenialLiveMembers,
  inspectLarkDenialOwnerAllowlist,
  inspectPendingLarkDenialAcceptance,
  parseLarkDenialLiveSmokeArgs,
} from '../src/lark-denial-live-smoke.js';
import { writeLarkDenialAcceptanceState } from '../src/lark-denial-acceptance.js';

test('Lark live denial smoke keeps writes and waiting explicit', () => {
  assert.deepEqual(parseLarkDenialLiveSmokeArgs([]), {
    mode: 'preflight',
    help: false,
    json: false,
    waitMs: 0,
  });
  assert.deepEqual(parseLarkDenialLiveSmokeArgs(['--prepare', '--wait-ms', '60000', '--json']), {
    mode: 'prepare',
    help: false,
    json: true,
    waitMs: 60000,
  });
  assert.deepEqual(parseLarkDenialLiveSmokeArgs(['--verify']), {
    mode: 'verify',
    help: false,
    json: false,
    waitMs: 0,
  });
  assert.throws(() => parseLarkDenialLiveSmokeArgs(['--prepare', '--verify']), /mutually exclusive/);
  assert.throws(() => parseLarkDenialLiveSmokeArgs(['--wait-ms', '1']), /requires --prepare/);
});

test('Lark live denial smoke discovers exactly the active provider-instance state', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lark-denial-live-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'bot.codex.lark.prod.lock'), JSON.stringify({ pid: 42 }));
  fs.writeFileSync(path.join(directory, 'bot.lark.stale.lock'), JSON.stringify({ pid: 41 }));
  const runtimes = discoverActiveLarkRuntime({
    dataDir: directory,
    processRef: {
      kill(pid) {
        if (pid === 42) return;
        const error = new Error('missing');
        error.code = 'ESRCH';
        throw error;
      },
    },
  });
  assert.equal(runtimes.length, 1);
  assert.equal(runtimes[0].botProvider, 'codex');
  assert.equal(runtimes[0].instanceId, 'prod');
  assert.equal(path.basename(runtimes[0].sessionFile), 'sessions.codex.lark.prod.json');
  assert.equal(path.basename(runtimes[0].acceptanceFile), 'lark-denial-acceptance.codex.lark.prod.json');
});

test('Lark live denial smoke extracts only qualified Lark conversations', () => {
  const first = buildConversationKey({
    platformId: 'lark',
    tenantId: 'tenant',
    conversationId: 'oc_group',
  });
  const reply = buildConversationKey({
    platformId: 'lark',
    tenantId: 'tenant',
    conversationId: 'oc_group',
    threadId: 'om_root',
  });
  const discord = buildConversationKey({
    platformId: 'discord',
    tenantId: 'guild',
    conversationId: 'channel',
  });
  assert.deepEqual(extractLarkSessionConversationIds({
    threads: { [first]: {}, [reply]: {}, [discord]: {}, legacy: {} },
  }), ['oc_group']);
});

test('Lark live denial preflight requires a complete two-user group and owner-only allowlist', () => {
  assert.deepEqual(inspectLarkDenialLiveMembers({
    data: { users: [{}, {}], truncations: [] },
  }), {
    ok: true,
    userCount: 2,
    secondUserReady: true,
    truncated: false,
  });
  assert.equal(inspectLarkDenialLiveMembers({ data: { users: [{}] } }).ok, false);
  assert.deepEqual(inspectLarkDenialOwnerAllowlist('ou_owner', 'ou_owner'), {
    ok: true,
    allowedUserCount: 1,
    ownerAllowed: true,
  });
  assert.equal(inspectLarkDenialOwnerAllowlist('ou_owner,ou_other', 'ou_owner').ok, false);
});

test('Lark live denial smoke tracks prepared and observed state without exposing raw errors', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lark-denial-live-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, 'state.json');
  const now = Date.parse('2026-07-27T00:00:00.000Z');
  const state = createLarkDenialPreparedState({
    chatId: 'oc_group',
    messageId: 'om_shared',
    componentId: 'stg:nav:main:overview:ou_owner:abc123',
    ownerUserId: 'ou_owner',
    cardHash: 'hash',
    now: () => now,
  });
  writeLarkDenialAcceptanceState(stateFile, state);
  assert.equal(inspectPendingLarkDenialAcceptance(stateFile, { now: () => now + 1000 }).pending, true);
  writeLarkDenialAcceptanceState(stateFile, { ...state, status: 'observed' });
  assert.equal(inspectPendingLarkDenialAcceptance(stateFile, { now: () => now + 1000 }).observed, true);
  assert.doesNotMatch(
    formatLarkDenialLiveSmokeError({ message: 'ou_private secret callback body' }),
    /ou_private|secret|callback body/,
  );
});
