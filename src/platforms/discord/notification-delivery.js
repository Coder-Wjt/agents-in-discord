import {
  assertNotificationDelivery,
  assertNotificationPayload,
} from '../notification-delivery.js';

export function createDiscordNotificationDelivery({
  getClient = () => null,
} = {}) {
  if (typeof getClient !== 'function') {
    throw new TypeError('Discord notification delivery getClient must be a function.');
  }

  async function sendNotification(conversationId, payload) {
    const channelId = String(conversationId || '').trim();
    if (!channelId) {
      throw new TypeError('Discord notification conversation id must be non-empty.');
    }
    const normalizedPayload = assertNotificationPayload(payload);
    const client = getClient();
    if (typeof client?.channels?.fetch !== 'function') return false;

    const channel = await client.channels.fetch(channelId);
    if (typeof channel?.send !== 'function') return false;

    await channel.send({ content: normalizedPayload.content });
    return true;
  }

  return assertNotificationDelivery({
    sendNotification,
  });
}
