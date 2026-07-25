import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CONVERSATION_SECURITY_RESOLVER,
  assertConversationSecurityDescriptor,
  assertConversationSecurityResolver,
  createUnknownConversationSecurityDescriptor,
} from '../src/platforms/conversation-security.js';

test('conversation security contract accepts normalized descriptors and resolvers', () => {
  const descriptor = assertConversationSecurityDescriptor({
    conversationId: 'conversation-1',
    parentConversationId: 'parent-1',
    tenantId: 'tenant-1',
    available: true,
    isDirect: false,
    visibility: 'team',
    reason: 'restricted membership',
  });
  const resolver = assertConversationSecurityResolver({
    resolve: () => descriptor,
  });

  assert.equal(resolver.resolve(), descriptor);
  assert.deepEqual(createUnknownConversationSecurityDescriptor(), {
    conversationId: null,
    parentConversationId: null,
    tenantId: null,
    available: false,
    isDirect: false,
    visibility: 'unknown',
    reason: 'conversation unavailable',
  });
});

test('default conversation security resolver preserves normalized identifiers', () => {
  assert.deepEqual(DEFAULT_CONVERSATION_SECURITY_RESOLVER.resolve({
    conversation: {
      id: 'conversation-1',
      parentId: 'parent-1',
      tenantId: 'tenant-1',
    },
  }), {
    conversationId: 'conversation-1',
    parentConversationId: 'parent-1',
    tenantId: 'tenant-1',
    available: true,
    isDirect: false,
    visibility: 'unknown',
    reason: 'visibility unavailable',
  });
});

test('conversation security contract rejects incomplete descriptors and resolvers', () => {
  assert.throws(
    () => assertConversationSecurityDescriptor({ visibility: 'public' }),
    /available must be a boolean/,
  );
  assert.throws(
    () => assertConversationSecurityDescriptor({
      available: true,
      isDirect: false,
      visibility: 'private',
      reason: 'invalid',
    }),
    /Unsupported conversation visibility/,
  );
  assert.throws(
    () => assertConversationSecurityResolver({}),
    /must provide resolve\(\)/,
  );
});
