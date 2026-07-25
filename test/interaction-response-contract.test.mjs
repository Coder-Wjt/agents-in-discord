import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INTERACTION_RESPONSE_METHODS,
  assertInteractionResponse,
} from '../src/platforms/interaction-response.js';

test('assertInteractionResponse accepts a complete platform response port', () => {
  const response = {
    respond() {},
    update() {},
    showModal() {},
    defer() {},
  };

  assert.deepEqual(INTERACTION_RESPONSE_METHODS, ['respond', 'update', 'showModal', 'defer']);
  assert.equal(assertInteractionResponse(response), response);
});

test('assertInteractionResponse rejects incomplete response ports', () => {
  assert.throws(
    () => assertInteractionResponse({ respond() {}, update() {}, showModal() {} }),
    /must provide defer\(\)/,
  );
  assert.throws(
    () => assertInteractionResponse(null),
    /must be an object/,
  );
});
