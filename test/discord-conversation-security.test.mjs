import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscordConversationSecurity } from '../src/platforms/discord/conversation-security.js';

function createGuildChannel({ id = 'channel-1', guildId = 'guild-1', canView = false } = {}) {
  const everyone = { id: 'everyone' };
  return {
    id,
    guild: {
      id: guildId,
      roles: { everyone },
    },
    permissionsFor(role) {
      assert.equal(role, everyone);
      return {
        has(flag, checkAdmin) {
          assert.equal(flag, 'VIEW');
          assert.equal(checkAdmin, true);
          return canView;
        },
      };
    },
  };
}

test('Discord conversation security maps DM and guild visibility', () => {
  const resolver = createDiscordConversationSecurity({
    permissionFlagsBits: { ViewChannel: 'VIEW' },
  });

  assert.deepEqual(resolver.resolve({
    id: 'dm-1',
    isDMBased: () => true,
  }), {
    conversationId: 'dm-1',
    parentConversationId: null,
    tenantId: null,
    available: true,
    isDirect: true,
    visibility: 'unknown',
    reason: 'dm channel',
  });
  assert.equal(resolver.resolve(createGuildChannel({ canView: true })).visibility, 'public');
  assert.equal(resolver.resolve(createGuildChannel({ canView: false })).visibility, 'team');
});

test('Discord conversation security resolves thread parent and normalized identifiers', () => {
  const resolver = createDiscordConversationSecurity({
    permissionFlagsBits: { ViewChannel: 'VIEW' },
  });
  const parent = createGuildChannel({ id: 'channel-1', guildId: 'guild-1', canView: false });
  const thread = {
    id: 'thread-1',
    parentId: 'channel-1',
    parent,
    isThread: () => true,
  };

  assert.deepEqual(resolver.resolve({
    conversation: {
      id: 'normalized-thread',
      parentId: 'normalized-parent',
      tenantId: 'normalized-tenant',
      raw: thread,
    },
  }), {
    conversationId: 'normalized-thread',
    parentConversationId: 'normalized-parent',
    tenantId: 'normalized-tenant',
    available: true,
    isDirect: false,
    visibility: 'team',
    reason: '@everyone cannot view channel',
  });
});
