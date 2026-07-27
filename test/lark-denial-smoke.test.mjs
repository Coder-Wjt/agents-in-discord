import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatLarkDenialSmokeError,
  inspectLarkDenialSmokeAuth,
  parseLarkDenialSmokeArgs,
  runLarkDenialSmoke,
  verifyLarkDenialMessage,
} from '../src/lark-denial-smoke.js';

test('Lark denial smoke keeps the real private message explicit', () => {
  assert.deepEqual(parseLarkDenialSmokeArgs([]), {
    apply: false,
    help: false,
    json: false,
  });
  assert.deepEqual(parseLarkDenialSmokeArgs(['--apply', '--json']), {
    apply: true,
    help: false,
    json: true,
  });
  assert.throws(() => parseLarkDenialSmokeArgs(['--send']), /Unknown option/);
});

test('Lark denial smoke requires ready bot and user identities without exposing ids', () => {
  const auth = inspectLarkDenialSmokeAuth({
    identities: {
      bot: { available: true, status: 'ready' },
      user: { available: true, status: 'ready' },
    },
  }, {
    onBehalfOf: { openId: 'ou_private_user' },
  });
  assert.equal(auth.ok, true);
  assert.equal(auth.botReady, true);
  assert.equal(auth.userReady, true);
  assert.equal(inspectLarkDenialSmokeAuth({ identities: {} }, {}).ok, false);
  assert.doesNotMatch(formatLarkDenialSmokeError({ message: 'ou_private_user secret' }), /ou_private_user|secret/);
});

test('Lark denial smoke recognizes the delivered denial card', () => {
  assert.equal(verifyLarkDenialMessage({
    data: {
      items: [{
        message_id: 'om_denial',
        body: { content: '{"text":"⛔ 没有权限。"}' },
      }],
    },
  }, { messageId: 'om_denial' }), true);
  assert.equal(verifyLarkDenialMessage({
    data: { items: [{ message_id: 'om_other', content: '没有权限' }] },
  }, { messageId: 'om_denial' }), false);
});

test('Lark denial smoke sends privately without updating shared state or starting consumers', async () => {
  let sent = 0;
  let updated = 0;
  const channel = {
    botIdentity: { openId: 'ou_bot' },
    getConnectionStatus: () => ({ state: 'idle', consumerCount: 0 }),
    async send() {
      sent += 1;
      return { messageId: 'om_private', chatId: 'oc_private' };
    },
    async updateCard() { updated += 1; },
    async editMessage() { updated += 1; },
  };
  const result = await runLarkDenialSmoke({
    channel,
    actorOpenId: 'ou_denied',
    verifySentMessage: async ({ messageId, chatId }) => (
      messageId === 'om_private' && chatId === 'oc_private'
    ),
  });

  assert.equal(sent, 1);
  assert.equal(updated, 0);
  assert.deepEqual(result, {
    ok: true,
    privateSends: 1,
    sharedUpdateAttempts: 0,
    deliveryVerified: true,
    consumerFree: true,
    syntheticCallback: true,
    realBotDm: true,
  });
  assert.doesNotMatch(JSON.stringify(result), /ou_denied|om_private|oc_private/);
});
