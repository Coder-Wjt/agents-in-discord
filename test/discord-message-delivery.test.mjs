import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscordMessageDelivery } from '../src/platforms/discord/message-delivery.js';
import {
  createCommandActionRow,
  createCommandButton,
  createCommandMessageView,
} from '../src/platforms/command-view.js';
import { createDiscordCommandViewRenderer } from '../src/platforms/discord/command-view-renderer.js';

test('Discord message delivery delegates reply send edit split and mentions', async () => {
  const calls = [];
  const delivery = createDiscordMessageDelivery({
    reply: async (target, payload) => calls.push(['reply', target, payload]),
    send: async (target, payload) => calls.push(['send', target, payload]),
    edit: async (target, payload) => calls.push(['edit', target, payload]),
    splitText: (text, maxChars) => [`${text}:${maxChars}`],
  });
  const target = { id: 'message-1' };

  await delivery.reply(target, 'reply body');
  await delivery.send(target, 'send body');
  await delivery.edit(target, 'edit body');

  assert.deepEqual(calls, [
    ['reply', target, 'reply body'],
    ['send', target, 'send body'],
    ['edit', target, 'edit body'],
  ]);
  assert.deepEqual(delivery.splitText('body', 1900), ['body:1900']);
  assert.equal(delivery.formatUserMention('user-1'), '<@user-1>');
  assert.equal(delivery.formatUserMention(''), '');
});

test('Discord message delivery unwraps normalized interaction response targets', async () => {
  const calls = [];
  const responseTarget = { id: 'discord-interaction-1' };
  const interaction = {
    type: 'interaction',
    platformId: 'discord',
    responseTarget,
  };
  const delivery = createDiscordMessageDelivery({
    reply: async (target, payload) => calls.push(['reply', target, payload]),
    send: async (target, payload) => calls.push(['send', target, payload]),
    edit: async (target, payload) => calls.push(['edit', target, payload]),
  });

  await delivery.reply(interaction, 'reply body');
  await delivery.send(interaction, 'send body');
  await delivery.edit(interaction, 'edit body');

  assert.deepEqual(calls, [
    ['reply', responseTarget, 'reply body'],
    ['send', responseTarget, 'send body'],
    ['edit', responseTarget, 'edit body'],
  ]);
});

test('Discord message delivery owns typing lifecycle and semantic status reactions', async () => {
  const typingCalls = [];
  const intervals = [];
  const cleared = [];
  const reactions = [];
  const removals = [];
  const message = {
    client: { user: { id: 'bot-user' } },
    channel: {
      async sendTyping() {
        typingCalls.push('typing');
      },
    },
    reactions: {
      cache: new Map([['⚡', {
        users: {
          async remove(userId) {
            removals.push(userId);
          },
        },
      }]]),
    },
    async react(emoji) {
      reactions.push(emoji);
    },
  };
  const delivery = createDiscordMessageDelivery({
    setIntervalFn: (fn, ms) => {
      const timer = { fn, ms, unref() {} };
      intervals.push(timer);
      return timer;
    },
    clearIntervalFn: (timer) => cleared.push(timer),
  });

  const stopTyping = delivery.startTyping(message);
  await Promise.resolve();
  intervals[0].fn();
  await Promise.resolve();
  stopTyping();

  await delivery.setMessageStatus(message, 'processing');
  await delivery.setMessageStatus(message, 'succeeded');
  await delivery.setMessageStatus(message, 'dequeued');

  assert.deepEqual(typingCalls, ['typing', 'typing']);
  assert.equal(intervals[0].ms, 8000);
  assert.deepEqual(cleared, [intervals[0]]);
  assert.deepEqual(reactions, ['⚡', '✅', '🗑️']);
  assert.deepEqual(removals, ['bot-user', 'bot-user']);
});

test('Discord message delivery renders platform-neutral command message views', async () => {
  const calls = [];
  const delivery = createDiscordMessageDelivery({
    commandViewRenderer: createDiscordCommandViewRenderer(),
    reply: async (_target, payload) => calls.push(payload),
  });

  await delivery.reply({}, createCommandMessageView({
    content: 'Workspace busy',
    rows: [createCommandActionRow([
      createCommandButton({ id: 'workspace:isolate', label: 'Isolate' }),
    ])],
  }));

  assert.equal(calls[0].content, 'Workspace busy');
  assert.equal(calls[0].components[0].components[0].custom_id, 'workspace:isolate');
});
