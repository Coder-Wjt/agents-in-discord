import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCapabilityAwareInboundEventNormalizer,
  createCapabilityAwareMessageDelivery,
  createPlatformCapabilities,
} from '../src/platforms/index.js';

function createMessageEvent(attachments = []) {
  return {
    type: 'message',
    platformId: 'example',
    id: 'message-1',
    actor: { id: 'user-1', displayName: 'User', isBot: false },
    conversation: { id: 'conversation-1', parentId: null, isThread: false },
    rawText: 'hello',
    text: 'hello',
    attachments,
    isSystem: false,
    targetsBot: true,
    raw: {},
  };
}

function createDelivery(calls) {
  return {
    reply: async (...args) => calls.push(['reply', ...args]),
    send: async (...args) => calls.push(['send', ...args]),
    edit: async (...args) => calls.push(['edit', ...args]),
    startTyping(target) {
      calls.push(['startTyping', target]);
      return () => calls.push(['stopTyping', target]);
    },
    splitText(text, maxChars) {
      calls.push(['splitText', text, maxChars]);
      return [text];
    },
    formatUserMention(userId) {
      calls.push(['formatUserMention', userId]);
      return `@${userId}`;
    },
    setMessageStatus: async (...args) => calls.push(['setMessageStatus', ...args]),
    completeModal: async (...args) => calls.push(['completeModal', ...args]),
  };
}

test('runtime capability policy suppresses unsupported edits and reactions', async () => {
  const calls = [];
  const base = createDelivery(calls);
  const capabilities = createPlatformCapabilities();
  const delivery = createCapabilityAwareMessageDelivery({ capabilities, messageDelivery: base });
  const target = { id: 'message-1' };

  assert.equal(await delivery.edit(target, 'updated'), target);
  assert.equal(await delivery.setMessageStatus(target, 'processing'), target);
  assert.deepEqual(calls, []);
  assert.throws(() => delivery.setMessageStatus(target, 'unknown'), /Unsupported message status/);
  assert.equal(
    createCapabilityAwareMessageDelivery({ capabilities, messageDelivery: delivery }),
    delivery,
  );
});

test('runtime capability policy preserves supported delivery operations', async () => {
  const calls = [];
  const base = createDelivery(calls);
  const capabilities = createPlatformCapabilities({ messageEdits: true, reactions: true });
  const delivery = createCapabilityAwareMessageDelivery({ capabilities, messageDelivery: base });
  const target = { id: 'message-1' };

  await delivery.edit(target, 'updated');
  await delivery.setMessageStatus(target, 'dequeued');
  await delivery.completeModal(target, 'saved');

  assert.deepEqual(calls, [
    ['edit', target, 'updated'],
    ['setMessageStatus', target, 'dequeued'],
    ['completeModal', target, 'saved'],
  ]);
});

test('runtime capability policy degrades modal completion to a fresh send without edits', async () => {
  const calls = [];
  const base = createDelivery(calls);
  const delivery = createCapabilityAwareMessageDelivery({
    capabilities: createPlatformCapabilities(),
    messageDelivery: base,
  });
  const target = { id: 'message-1' };

  await delivery.completeModal(target, 'saved');

  assert.deepEqual(calls, [['send', target, 'saved']]);
});

test('runtime capability policy removes inbound attachments when unsupported', () => {
  const attachment = { id: 'attachment-1', name: 'report.txt' };
  const base = {
    normalizeMessage: () => createMessageEvent([attachment]),
    normalizeInteraction: (interaction) => interaction,
  };
  const capabilities = createPlatformCapabilities();
  const normalizer = createCapabilityAwareInboundEventNormalizer({
    capabilities,
    eventNormalizer: base,
  });

  assert.deepEqual(normalizer.normalizeMessage({}).attachments, []);
  assert.equal(normalizer.normalizeInteraction('interaction'), 'interaction');
  assert.equal(
    createCapabilityAwareInboundEventNormalizer({ capabilities, eventNormalizer: normalizer }),
    normalizer,
  );

  const attachmentNormalizer = createCapabilityAwareInboundEventNormalizer({
    capabilities: createPlatformCapabilities({ attachments: true }),
    eventNormalizer: base,
  });
  assert.deepEqual(attachmentNormalizer.normalizeMessage({}).attachments, [attachment]);
});
