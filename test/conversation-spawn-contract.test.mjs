import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertConversationHistory,
  assertConversationHistoryMessage,
  assertConversationSpawn,
  assertSpawnedConversation,
} from '../src/platforms/conversation-spawn.js';

function createConversationSpawn() {
  return {
    canSpawn() {},
    spawn() {},
    rename() {},
    remove() {},
    archive() {},
    send() {},
    listRecentMessages() {},
    splitText() {},
    createPromptMessage() {},
    formatUserMention() {},
    formatConversationReference() {},
  };
}

test('assertConversationSpawn accepts the complete conversation operations port', () => {
  const port = createConversationSpawn();
  assert.equal(assertConversationSpawn(port), port);
});

test('assertConversationSpawn rejects an incomplete port', () => {
  const port = createConversationSpawn();
  delete port.archive;
  assert.throws(() => assertConversationSpawn(port), /must provide archive\(\)/);
});

test('assertSpawnedConversation requires an id and raw platform target', () => {
  const conversation = { id: 'conversation-1', raw: { id: 'conversation-1' } };
  assert.equal(assertSpawnedConversation(conversation), conversation);
  assert.throws(() => assertSpawnedConversation({ id: 'conversation-1' }), /raw target/);
  assert.throws(() => assertSpawnedConversation({ id: '', raw: {} }), /id must be/);
});

test('conversation history contract requires platform-neutral actor metadata', () => {
  const message = {
    id: 'message-1',
    text: 'answer',
    createdAtMs: 123,
    actor: { id: 'bot-1', isBot: true, isCurrentBot: true },
  };

  assert.equal(assertConversationHistoryMessage(message), message);
  assert.deepEqual(assertConversationHistory([message]), [message]);
  assert.throws(
    () => assertConversationHistoryMessage({ ...message, actor: null }),
    /actor must be an object/,
  );
  assert.throws(
    () => assertConversationHistoryMessage({ ...message, actor: { id: 'bot-1', isBot: 'yes' } }),
    /actor\.isBot must be a boolean/,
  );
  assert.throws(
    () => assertConversationHistoryMessage({ ...message, actor: { id: 123, isBot: true } }),
    /actor\.id must be null or a non-empty string/,
  );
  assert.throws(() => assertConversationHistory({}), /must be an array/);
});
