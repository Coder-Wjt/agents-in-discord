import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MESSAGE_DELIVERY_METHODS,
  assertMessageDelivery,
} from '../src/platforms/message-delivery.js';

function createCompleteDelivery() {
  return Object.fromEntries(MESSAGE_DELIVERY_METHODS.map((method) => [method, () => {}]));
}

test('assertMessageDelivery accepts a complete delivery port', () => {
  const delivery = createCompleteDelivery();
  assert.equal(assertMessageDelivery(delivery), delivery);
});

test('assertMessageDelivery rejects a missing operation', () => {
  const delivery = createCompleteDelivery();
  delete delivery.edit;

  assert.throws(
    () => assertMessageDelivery(delivery),
    /must provide edit\(\)/,
  );
});
