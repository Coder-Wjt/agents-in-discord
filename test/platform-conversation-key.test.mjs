import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildConversationKey,
  parseConversationKey,
} from '../src/platforms/conversation-key.js';

test('platform conversation keys round-trip encoded identifiers', () => {
  const input = {
    platformId: 'slack',
    tenantId: 'T:example/team',
    conversationId: 'C 123',
    threadId: '1712345678.123456',
  };
  const key = buildConversationKey(input);

  assert.equal(
    key,
    'platform:v1:slack:T%3Aexample%2Fteam:C%20123:1712345678.123456',
  );
  assert.deepEqual(parseConversationKey(key), input);
});

test('platform conversation keys preserve absent optional identifiers', () => {
  const key = buildConversationKey({
    platformId: 'discord',
    conversationId: 'channel-1',
  });

  assert.equal(key, 'platform:v1:discord::channel-1:');
  assert.deepEqual(parseConversationKey(key), {
    platformId: 'discord',
    tenantId: null,
    conversationId: 'channel-1',
    threadId: null,
  });
});

test('platform conversation keys reject missing fields and invalid formats', () => {
  assert.throws(
    () => buildConversationKey({ platformId: 'discord' }),
    /conversationId must be a non-empty string/,
  );
  assert.throws(
    () => parseConversationKey('channel-1'),
    /Invalid platform conversation key/,
  );
  assert.throws(
    () => parseConversationKey('platform:v1:discord::%E0%A4%A:'),
    /Invalid platform conversation key encoding/,
  );
});
