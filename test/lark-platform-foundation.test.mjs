import test from 'node:test';
import assert from 'node:assert/strict';

import { assertPlatformAdapter } from '../src/platforms/contracts.js';
import { createLarkPlatformFoundation } from '../src/platforms/lark/foundation.js';

test('Lark foundation composes a Node 18 message-first adapter', () => {
  const channel = {
    on() {},
    async send() { return { messageId: 'om_1' }; },
    async editMessage() {},
  };
  const foundation = createLarkPlatformFoundation({
    eventNormalizerOptions: { getChannel: () => channel },
    messageDeliveryOptions: { getChannel: () => channel },
    notificationDeliveryOptions: { getChannel: () => channel },
  });
  const adapter = foundation.createAdapter({
    entryHandlerOptions: {
      getSession: () => ({ provider: 'codex' }),
      resolveSecurityContext: () => ({ profile: 'team', mentionOnly: false }),
      handleCommand: async () => {},
      enqueuePrompt: async () => {},
    },
    lifecycleOptions: {
      createClient: () => channel,
    },
  });

  assertPlatformAdapter(adapter);
  assert.equal(foundation.id, 'lark');
  assert.equal(adapter.id, 'lark');
  assert.equal(adapter.capabilities.threads, true);
  assert.equal(adapter.capabilities.slashCommands, true);
  assert.equal(adapter.capabilities.buttons, true);
  assert.equal(adapter.capabilities.selectMenus, true);
  assert.equal(adapter.capabilities.modals, true);
  assert.equal(adapter.capabilities.messageEdits, true);
  assert.equal(adapter.capabilities.reactions, true);
  assert.equal(adapter.capabilities.attachments, true);
  assert.equal(typeof foundation.messageDelivery.getMetricsSnapshot, 'function');
  assert.equal(typeof adapter.messageDelivery.getMetricsSnapshot, 'function');
  assert.equal(adapter.conversationSpawn.canSpawn({}), false);
  assert.equal(adapter.commandRegistryRenderer.formatCommandReference('status'), '/status');
});
