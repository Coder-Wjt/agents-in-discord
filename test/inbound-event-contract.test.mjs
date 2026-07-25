import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  assertInboundInteractionEvent,
  assertInboundEventNormalizer,
  assertInboundMessageEvent,
  createInboundMessageContext,
  getInboundActorId,
  getInboundInteractionField,
  getInboundInteractionOption,
  getInboundMessageActorId,
  getInboundMessageAttachments,
  getInboundMessageConversation,
  getInboundMessageConversationId,
  getInboundMessageConversationTarget,
  getInboundMessageReplyToMessageId,
} from '../src/platforms/inbound-event.js';

test('assertInboundMessageEvent accepts a normalized message envelope', () => {
  const event = {
    type: 'message',
    platformId: 'example',
    id: 'message-1',
    actor: { id: 'user-1', displayName: 'User', isBot: false },
    conversation: { id: 'conversation-1', tenantId: null, parentId: null, isThread: false },
    rawText: 'hello',
    text: 'hello',
    attachments: [],
    isSystem: false,
    targetsBot: true,
    raw: {},
  };

  assert.equal(assertInboundMessageEvent(event), event);
  assert.equal(
    assertInboundEventNormalizer({ normalizeMessage() {}, normalizeInteraction() {} }).normalizeMessage instanceof Function,
    true,
  );

  const raw = {
    channel: { id: 'raw-channel' },
    author: { id: 'raw-user' },
    reference: { messageId: 'raw-parent-message' },
  };
  const contextEvent = { ...event, raw: null };
  const context = createInboundMessageContext(contextEvent, { fallbackRaw: raw });
  assert.equal(context.responseTarget, raw);
  assert.equal(context.channel, raw.channel);
  assert.deepEqual(context.author, {
    id: 'user-1',
    displayName: 'User',
    bot: false,
    raw: raw.author,
  });
  assert.equal(context.attachments, event.attachments);
  assert.equal(context.replyToMessageId, 'raw-parent-message');
  assert.equal(context.inboundEvent, contextEvent);
});

test('inbound message accessors prefer normalized context and retain raw compatibility fallbacks', () => {
  const conversationTarget = { id: 'normalized-target' };
  const attachments = [{
    id: 'attachment-1',
    name: 'report.txt',
    mimeType: 'text/plain',
    sizeBytes: 12,
    url: 'https://example.com/report.txt',
  }];
  const event = {
    type: 'message',
    platformId: 'example',
    id: 'message-2',
    actor: { id: 'normalized-user', displayName: 'User', isBot: false },
    conversation: {
      id: 'normalized-conversation',
      tenantId: 'tenant-1',
      parentId: null,
      isThread: false,
      raw: conversationTarget,
    },
    rawText: 'hello',
    text: 'hello',
    attachments,
    replyToMessageId: 'parent-message-1',
    isSystem: false,
    targetsBot: false,
    raw: null,
  };
  const context = createInboundMessageContext(event);

  for (const message of [event, context]) {
    assert.equal(getInboundMessageActorId(message), 'normalized-user');
    assert.equal(getInboundMessageConversation(message), event.conversation);
    assert.equal(getInboundMessageConversationId(message), 'normalized-conversation');
    assert.equal(getInboundMessageConversationTarget(message), conversationTarget);
    assert.equal(getInboundMessageAttachments(message), attachments);
    assert.equal(getInboundMessageReplyToMessageId(message), 'parent-message-1');
  }

  assert.equal(context.author.id, 'normalized-user');
  assert.equal(context.channelId, 'normalized-conversation');
  assert.equal(context.channel, conversationTarget);
  assert.equal(context.replyToMessageId, 'parent-message-1');

  const rawAttachments = new Map([['raw-1', { id: 'raw-1' }]]);
  const rawMessage = {
    author: { id: 'raw-user' },
    channel: { id: 'raw-channel' },
    attachments: rawAttachments,
    reference: { message_id: 'raw-parent-message' },
  };
  assert.equal(getInboundMessageActorId(rawMessage), 'raw-user');
  assert.equal(getInboundMessageConversation(rawMessage), null);
  assert.equal(getInboundMessageConversationId(rawMessage), 'raw-channel');
  assert.equal(getInboundMessageConversationTarget(rawMessage), rawMessage.channel);
  assert.deepEqual(getInboundMessageAttachments(rawMessage), [{ id: 'raw-1' }]);
  assert.equal(getInboundMessageReplyToMessageId(rawMessage), 'raw-parent-message');
  assert.equal(getInboundActorId({ user: { id: 'raw-interaction-user' } }), 'raw-interaction-user');
});

test('assertInboundInteractionEvent accepts normalized command and modal envelopes', () => {
  const command = {
    type: 'interaction',
    kind: 'command',
    platformId: 'example',
    id: 'interaction-1',
    actor: { id: 'user-1', displayName: 'User' },
    conversation: { id: 'conversation-1', parentId: null, isThread: false, raw: {} },
    command: {
      name: 'status',
      getOption: (name) => (name === 'mode' ? 'safe' : null),
    },
    component: null,
    modal: null,
    responseTarget: {},
    raw: {},
  };
  const modal = {
    ...command,
    kind: 'modal',
    command: null,
    modal: {
      id: 'settings:model',
      getField: (name) => (name === 'model' ? 'gpt-5.4' : ''),
    },
  };

  assert.equal(assertInboundInteractionEvent(command), command);
  assert.equal(getInboundInteractionOption(command, 'mode'), 'safe');
  assert.equal(assertInboundInteractionEvent(modal), modal);
  assert.equal(getInboundInteractionField(modal, 'model'), 'gpt-5.4');
});

test('inbound event contracts reject incomplete implementations', () => {
  assert.throws(
    () => assertInboundMessageEvent({ type: 'message', platformId: 'example' }),
    /id must be a non-empty string/,
  );
  assert.throws(
    () => assertInboundEventNormalizer({}),
    /must provide normalizeMessage\(\)/,
  );
  assert.throws(
    () => assertInboundEventNormalizer({ normalizeMessage() {} }),
    /must provide normalizeInteraction\(\)/,
  );
  const messageEvent = {
    type: 'message',
    platformId: 'example',
    id: 'message-1',
    actor: { id: 'user-1' },
    conversation: { id: 'conversation-1', parentId: null, isThread: false },
    rawText: '',
    text: '',
    attachments: [],
    isSystem: false,
    targetsBot: false,
  };
  assert.equal(assertInboundMessageEvent({ ...messageEvent, replyToMessageId: null }).replyToMessageId, null);
  assert.equal(assertInboundMessageEvent({ ...messageEvent, replyToMessageId: 'parent-1' }).replyToMessageId, 'parent-1');
  assert.throws(
    () => assertInboundMessageEvent({ ...messageEvent, replyToMessageId: '  ' }),
    /replyToMessageId must be null or a non-empty string/,
  );
  assert.throws(
    () => assertInboundMessageEvent({ ...messageEvent, replyToMessageId: 123 }),
    /replyToMessageId must be null or a non-empty string/,
  );
  assert.throws(
    () => assertInboundInteractionEvent({
      type: 'interaction',
      kind: 'command',
      platformId: 'example',
      id: 'interaction-1',
      actor: { id: 'user-1' },
      conversation: { id: 'conversation-1', parentId: null, isThread: false },
      command: { name: 'status' },
    }),
    /must provide command\.getOption\(\)/,
  );
  assert.throws(
    () => assertInboundInteractionEvent({
      type: 'interaction',
      kind: 'unknown',
      platformId: 'example',
      id: 'interaction-2',
      actor: { id: 'user-1' },
      conversation: { id: 'conversation-1', parentId: null },
    }),
    /conversation\.isThread must be a boolean/,
  );
});

test('session topology core does not inspect Discord channel thread APIs', async () => {
  const source = await readFile(new URL('../src/session-store.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /\.isThread\s*\(/);
  assert.doesNotMatch(source, /channel\.parentId/);
  assert.match(source, /conversation\.isThread !== true/);
  assert.match(source, /conversation\.parentId/);
});
