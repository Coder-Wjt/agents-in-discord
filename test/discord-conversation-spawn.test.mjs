import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscordConversationSpawn } from '../src/platforms/discord/conversation-spawn.js';

test('Discord conversation spawn creates and joins a thread through normalized source data', async () => {
  const creates = [];
  let joins = 0;
  const thread = {
    id: 'thread-1',
    async join() {
      joins += 1;
    },
  };
  const port = createDiscordConversationSpawn();
  const source = {
    conversation: {
      id: 'channel-1',
      raw: {
        threads: {
          async create(options) {
            creates.push(options);
            return thread;
          },
        },
      },
    },
  };

  assert.equal(port.canSpawn(source), true);
  const conversation = await port.spawn(source, { name: 'fork demo', reason: 'fork reason' });

  assert.deepEqual(conversation, { id: 'thread-1', raw: thread });
  assert.deepEqual(creates, [{
    name: 'fork demo',
    autoArchiveDuration: 1440,
    reason: 'fork reason',
  }]);
  assert.equal(joins, 1);
});

test('Discord conversation spawn owns mentions, sends, history normalization and prompt messages', async () => {
  const sent = [];
  const fetched = [];
  const thread = {
    id: 'thread-1',
    async send(payload) {
      sent.push(payload);
      return { id: `sent-${sent.length}` };
    },
  };
  const source = {
    id: 'source-2',
    actor: { id: 'user-1', raw: { id: 'user-1' } },
    conversation: {
      id: 'channel-1',
      raw: {
        client: { user: { id: 'bot-1' } },
        messages: {
          async fetch(options) {
            fetched.push(options);
            return new Map([['message-1', {
              id: 'message-1',
              content: ' answer ',
              createdTimestamp: 123,
              author: { id: 'bot-1', bot: true },
            }]]);
          },
        },
      },
    },
  };
  const port = createDiscordConversationSpawn({ splitText: (text, maxChars) => [`${maxChars}:${text}`] });
  const conversation = { id: 'thread-1', raw: thread };

  await port.send(conversation, { content: 'hello', mentionUserIds: ['user-1', 'user-1'] });
  const messages = await port.listRecentMessages(source, { beforeId: 'source-2', limit: 10 });
  const promptMessage = port.createPromptMessage(source, conversation);
  await promptMessage.responseTarget.reply({ content: 'reply' });

  assert.deepEqual(sent, [
    { content: 'hello', allowedMentions: { users: ['user-1'] } },
    { content: 'reply' },
  ]);
  assert.deepEqual(fetched, [{ before: 'source-2', limit: 10 }]);
  assert.deepEqual(messages[0].actor, { id: 'bot-1', isBot: true, isCurrentBot: true });
  assert.equal('author' in messages[0], false);
  assert.equal(messages[0].text, 'answer');
  assert.equal(promptMessage.responseTarget.channel, thread);
  assert.deepEqual(promptMessage.actor, {
    id: 'user-1',
    displayName: 'user-1',
    isBot: false,
    raw: source.actor.raw,
  });
  assert.deepEqual(promptMessage.conversation, {
    id: 'thread-1',
    tenantId: null,
    parentId: 'channel-1',
    isThread: true,
    raw: thread,
  });
  assert.deepEqual(promptMessage.attachments, []);
  assert.equal(port.formatUserMention('user-1'), '<@user-1>');
  assert.equal(port.formatConversationReference('thread-1'), '<#thread-1>');
  assert.deepEqual(port.splitText('body', 1900), ['1900:body']);
});

test('Discord conversation spawn can route synthetic prompt replies through delivery', async () => {
  const delivered = [];
  const source = {
    id: 'interaction-1',
    actor: { id: 'user-1', displayName: 'User', isBot: false },
    conversation: { id: 'channel-1', parentId: null, isThread: false, raw: { id: 'channel-1' } },
  };
  const port = createDiscordConversationSpawn();
  const promptMessage = port.createPromptMessage(source, source.conversation, {
    reply: async (replySource, payload) => {
      delivered.push({ replySource, payload });
      return { id: 'delivered-1' };
    },
  });

  assert.deepEqual(await promptMessage.responseTarget.reply({ content: 'done' }), { id: 'delivered-1' });
  assert.deepEqual(delivered, [{ replySource: source, payload: { content: 'done' } }]);
  assert.equal(promptMessage.conversation.isThread, false);
  assert.equal(promptMessage.conversation.parentId, null);
});

test('Discord conversation spawn owns rename, removal, lock and archive operations', async () => {
  const calls = [];
  const thread = {
    id: 'thread-1',
    async setName(name, reason) {
      calls.push(['rename', name, reason]);
    },
    async delete(reason) {
      calls.push(['remove', reason]);
    },
    async setLocked(value, reason) {
      calls.push(['lock', value, reason]);
    },
    async setArchived(value, reason) {
      calls.push(['archive', value, reason]);
    },
  };
  const source = {
    conversation: {
      id: 'parent-1',
      raw: {
        id: 'parent-1',
        client: {
          channels: {
            cache: new Map([['thread-1', thread]]),
          },
        },
      },
    },
  };
  const port = createDiscordConversationSpawn();
  const conversation = { id: 'thread-1', raw: thread };

  assert.deepEqual(await port.rename(conversation, { name: 'renamed', reason: 'rename reason' }), { ok: true, renamed: true });
  assert.deepEqual(await port.remove(conversation, { reason: 'remove reason' }), {
    ok: true,
    removed: true,
    deleted: true,
  });
  const archived = await port.archive(source, { conversationId: 'thread-1', reason: 'close reason' });

  assert.deepEqual(calls, [
    ['rename', 'renamed', 'rename reason'],
    ['remove', 'remove reason'],
    ['lock', true, 'close reason'],
    ['archive', true, 'close reason'],
  ]);
  assert.deepEqual(archived, {
    ok: true,
    archived: true,
    locked: true,
    targetLabel: 'Discord thread',
    error: '',
  });
});
