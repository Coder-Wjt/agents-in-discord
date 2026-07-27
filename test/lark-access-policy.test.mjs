import test from 'node:test';
import assert from 'node:assert/strict';

import { createLarkAccessPolicy } from '../src/platforms/lark/access-policy.js';

test('Lark access policy supports chat, tenant, and user allowlists', async () => {
  const policy = createLarkAccessPolicy({
    allowedChatIds: new Set(['oc_allowed']),
    allowedTenantIds: new Set(['tenant_allowed']),
    allowedUserIds: new Set(['ou_allowed']),
  });
  assert.equal(policy.isAllowedUser('ou_allowed'), true);
  assert.equal(policy.isAllowedUser('ou_denied'), false);
  assert.equal(policy.isAllowedChannel({ chatId: 'oc_allowed' }), true);
  assert.equal(policy.isAllowedChannel({ chatId: 'oc_other', tenantId: 'tenant_allowed' }), true);
  assert.equal(policy.isAllowedChannel({ chatId: 'oc_other', tenantId: 'tenant_other' }), false);
  assert.equal(await policy.isAllowedInteractionChannel({
    conversation: { raw: { chatId: 'oc_allowed' } },
  }), true);
});
