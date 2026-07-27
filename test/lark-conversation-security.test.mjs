import test from 'node:test';
import assert from 'node:assert/strict';

import { createLarkConversationSecurity } from '../src/platforms/lark/conversation-security.js';
import { createSecurityPolicy } from '../src/security-policy.js';

test('Lark conversation security maps direct chats to solo-compatible descriptors', () => {
  const descriptor = createLarkConversationSecurity().resolve({
    conversation: {
      id: 'platform:v1:lark:tenant:chat:',
      parentId: null,
      tenantId: 'tenant',
      raw: { chatId: 'chat', chatType: 'p2p', tenantId: 'tenant' },
    },
  });
  assert.equal(descriptor.available, true);
  assert.equal(descriptor.conversationId, 'chat');
  assert.equal(descriptor.isDirect, true);
  assert.equal(descriptor.visibility, 'unknown');
});

test('Lark conversation security maps group membership to team visibility', () => {
  const descriptor = createLarkConversationSecurity().resolve({
    conversation: {
      id: 'platform:v1:lark:tenant:chat:',
      parentId: null,
      tenantId: 'tenant',
      raw: { chatId: 'chat', chatType: 'group', tenantId: 'tenant' },
    },
  });
  assert.equal(descriptor.isDirect, false);
  assert.equal(descriptor.conversationId, 'chat');
  assert.equal(descriptor.visibility, 'team');
  assert.match(descriptor.reason, /group membership/i);
});

test('Lark mention-only chat allowlist matches raw chat ids used by entry handlers', () => {
  const policy = createSecurityPolicy({
    securityProfile: 'team',
    securityProfileDefaults: {
      team: { mentionOnly: false, maxQueuePerChannel: 20 },
    },
    mentionOnlyChannelIds: new Set(['oc_chat']),
    conversationSecurityResolver: createLarkConversationSecurity(),
  });
  const context = policy.resolveSecurityContext({
    id: 'platform:v1:lark:tenant:oc_chat:',
    chatId: 'oc_chat',
    chatType: 'group',
    tenantId: 'tenant',
  });

  assert.equal(context.mentionOnly, true);
});
