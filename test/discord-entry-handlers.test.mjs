import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscordEntryHandlers } from '../src/discord-entry-handlers.js';
import { createDiscordCommandViewRenderer } from '../src/platforms/discord/command-view-renderer.js';
import { createDiscordInboundEventNormalizer } from '../src/platforms/discord/inbound-event.js';
import { createDiscordInteractionResponse } from '../src/platforms/discord/interaction-response.js';

function createLogger() {
  return {
    log() {},
    warn() {},
    error() {},
  };
}

function createHarness(overrides = {}) {
  const calls = {
    registerSlashCommands: [],
    enqueuePrompt: [],
    handleCommand: [],
    logs: [],
    routeSlashCommand: [],
    retries: [],
    workspaceBusy: 0,
    workspaceBrowser: 0,
    onboarding: 0,
    settingsPanel: 0,
    settingsModal: 0,
    goalModal: 0,
    getSession: [],
  };
  const logger = {
    log: (...args) => calls.logs.push(['log', ...args]),
    warn: (...args) => calls.logs.push(['warn', ...args]),
    error: (...args) => calls.logs.push(['error', ...args]),
  };
  const withDiscordNetworkRetry = async (fn, options = {}) => {
    calls.retries.push(options);
    return fn();
  };
  const interactionResponse = createDiscordInteractionResponse({
    commandViewRenderer: createDiscordCommandViewRenderer(),
    logger,
    withDiscordNetworkRetry,
  });
  const commandRegistryRenderer = {
    renderCommands() {},
    formatCommandName: (name) => name,
    normalizeCommandName: (name) => name,
    formatCommandReference: (name) => `/${name}`,
  };
  const commandSpecs = [{ name: 'status' }];
  const inboundEventNormalizer = createDiscordInboundEventNormalizer();

  const handlers = createDiscordEntryHandlers({
    logger,
    registerCommands: async (payload) => {
      calls.registerSlashCommands.push(payload);
    },
    REST: { name: 'REST' },
    Routes: { name: 'Routes' },
    discordToken: 'token',
    restProxyAgent: { name: 'agent' },
    commandSpecs,
    commandRegistryRenderer,
    normalizeMessageEvent: (message, options) => inboundEventNormalizer.normalizeMessage(message, options),
    normalizeInteractionEvent: (interaction) => {
      interaction.id ||= 'interaction-test';
      interaction.channelId ||= interaction.channel?.id || 'channel-test';
      return inboundEventNormalizer.normalizeInteraction(interaction);
    },
    withDiscordNetworkRetry,
    interactionResponse,
    safeReply: async () => {},
    safeError: (err) => err?.message || String(err),
    isIgnorableDiscordRuntimeError: (err) => Number(err?.code) === 10062,
    isRecoverableGatewayCloseCode: (code) => Number(code) !== 4004,
    accessPolicy: {
      isAllowedUser: () => true,
      isAllowedChannel: () => true,
      isAllowedInteractionChannel: async () => true,
    },
    getSession: (...args) => {
      calls.getSession.push(args);
      return { id: 'sess-1' };
    },
    resolveSecurityContext: () => ({ profile: 'team', mentionOnly: false }),
    handleCommand: async (...args) => {
      calls.handleCommand.push(args);
    },
    enqueuePrompt: async (...args) => {
      calls.enqueuePrompt.push(args);
    },
    messageInput: {
      doesMessageTargetBot: () => false,
      buildPromptFromMessage: (text) => text,
    },
    parseCommandActionButtonId: () => null,
    isWorkspaceBusyComponentId: () => false,
    isWorkspaceBrowserComponentId: () => false,
    isOnboardingButtonId: () => false,
    isSettingsPanelComponentId: () => false,
    isSettingsPanelModalId: () => false,
    isGoalModalId: () => false,
    handleWorkspaceBusyInteraction: async () => {
      calls.workspaceBusy = (calls.workspaceBusy || 0) + 1;
    },
    handleWorkspaceBrowserInteraction: async () => {
      calls.workspaceBrowser += 1;
    },
    handleOnboardingButtonInteraction: async () => {
      calls.onboarding += 1;
    },
    handleSettingsPanelInteraction: async () => {
      calls.settingsPanel += 1;
    },
    handleSettingsPanelModalSubmit: async () => {
      calls.settingsModal += 1;
    },
    handleGoalModalSubmit: async () => {
      calls.goalModal += 1;
    },
    routeSlashCommand: async (payload) => {
      calls.routeSlashCommand.push(payload);
      return false;
    },
    normalizeSlashCommandName: (name) => `norm:${name}`,
    ...overrides,
  });

  return { handlers, calls, commandSpecs, commandRegistryRenderer };
}

test('sendInteractionResponse edits deferred replies and strips rendered visibility flags', async () => {
  const { handlers } = createHarness();
  const edits = [];
  const interaction = {
    deferred: true,
    replied: false,
    async editReply(payload) {
      edits.push(payload);
    },
  };

  await handlers.sendInteractionResponse(interaction, { content: 'hello', visibility: 'ephemeral' });

  assert.deepEqual(edits, [{ content: 'hello', components: [] }]);
});

test('handleInteractionCreate rejects command button clicks from other users', async () => {
  const { handlers } = createHarness({
    parseCommandActionButtonId: () => ({ command: 'status', userId: 'owner-1' }),
  });
  const replies = [];
  const interaction = {
    customId: 'command:status',
    user: { id: 'guest-2' },
    isButton: () => true,
    isStringSelectMenu: () => false,
    isChatInputCommand: () => false,
    async reply(payload) {
      replies.push(payload);
    },
  };

  await handlers.handleInteractionCreate(interaction);

  assert.deepEqual(replies, [{
    content: '⛔ 这组快捷按钮属于发起命令的用户。',
    components: [],
    flags: 64,
  }]);
});

test('handleInteractionCreate routes settings panel component interactions', async () => {
  const { handlers, calls } = createHarness({
    isSettingsPanelComponentId: () => true,
  });
  const interaction = {
    customId: 'stg:nav:overview:_:12345',
    user: { id: '12345' },
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    isChatInputCommand: () => false,
    async reply() {},
  };

  await handlers.handleInteractionCreate(interaction);

  assert.equal(calls.settingsPanel, 1);
  assert.equal(calls.workspaceBrowser, 0);
  assert.equal(calls.onboarding, 0);
});

test('handleInteractionCreate routes workspace busy action buttons', async () => {
  const { handlers, calls } = createHarness({
    isWorkspaceBusyComponentId: () => true,
  });
  const interaction = {
    customId: 'wbusy:isolate:12345',
    user: { id: '12345' },
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    isChatInputCommand: () => false,
    async reply() {},
  };

  await handlers.handleInteractionCreate(interaction);

  assert.equal(calls.workspaceBusy, 1);
  assert.equal(calls.workspaceBrowser, 0);
});

test('handleInteractionCreate routes settings panel modal submits', async () => {
  const { handlers, calls } = createHarness({
    isSettingsPanelModalId: () => true,
  });
  const interaction = {
    customId: 'stgm:model:12345',
    user: { id: '12345' },
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => true,
    isChatInputCommand: () => false,
    async reply() {},
  };

  await handlers.handleInteractionCreate(interaction);

  assert.equal(calls.settingsModal, 1);
});

test('handleInteractionCreate routes goal modal submits', async () => {
  const { handlers, calls } = createHarness({
    isGoalModalId: () => true,
  });
  const interaction = {
    customId: 'goalm:set:12345',
    user: { id: '12345' },
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => true,
    isChatInputCommand: () => false,
    async reply() {},
  };

  await handlers.handleInteractionCreate(interaction);

  assert.equal(calls.goalModal, 1);
  assert.equal(calls.settingsModal, 0);
});

test('handleInteractionCreate defers chat commands and reports unknown commands via editReply', async () => {
  const { handlers, calls } = createHarness();
  const defers = [];
  const edits = [];
  const interaction = {
    commandName: 'ping',
    user: { id: 'user-1' },
    deferred: true,
    replied: false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isChatInputCommand: () => true,
    async deferReply(payload) {
      defers.push(payload);
    },
    async editReply(payload) {
      edits.push(payload);
    },
    async reply() {
      throw new Error('unexpected reply');
    },
    async followUp() {
      throw new Error('unexpected followUp');
    },
  };

  await handlers.handleInteractionCreate(interaction);

  assert.deepEqual(defers, [{ flags: 64 }]);
  assert.equal(calls.routeSlashCommand.length, 1);
  assert.equal(calls.routeSlashCommand[0].commandName, 'norm:ping');
  assert.deepEqual(edits, [{ content: '❌ 未知命令：`ping`', components: [] }]);
  assert.equal(calls.retries[0].label, 'interaction:ping deferReply');
  assert.equal(calls.retries[1].label, 'interaction:ping editReply');
});

test('handleInteractionCreate retries deferReply before routing slash command', async () => {
  const { handlers, calls } = createHarness();
  let attempts = 0;
  const interaction = {
    commandName: 'status',
    user: { id: 'user-1', tag: 'demo#0001' },
    deferred: false,
    replied: false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isChatInputCommand: () => true,
    async deferReply() {
      attempts += 1;
      this.deferred = true;
    },
    async editReply() {},
    async reply() {},
    async followUp() {},
  };

  await handlers.handleInteractionCreate(interaction);

  assert.equal(attempts, 1);
  assert.equal(calls.routeSlashCommand.length, 1);
  assert.equal(calls.logs[0][1], '[interaction] kind=chat-input cmd=status user=demo#0001 channel=channel-test');
  assert.equal(calls.retries[0].baseDelayMs, 75);
});

test('handleInteractionCreate can route modal-first slash commands without deferring', async () => {
  const { handlers, calls } = createHarness({
    shouldDeferInteraction: () => false,
    routeSlashCommand: async (payload) => {
      calls.routeSlashCommand.push(payload);
      return true;
    },
  });
  const defers = [];
  const interaction = {
    commandName: 'goal',
    user: { id: 'user-1', tag: 'demo#0001' },
    deferred: false,
    replied: false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isChatInputCommand: () => true,
    async deferReply(payload) {
      defers.push(payload);
    },
    async editReply() {},
    async reply() {},
    async followUp() {},
  };

  await handlers.handleInteractionCreate(interaction);

  assert.deepEqual(defers, []);
  assert.equal(calls.routeSlashCommand.length, 1);
  assert.equal(calls.routeSlashCommand[0].commandName, 'norm:goal');
});

test('handleInteractionCreate posts a channel fallback notice when slash acknowledgement expires', async () => {
  const { handlers, calls } = createHarness();
  const channelSends = [];
  const interaction = {
    commandName: 'resume',
    user: { id: 'user-1', tag: 'demo#0001' },
    channel: {
      async send(payload) {
        channelSends.push(payload);
      },
    },
    deferred: false,
    replied: false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isChatInputCommand: () => true,
    async deferReply() {
      const err = new Error('Unknown interaction');
      err.code = 10062;
      throw err;
    },
    async editReply() {},
    async reply() {},
    async followUp() {},
  };

  await handlers.handleInteractionCreate(interaction);

  assert.equal(calls.routeSlashCommand.length, 0);
  assert.deepEqual(channelSends, [
    { content: '⚠️ `/resume` 已收到，但 Discord 网络或代理抖动，没能在时限内确认这次 slash 交互。请重试一次。' },
  ]);
});

test('handleMessageCreate strips bot mention and enqueues prompt', async () => {
  const { handlers, calls } = createHarness({
    messageInput: {
      doesMessageTargetBot: () => true,
      buildPromptFromMessage: (text) => `PROMPT:${text}`,
    },
    resolveSecurityContext: () => ({ profile: 'public', mentionOnly: true }),
  });
  const message = {
    id: 'message-1',
    content: '<@123>  hello world  ',
    system: false,
    author: { id: 'user-1', bot: false, tag: 'demo#0001' },
    mentions: {
      users: { has: (userId) => userId === '123' },
      repliedUser: null,
    },
    channel: {
      id: 'channel-1',
      isThread: () => false,
    },
    attachments: new Map(),
    reactions: { cache: new Map() },
    async react() {},
  };
  const bot = {
    user: { id: '123' },
  };

  await handlers.handleMessageCreate(message, bot);

  assert.equal(calls.enqueuePrompt.length, 1);
  assert.equal(calls.enqueuePrompt[0][1], 'channel-1');
  assert.equal(calls.enqueuePrompt[0][2], 'PROMPT:hello world');
  assert.deepEqual(calls.enqueuePrompt[0][3], { profile: 'public', mentionOnly: true });
});

test('handleMessageCreate uses the normalized inbound envelope for routing', async () => {
  const normalizedMessage = {
    type: 'message',
    platformId: 'discord',
    id: 'normalized-message',
    actor: { id: 'normalized-user', displayName: 'Normalized User', isBot: false },
    conversation: { id: 'normalized-channel', parentId: null, isThread: false },
    rawText: 'raw platform text',
    text: 'normalized prompt',
    attachments: [],
    isSystem: false,
    targetsBot: true,
    responseTarget: null,
  };
  const normalizedCalls = [];
  const { handlers, calls } = createHarness({
    normalizeMessageEvent: (message, options) => {
      normalizedCalls.push([message, options]);
      return { ...normalizedMessage, responseTarget: message };
    },
    messageInput: {
      doesMessageTargetBot: () => false,
      buildPromptFromMessage: (text) => `PROMPT:${text}`,
    },
    resolveSecurityContext: () => ({ profile: 'public', mentionOnly: true }),
  });
  const message = {
    id: 'raw-message',
    content: 'ignored raw content',
    system: false,
    author: { id: 'raw-user', bot: false, tag: 'raw#0001' },
    channel: { id: 'raw-channel', isThread: () => false },
    attachments: new Map(),
    reactions: { cache: new Map() },
    async react() {},
  };
  const bot = { user: { id: 'bot-1' } };

  await handlers.handleMessageCreate(message, bot);

  assert.deepEqual(normalizedCalls, [[message, { botUserId: 'bot-1' }]]);
  assert.notEqual(calls.enqueuePrompt[0][0], message);
  assert.equal(calls.enqueuePrompt[0][0].responseTarget, message);
  assert.equal(calls.enqueuePrompt[0][0].conversation.id, 'normalized-channel');
  assert.equal(calls.enqueuePrompt[0][0].actor.id, 'normalized-user');
  assert.deepEqual(calls.enqueuePrompt[0][0].attachments, []);
  assert.deepEqual(calls.getSession[0], [
    'normalized-channel',
    { conversation: normalizedMessage.conversation },
  ]);
  assert.equal(calls.enqueuePrompt[0][1], 'normalized-channel');
  assert.equal(calls.enqueuePrompt[0][2], 'PROMPT:normalized prompt');
});

test('bindClientHandlers wires ready registration and recoverable shard disconnect self-heal', async () => {
  const { handlers, calls, commandSpecs, commandRegistryRenderer } = createHarness();
  const onceHandlers = new Map();
  const onHandlers = new Map();
  const bot = {
    user: { id: 'bot-1', tag: 'bot#0001' },
    once(event, handler) {
      onceHandlers.set(event, handler);
    },
    on(event, handler) {
      onHandlers.set(event, handler);
    },
  };
  const heals = [];

  handlers.bindClientHandlers(bot, {
    scheduleSelfHeal: (reason) => {
      heals.push(reason);
    },
  });

  await onceHandlers.get('ready')();
  onHandlers.get('shardDisconnect')({ code: 1006 }, 2);

  assert.equal(calls.registerSlashCommands.length, 1);
  assert.equal(calls.registerSlashCommands[0].client, bot);
  assert.equal(calls.registerSlashCommands[0].commandSpecs, commandSpecs);
  assert.equal(calls.registerSlashCommands[0].commandRegistryRenderer, commandRegistryRenderer);
  assert.deepEqual(heals, ['shard_disconnect:2:code=1006']);
});

test('bindClientHandlers skips Discord thread listeners when threads are disabled', async () => {
  const { handlers } = createHarness({
    platformCapabilities: { threads: false },
  });
  const onceHandlers = new Map();
  const onHandlers = new Map();
  const bot = {
    user: { id: 'bot-1', tag: 'bot#0001' },
    once(event, handler) {
      onceHandlers.set(event, handler);
    },
    on(event, handler) {
      onHandlers.set(event, handler);
    },
  };

  handlers.bindClientHandlers(bot, { scheduleSelfHeal() {} });

  assert.equal(onceHandlers.has('ready'), true);
  assert.equal(onHandlers.has('messageCreate'), true);
  assert.equal(onHandlers.has('interactionCreate'), true);
  assert.equal(onHandlers.has('threadCreate'), false);
  assert.equal(onHandlers.has('threadListSync'), false);
});
