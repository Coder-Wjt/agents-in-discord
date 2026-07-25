export const MESSAGE_DELIVERY_METHODS = Object.freeze([
  'reply',
  'send',
  'edit',
  'startTyping',
  'splitText',
  'formatUserMention',
  'setMessageStatus',
]);

export const MESSAGE_STATUSES = Object.freeze([
  'processing',
  'succeeded',
  'cancelled',
  'failed',
  'dequeued',
]);

export function assertMessageDelivery(messageDelivery) {
  if (!messageDelivery || typeof messageDelivery !== 'object' || Array.isArray(messageDelivery)) {
    throw new TypeError('Message delivery port must be an object.');
  }

  for (const method of MESSAGE_DELIVERY_METHODS) {
    if (typeof messageDelivery[method] !== 'function') {
      throw new TypeError(`Message delivery port must provide ${method}().`);
    }
  }

  return messageDelivery;
}
