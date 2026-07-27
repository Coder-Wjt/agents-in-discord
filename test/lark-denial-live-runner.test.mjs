import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createLarkDenialAcceptanceRecorder,
  readLarkDenialAcceptanceState,
} from '../src/lark-denial-acceptance.js';
import { runLarkDenialLiveSmoke } from '../src/lark-denial-live-runner.js';
import { buildConversationKey } from '../src/platforms/conversation-key.js';

function createHarness(t, { userCount = 2 } = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lark-denial-live-runner-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const dataDir = path.join(rootDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, '.env'), [
    'LARK_ALLOWED_USER_IDS=ou_owner',
    'LARK_CLI_BIN=lark-cli',
  ].join('\n'));
  fs.writeFileSync(path.join(dataDir, 'bot.lark.prod.lock'), JSON.stringify({ pid: 42 }));
  const conversation = buildConversationKey({
    platformId: 'lark',
    tenantId: 'tenant',
    conversationId: 'oc_group',
  });
  fs.writeFileSync(path.join(dataDir, 'sessions.lark.prod.json'), JSON.stringify({
    threads: { [conversation]: {} },
  }));
  let sentCard = null;
  const execFileFn = (_bin, args, _options, callback) => {
    let payload;
    if (args.includes('auth') && args.includes('status')) {
      payload = {
        identities: {
          bot: { available: true, status: 'ready' },
          user: { available: true, status: 'ready' },
        },
      };
    } else if (args.includes('whoami')) {
      payload = { onBehalfOf: { openId: 'ou_owner' } };
    } else if (args.includes('+chat-members-list')) {
      payload = { data: { users: Array.from({ length: userCount }, () => ({})), truncations: [] } };
    } else if (args.includes('+messages-send')) {
      const contentIndex = args.indexOf('--content');
      sentCard = JSON.parse(args[contentIndex + 1]);
      payload = { data: { message_id: 'om_shared', chat_id: 'oc_group' } };
    } else if (args.some((arg) => String(arg).includes('/open-apis/im/v1/messages/'))) {
      payload = {
        data: {
          items: [{
            message_id: 'om_shared',
            body: { content: JSON.stringify(sentCard) },
          }],
        },
      };
    } else if (args.some((arg) => String(arg).includes('/open-apis/im/v1/chats/'))) {
      payload = { data: { chat_mode: 'group' } };
    } else {
      payload = {};
    }
    callback(null, { stdout: JSON.stringify(payload), stderr: '' });
  };
  return {
    rootDir,
    dataDir,
    execFileFn,
    processRef: { kill() {} },
    getSentCard: () => sentCard,
  };
}

test('Lark live denial runner refuses preparation until a second user is present', async (t) => {
  const harness = createHarness(t, { userCount: 1 });
  const report = await runLarkDenialLiveSmoke({
    ...harness,
    options: { mode: 'prepare', waitMs: 0 },
    env: {},
  });
  assert.equal(report.ok, false);
  assert.equal(report.groupUserCount, 1);
  assert.equal(report.secondUserReady, false);
  assert.equal(harness.getSentCard(), null);
  assert.doesNotMatch(JSON.stringify(report), /ou_owner|oc_group|om_shared/);
});

test('Lark live denial runner prepares, observes, and verifies one real-style callback receipt', async (t) => {
  const harness = createHarness(t);
  const nowValue = Date.parse('2026-07-27T00:00:00.000Z');
  const prepare = await runLarkDenialLiveSmoke({
    ...harness,
    options: { mode: 'prepare', waitMs: 0 },
    env: {},
    now: () => nowValue,
  });
  assert.equal(prepare.ok, true);
  assert.equal(prepare.prepared, true);
  assert.ok(harness.getSentCard());
  const acceptanceFile = path.join(harness.dataDir, 'lark-denial-acceptance.lark.prod.json');
  const prepared = readLarkDenialAcceptanceState(acceptanceFile);
  const recorder = createLarkDenialAcceptanceRecorder({
    stateFile: acceptanceFile,
    now: () => nowValue + 1000,
  });
  assert.equal(await recorder.recordPermissionDenied({
    actor: { id: 'ou_intruder' },
    component: { id: prepared.componentId },
    responseTarget: { chatId: prepared.chatId, messageId: prepared.messageId },
  }, {
    delivery: 'private',
    response: { messageId: 'om_private', chatId: 'oc_private' },
  }), true);
  const verify = await runLarkDenialLiveSmoke({
    ...harness,
    options: { mode: 'verify', waitMs: 0 },
    env: {},
    now: () => nowValue + 2000,
  });
  assert.deepEqual(verify.result, {
    ok: true,
    callbackObserved: true,
    actorDifferentFromOwner: true,
    privateDeliverySucceeded: true,
    privateChatSeparatedFromGroup: true,
    sharedCardUnchanged: true,
  });
  assert.equal(readLarkDenialAcceptanceState(acceptanceFile).status, 'verified');
  assert.doesNotMatch(JSON.stringify(verify), /ou_intruder|om_private|oc_private|oc_group|om_shared/);
});
