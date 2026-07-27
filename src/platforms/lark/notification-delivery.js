import { parseConversationKey } from '../conversation-key.js';
import {
  assertNotificationDelivery,
  assertNotificationPayload,
} from '../notification-delivery.js';

function resolveChatId(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  try {
    const parsed = parseConversationKey(normalized);
    return parsed.platformId === 'lark' ? parsed.conversationId : '';
  } catch {
    return normalized;
  }
}

export function createLarkNotificationDelivery({ getChannel = () => null } = {}) {
  async function sendNotification(conversationId, payload) {
    const chatId = resolveChatId(conversationId);
    if (!chatId) throw new TypeError('Lark notification conversation id must be non-empty.');
    const normalizedPayload = assertNotificationPayload(payload);
    const channel = getChannel();
    if (typeof channel?.send !== 'function') return false;
    await channel.send(chatId, { text: normalizedPayload.content });
    return true;
  }
  return assertNotificationDelivery({ sendNotification });
}
