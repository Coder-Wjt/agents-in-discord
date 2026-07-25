import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NOTIFICATION_DELIVERY_METHODS,
  assertNotificationDelivery,
  assertNotificationPayload,
} from '../src/platforms/notification-delivery.js';

test('notification delivery contract accepts a complete platform port', () => {
  const delivery = {
    sendNotification() {},
  };

  assert.deepEqual(NOTIFICATION_DELIVERY_METHODS, ['sendNotification']);
  assert.equal(assertNotificationDelivery(delivery), delivery);
  assert.deepEqual(
    assertNotificationPayload({ content: 'upgrade available' }),
    { content: 'upgrade available' },
  );
});

test('notification delivery contract rejects incomplete ports and payloads', () => {
  assert.throws(
    () => assertNotificationDelivery({}),
    /must provide sendNotification\(\)/,
  );
  assert.throws(
    () => assertNotificationPayload({ content: '   ' }),
    /content must be a non-empty string/,
  );
});
