import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeLarkCliMessageEvent } from '../src/lark-cli-channel.js';
import { createLarkEntryHandlers } from '../src/lark-entry-handlers.js';
import { createLarkCommandRegistryRenderer } from '../src/platforms/lark/command-registry-renderer.js';
import { createLarkInboundEventNormalizer } from '../src/platforms/lark/inbound-event.js';

function createMessage(content = 'hello', messageId = 'om_1') {
  return {
    messageId,
    chatId: 'oc_1',
    chatType: 'group',
    senderId: 'ou_1',
    senderName: 'User One',
    content,
    mentionedBot: true,
  };
}

function createInteractionResponse(responses = []) {
  return {
    respond: async (interaction, view) => responses.push({ interaction, view }),
    update: async () => {},
    showModal: async () => {},
    defer: async () => {},
  };
}

test('Lark entry handler routes prompts and text commands through shared core', async () => {
  const prompts = [];
  const commands = [];
  const normalizer = createLarkInboundEventNormalizer();
  const handler = createLarkEntryHandlers({
    accessPolicy: { isAllowedUser: () => true, isAllowedChannel: () => true },
    interactionResponse: createInteractionResponse(),
    messageDelivery: { reply: async () => {} },
    normalizeMessageEvent: normalizer.normalizeMessage,
    getSession: () => ({ provider: 'codex' }),
    resolveSecurityContext: () => ({ profile: 'team', mentionOnly: false }),
    handleCommand: async (_message, key, content) => commands.push({ key, content }),
    enqueuePrompt: async (_message, key, content) => prompts.push({ key, content }),
    logger: { log() {}, error() {} },
  });

  await handler.handleMessageCreate(createMessage('hello adapter'));
  await handler.handleMessageCreate(createMessage('!status', 'om_2'));

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].content, 'hello adapter');
  assert.equal(commands.length, 1);
  assert.equal(commands[0].content, '!status');
  assert.match(prompts[0].key, /^platform:v1:lark:/);
});

test('Lark CLI group mentions route text commands after bot mention stripping', async () => {
  const commands = [];
  const normalizer = createLarkInboundEventNormalizer();
  const handler = createLarkEntryHandlers({
    accessPolicy: { isAllowedUser: () => true, isAllowedChannel: () => true },
    interactionResponse: createInteractionResponse(),
    messageDelivery: { reply: async () => {} },
    normalizeMessageEvent: normalizer.normalizeMessage,
    getSession: () => ({ provider: 'codex' }),
    resolveSecurityContext: () => ({ profile: 'team', mentionOnly: true }),
    handleCommand: async (_message, key, content) => commands.push({ key, content }),
    enqueuePrompt: async () => assert.fail('mention command must not enter prompt routing'),
    logger: { log() {}, error() {} },
  });
  const message = normalizeLarkCliMessageEvent({
    message_id: 'om_status',
    chat_id: 'oc_group',
    chat_type: 'group',
    sender_id: 'ou_user',
    content: '<at user_id="ou_bot">Test Bot</at> !status',
    mentions: [{ id: 'ou_bot', name: 'Test Bot' }],
  }, { botOpenId: 'ou_bot' });

  await handler.handleMessageCreate(message);

  assert.equal(commands.length, 1);
  assert.equal(commands[0].content, '!status');
});

test('Lark entry handler routes registered native slash messages and leaves unknown paths as prompts', async () => {
  const prompts = [];
  const commands = [];
  const normalizer = createLarkInboundEventNormalizer();
  const handler = createLarkEntryHandlers({
    accessPolicy: { isAllowedUser: () => true, isAllowedChannel: () => true },
    interactionResponse: createInteractionResponse(),
    messageDelivery: { reply: async () => {} },
    normalizeMessageEvent: normalizer.normalizeMessage,
    getSession: () => ({ provider: 'codex' }),
    resolveSecurityContext: () => ({ profile: 'team', mentionOnly: true }),
    handleCommand: async (_message, key, content) => commands.push({ key, content }),
    enqueuePrompt: async (_message, key, content) => prompts.push({ key, content }),
    commandSpecs: [{ name: 'status', aliases: ['state'] }],
    commandRegistryRenderer: createLarkCommandRegistryRenderer({ slashPrefix: 'cx' }),
    logger: { log() {}, error() {} },
  });

  const slash = createMessage('/cx_state@sample_bot verbose', 'om_slash');
  slash.mentionedBot = false;
  await handler.handleMessageCreate(slash);
  await handler.handleMessageCreate(createMessage('/workspace/project', 'om_path'));

  assert.deepEqual(commands.map((item) => item.content), ['!state verbose']);
  assert.deepEqual(prompts.map((item) => item.content), ['/workspace/project']);
});

test('Lark entry handler drops retried message deliveries within the dedup window', async () => {
  let now = 1000;
  const prompts = [];
  const handler = createLarkEntryHandlers({
    accessPolicy: { isAllowedUser: () => true, isAllowedChannel: () => true },
    interactionResponse: createInteractionResponse(),
    messageDelivery: { reply: async () => {} },
    normalizeMessageEvent: createLarkInboundEventNormalizer().normalizeMessage,
    getSession: () => ({ provider: 'codex' }),
    resolveSecurityContext: () => ({ profile: 'team', mentionOnly: false }),
    handleCommand: async () => {},
    enqueuePrompt: async (_message, key, content) => prompts.push({ key, content }),
    eventDedupWindowMs: 1000,
    now: () => now,
    logger: { log() {}, debug() {}, error() {} },
  });

  await handler.handleMessageCreate(createMessage('retry me'));
  await handler.handleMessageCreate(createMessage('retry me'));
  assert.equal(prompts.length, 1);

  now += 1001;
  await handler.handleMessageCreate(createMessage('retry me'));
  assert.equal(prompts.length, 2);
});

test('Lark entry handler honors mention-only group policy', async () => {
  let promptCount = 0;
  const handler = createLarkEntryHandlers({
    accessPolicy: { isAllowedUser: () => true, isAllowedChannel: () => true },
    interactionResponse: createInteractionResponse(),
    messageDelivery: { reply: async () => {} },
    normalizeMessageEvent: createLarkInboundEventNormalizer().normalizeMessage,
    getSession: () => ({}),
    resolveSecurityContext: () => ({ profile: 'public', mentionOnly: true }),
    handleCommand: async () => {},
    enqueuePrompt: async () => { promptCount += 1; },
    logger: { log() {}, error() {} },
  });
  const message = createMessage('not for bot');
  message.mentionedBot = false;
  await handler.handleMessageCreate(message);
  assert.equal(promptCount, 0);
});

test('Lark entry handler routes card buttons and selects through shared component handlers', async () => {
  const routes = [];
  const responses = [];
  const normalizer = createLarkInboundEventNormalizer();
  const handler = createLarkEntryHandlers({
    accessPolicy: {
      isAllowedUser: () => true,
      isAllowedChannel: () => true,
      isAllowedInteractionChannel: async () => true,
    },
    interactionResponse: createInteractionResponse(responses),
    messageDelivery: { reply: async () => {} },
    normalizeMessageEvent: normalizer.normalizeMessage,
    normalizeInteractionEvent: normalizer.normalizeInteraction,
    getSession: () => ({}),
    resolveSecurityContext: () => ({ profile: 'team', mentionOnly: false }),
    handleCommand: async () => {},
    enqueuePrompt: async () => {},
    isSettingsPanelComponentId: (id) => id.startsWith('settings:'),
    handleSettingsPanelInteraction: async (event) => routes.push({
      kind: event.kind,
      id: event.component.id,
      values: event.component.values,
    }),
    logger: { log() {}, error() {} },
  });

  await handler.handleInteractionCreate({
    messageId: 'om_card',
    chatId: 'oc_1',
    actorId: 'ou_1',
    action: { tag: 'button', value: { id: 'settings:open' } },
  });
  await handler.handleInteractionCreate({
    messageId: 'om_card',
    chatId: 'oc_1',
    actorId: 'ou_1',
    action: { tag: 'select_static', value: { id: 'settings:model' }, option: 'gpt-5.6' },
  });

  assert.deepEqual(routes, [
    { kind: 'button', id: 'settings:open', values: [] },
    { kind: 'select', id: 'settings:model', values: ['gpt-5.6'] },
  ]);
  assert.deepEqual(responses, []);
});

test('Lark entry handler routes card form submits through shared modal handlers', async () => {
  const routes = [];
  const normalizer = createLarkInboundEventNormalizer();
  const handler = createLarkEntryHandlers({
    accessPolicy: {
      isAllowedUser: () => true,
      isAllowedChannel: () => true,
      isAllowedInteractionChannel: async () => true,
    },
    interactionResponse: createInteractionResponse(),
    messageDelivery: { reply: async () => {} },
    normalizeMessageEvent: normalizer.normalizeMessage,
    normalizeInteractionEvent: normalizer.normalizeInteraction,
    getSession: () => ({}),
    resolveSecurityContext: () => ({ profile: 'team', mentionOnly: false }),
    handleCommand: async () => {},
    enqueuePrompt: async () => {},
    isSettingsPanelModalId: (id) => id.startsWith('stgm:'),
    handleSettingsPanelModalSubmit: async (event) => routes.push({
      kind: event.kind,
      id: event.modal.id,
      value: event.modal.getField('model_name'),
    }),
    logger: { log() {}, error() {} },
  });

  await handler.handleInteractionCreate({
    messageId: 'om_card',
    chatId: 'oc_1',
    actorId: 'ou_user',
    action: {
      tag: 'button',
      name: 'aid_modal_submit:stgm:model:ou_user',
      formValue: { model_name: 'gpt-5.6' },
    },
  });

  assert.deepEqual(routes, [{
    kind: 'modal',
    id: 'stgm:model:ou_user',
    value: 'gpt-5.6',
  }]);
});

test('Lark entry handler deduplicates card actions and bot-menu retries by event id', async () => {
  let actionCount = 0;
  let menuCount = 0;
  let menuSendCount = 0;
  const normalizer = createLarkInboundEventNormalizer();
  const handler = createLarkEntryHandlers({
    accessPolicy: {
      isAllowedUser: () => true,
      isAllowedChannel: () => true,
      isAllowedInteractionChannel: async () => true,
    },
    interactionResponse: createInteractionResponse(),
    messageDelivery: {
      reply: async () => {},
      async send() {
        menuSendCount += 1;
        return { messageId: `om_menu_${menuSendCount}`, chatId: 'oc_dm' };
      },
    },
    normalizeMessageEvent: normalizer.normalizeMessage,
    normalizeInteractionEvent: normalizer.normalizeInteraction,
    getSession: () => ({}),
    resolveSecurityContext: () => ({ profile: 'team', mentionOnly: false }),
    handleCommand: async () => {},
    enqueuePrompt: async () => {},
    isSettingsPanelComponentId: (id) => id === 'settings:open',
    handleSettingsPanelInteraction: async () => { actionCount += 1; },
    routeSlashCommand: async ({ commandName }) => {
      if (commandName === 'status') menuCount += 1;
      return true;
    },
    logger: { log() {}, debug() {}, error() {} },
  });

  const action = {
    event_id: 'evt_action_1',
    messageId: 'om_card',
    chatId: 'oc_1',
    actorId: 'ou_1',
    action: { tag: 'button', value: { id: 'settings:open' } },
  };
  await handler.handleInteractionCreate(action);
  await handler.handleInteractionCreate(action);
  await handler.handleInteractionCreate({ ...action, event_id: 'evt_action_2' });
  assert.equal(actionCount, 2);

  const menu = {
    id: 'evt_menu_1',
    eventKey: 'status',
    actorId: 'ou_1',
    actorName: 'User One',
    raw: { event_id: 'evt_menu_1' },
  };
  await handler.handleBotMenu(menu);
  await handler.handleBotMenu(menu);
  await handler.handleBotMenu({
    ...menu,
    id: 'evt_menu_2',
    raw: { event_id: 'evt_menu_2' },
  });
  assert.equal(menuCount, 2);
  assert.equal(menuSendCount, 2);
});
