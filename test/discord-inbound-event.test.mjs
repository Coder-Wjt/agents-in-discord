import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscordInboundEventNormalizer } from '../src/platforms/discord/inbound-event.js';

test('Discord inbound normalizer maps message actor conversation text and attachments', () => {
  const attachment = {
    id: 'attachment-1',
    name: 'report.txt',
    contentType: 'text/plain',
    size: 12,
    url: 'https://example.com/report.txt',
  };
  const message = {
    id: 'message-1',
    content: '<@123>  hello world  ',
    system: false,
    guildId: 'guild-1',
    author: { id: 'user-1', tag: 'demo#0001', bot: false },
    channel: {
      id: 'thread-1',
      parentId: 'channel-1',
      isThread: () => true,
    },
    attachments: new Map([['attachment-1', attachment]]),
    reference: { messageId: 'parent-message-1' },
    mentions: {
      users: { has: (id) => id === '123' },
      repliedUser: null,
    },
  };

  const event = createDiscordInboundEventNormalizer().normalizeMessage(message, {
    botUserId: '123',
  });

  assert.equal(event.platformId, 'discord');
  assert.deepEqual(event.actor, {
    id: 'user-1',
    displayName: 'demo#0001',
    isBot: false,
    raw: message.author,
  });
  assert.deepEqual(event.conversation, {
    id: 'thread-1',
    tenantId: 'guild-1',
    parentId: 'channel-1',
    isThread: true,
    raw: message.channel,
  });
  assert.equal(event.rawText, '<@123>  hello world  ');
  assert.equal(event.text, 'hello world');
  assert.equal(event.targetsBot, true);
  assert.equal(event.replyToMessageId, 'parent-message-1');
  assert.deepEqual(event.attachments[0], {
    id: 'attachment-1',
    name: 'report.txt',
    mimeType: 'text/plain',
    sizeBytes: 12,
    url: 'https://example.com/report.txt',
    raw: attachment,
  });
  assert.equal(event.raw, message);
});

test('Discord inbound normalizer maps slash command identity, context, and option access', () => {
  const interaction = {
    id: 'interaction-1',
    commandName: 'cx_goal',
    channelId: 'thread-1',
    guildId: 'guild-1',
    user: { id: 'user-1', tag: 'demo#0001' },
    channel: {
      id: 'thread-1',
      parentId: 'channel-1',
      isThread: () => true,
    },
    options: {
      getString(name) {
        return name === 'action' ? 'status' : null;
      },
    },
    isChatInputCommand: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
  };

  const event = createDiscordInboundEventNormalizer().normalizeInteraction(interaction);

  assert.equal(event.kind, 'command');
  assert.equal(event.command.name, 'cx_goal');
  assert.equal(event.command.getOption('action'), 'status');
  assert.deepEqual(event.actor.id, 'user-1');
  assert.deepEqual(event.conversation, {
    id: 'thread-1',
    tenantId: 'guild-1',
    parentId: 'channel-1',
    isThread: true,
    raw: interaction.channel,
  });
  assert.equal(event.responseTarget, interaction);
  assert.equal(event.raw, interaction);
});

test('Discord inbound normalizer maps component values and modal fields', () => {
  const normalizer = createDiscordInboundEventNormalizer();
  const base = {
    id: 'interaction-2',
    channelId: 'channel-1',
    user: { id: 'user-1' },
    channel: { id: 'channel-1', isThread: () => false },
    isChatInputCommand: () => false,
  };
  const select = {
    ...base,
    customId: 'settings:section',
    values: ['model'],
    isButton: () => false,
    isStringSelectMenu: () => true,
    isModalSubmit: () => false,
  };
  const modal = {
    ...base,
    id: 'interaction-3',
    customId: 'settings:model',
    fields: {
      getTextInputValue: (name) => (name === 'model' ? 'gpt-5.4' : ''),
    },
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => true,
  };

  const selectEvent = normalizer.normalizeInteraction(select);
  const modalEvent = normalizer.normalizeInteraction(modal);

  assert.deepEqual(selectEvent.component, {
    id: 'settings:section',
    values: ['model'],
  });
  assert.equal(modalEvent.modal.id, 'settings:model');
  assert.equal(modalEvent.modal.getField('model'), 'gpt-5.4');
});
