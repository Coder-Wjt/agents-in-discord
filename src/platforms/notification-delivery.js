export const NOTIFICATION_DELIVERY_METHODS = Object.freeze([
  'sendNotification',
]);

export function assertNotificationPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('Notification payload must be an object.');
  }
  if (typeof payload.content !== 'string' || !payload.content.trim()) {
    throw new TypeError('Notification payload content must be a non-empty string.');
  }
  return payload;
}

export function assertNotificationDelivery(delivery) {
  if (!delivery || typeof delivery !== 'object' || Array.isArray(delivery)) {
    throw new TypeError('Notification delivery must be an object.');
  }
  for (const method of NOTIFICATION_DELIVERY_METHODS) {
    if (typeof delivery[method] !== 'function') {
      throw new TypeError(`Notification delivery must provide ${method}().`);
    }
  }
  return delivery;
}
