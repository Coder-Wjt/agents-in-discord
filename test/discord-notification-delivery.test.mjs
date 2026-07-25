import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscordNotificationDelivery } from '../src/platforms/discord/notification-delivery.js';

test('Discord notification delivery resolves a conversation id and sends content', async () => {
  const fetched = [];
  const sent = [];
  const delivery = createDiscordNotificationDelivery({
    getClient: () => ({
      channels: {
        fetch: async (channelId) => {
          fetched.push(channelId);
          return {
            send: async (payload) => sent.push(payload),
          };
        },
      },
    }),
  });

  const delivered = await delivery.sendNotification(' channel-1 ', { content: 'upgrade ready' });

  assert.equal(delivered, true);
  assert.deepEqual(fetched, ['channel-1']);
  assert.deepEqual(sent, [{ content: 'upgrade ready' }]);
});

test('Discord notification delivery reports unavailable clients and non-sendable channels', async () => {
  const unavailable = createDiscordNotificationDelivery();
  assert.equal(
    await unavailable.sendNotification('channel-1', { content: 'upgrade ready' }),
    false,
  );

  const nonSendable = createDiscordNotificationDelivery({
    getClient: () => ({
      channels: {
        fetch: async () => ({}),
      },
    }),
  });
  assert.equal(
    await nonSendable.sendNotification('channel-1', { content: 'upgrade ready' }),
    false,
  );
});

test('Discord notification delivery rejects invalid ids and payloads', async () => {
  const delivery = createDiscordNotificationDelivery();

  await assert.rejects(
    delivery.sendNotification('', { content: 'upgrade ready' }),
    /conversation id must be non-empty/,
  );
  await assert.rejects(
    delivery.sendNotification('channel-1', { content: '' }),
    /content must be a non-empty string/,
  );
});
