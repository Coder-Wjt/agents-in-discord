import { buildPromptFromMessage } from '../src/message-input.js';
import { createTextCommandHandler } from '../src/text-command-handler.js';
import { createPlatformCapabilities } from '../src/platforms/capabilities.js';
import { createInboundMessageContext } from '../src/platforms/inbound-event.js';
import { createDiscordPlatformFoundation } from '../src/platforms/discord/foundation.js';
import { definePlatformAdapterConformance } from './support/platform-conformance.mjs';

function createRawMessage({
  content = 'hello adapter',
  attachments = [],
  react = async () => {},
} = {}) {
  const channel = {
    id: 'conversation-1',
    isThread: () => false,
  };
  return {
    id: 'message-1',
    content,
    system: false,
    author: { id: 'user-1', tag: 'User One', bot: false },
    channel,
    attachments: new Map(attachments.map((attachment) => [attachment.id, attachment])),
    mentions: { users: { has: () => false }, repliedUser: null },
    reactions: { cache: new Map() },
    react,
  };
}

function createRawCommand() {
  return {
    id: 'interaction-1',
    commandName: 'status',
    channelId: 'conversation-1',
    channel: { id: 'conversation-1', isThread: () => false },
    user: { id: 'user-1', tag: 'User One' },
    options: {
      getString(name) {
        return name === 'detail' ? 'full' : null;
      },
    },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    async deferReply() {
      this.deferred = true;
    },
    async editReply() {},
    async reply() {},
    async followUp() {},
  };
}

function createDiscordDriver({ capabilities = null } = {}) {
  const state = {
    cancels: [],
    commandReplies: [],
    enqueues: [],
    errorReplies: [],
    routes: [],
  };
  let enqueueError = null;
  const resolvedCapabilities = capabilities || createPlatformCapabilities({
    threads: true,
    slashCommands: true,
    buttons: true,
    selectMenus: true,
    modals: true,
    messageEdits: true,
    reactions: true,
    attachments: true,
  });
  const foundation = createDiscordPlatformFoundation({ capabilities: resolvedCapabilities });
  const session = { provider: 'codex', language: 'en' };
  const handleCommand = createTextCommandHandler({
    platformCapabilities: resolvedCapabilities,
    messageDelivery: foundation.messageDelivery,
    conversationPresentation: foundation.conversationPresentation,
    getSession: () => session,
    getSessionLanguage: () => 'en',
    cancelChannelWork(conversationId, reason) {
      state.cancels.push({ conversationId, reason });
      return { cancelledRunning: true, clearedQueued: 0 };
    },
    formatCancelReport: () => 'cancel complete',
    safeReply: async (_message, payload) => {
      state.commandReplies.push(payload);
    },
  });
  const adapter = foundation.createAdapter({
    entryHandlerOptions: {
      logger: { log() {}, warn() {}, error() {} },
      commandSpecs: [],
      withDiscordNetworkRetry: async (operation) => operation(),
      safeReply: async (_message, payload) => {
        state.errorReplies.push(payload);
      },
      safeError: (error) => error?.message || String(error),
      accessPolicy: null,
      getSession: () => session,
      resolveSecurityContext: () => ({ profile: 'team', mentionOnly: false }),
      handleCommand,
      async enqueuePrompt(message, conversationId, content) {
        if (enqueueError) throw enqueueError;
        state.enqueues.push({ message, conversationId, content });
      },
      messageInput: { buildPromptFromMessage },
      parseCommandActionButtonId: () => null,
      isWorkspaceBusyComponentId: () => false,
      isWorkspaceBrowserComponentId: () => false,
      isOnboardingButtonId: () => false,
      isSettingsPanelComponentId: () => false,
      isSettingsPanelModalId: () => false,
      isGoalModalId: () => false,
      routeSlashCommand: async (route) => {
        state.routes.push(route);
        return true;
      },
      normalizeSlashCommandName: (name) => name,
    },
    factories: {
      createAccessPolicy: () => ({
        isAllowedUser: () => true,
        isAllowedChannel: () => true,
        isAllowedInteractionChannel: async () => true,
      }),
      createLifecycle: () => ({}),
    },
  });

  return {
    adapter,

    async ordinaryMessage() {
      const raw = createRawMessage();
      const event = adapter.eventNormalizer.normalizeMessage(raw, { botUserId: 'bot-1' });
      await adapter.entryHandlers.handleMessageCreate(raw, { user: { id: 'bot-1' } });
      const dispatched = state.enqueues.at(-1);
      return {
        adapterId: adapter.id,
        event,
        dispatch: {
          kind: 'prompt',
          actorId: dispatched.message.actor.id,
          conversationId: dispatched.conversationId,
          content: dispatched.content,
        },
      };
    },

    async command() {
      const raw = createRawCommand();
      const event = adapter.eventNormalizer.normalizeInteraction(raw);
      await adapter.entryHandlers.handleInteractionCreate(raw);
      const routed = state.routes.at(-1);
      return {
        event,
        route: {
          commandName: routed.commandName,
          actorId: routed.interaction.actor.id,
          conversationId: routed.interaction.conversation.id,
        },
      };
    },

    async cancel() {
      const raw = createRawMessage({ content: '!cancel' });
      await adapter.entryHandlers.handleMessageCreate(raw, { user: { id: 'bot-1' } });
      return {
        cancel: state.cancels.at(-1),
        promptCount: state.enqueues.length,
        reply: state.commandReplies.at(-1),
      };
    },

    async attachments() {
      const raw = createRawMessage({
        content: 'inspect attachment',
        attachments: [{
          id: 'attachment-1',
          name: 'brief.png',
          contentType: 'image/png',
          size: 42,
          url: 'https://cdn.example/brief.png',
        }],
      });
      const event = adapter.eventNormalizer.normalizeMessage(raw, { botUserId: 'bot-1' });
      await adapter.entryHandlers.handleMessageCreate(raw, { user: { id: 'bot-1' } });
      const dispatched = state.enqueues.at(-1);
      return {
        event,
        dispatch: {
          attachmentCount: dispatched.message.attachments.length,
          content: dispatched.content,
        },
      };
    },

    async capabilityDegradation() {
      const degraded = createDiscordDriver({ capabilities: createPlatformCapabilities() });
      const raw = createRawMessage({
        attachments: [{
          id: 'attachment-1',
          name: 'ignored.png',
          contentType: 'image/png',
          size: 42,
          url: 'https://cdn.example/ignored.png',
        }],
      });
      let editCalls = 0;
      let statusCalls = 0;
      const target = {
        async edit() {
          editCalls += 1;
        },
        async react() {
          statusCalls += 1;
        },
        reactions: { cache: new Map() },
      };
      await degraded.adapter.messageDelivery.edit(target, 'updated');
      await degraded.adapter.messageDelivery.setMessageStatus(target, 'failed');
      const event = degraded.adapter.eventNormalizer.normalizeMessage(raw, { botUserId: 'bot-1' });
      const listeners = new Map();
      degraded.adapter.entryHandlers.bindClientHandlers({
        once() {},
        on(name, handler) {
          listeners.set(name, handler);
        },
      }, { scheduleSelfHeal() {} });
      return {
        attachments: event.attachments,
        editCalls,
        statusCalls,
        threadCreateListener: listeners.has('threadCreate'),
        threadSyncListener: listeners.has('threadListSync'),
      };
    },

    async childConversation() {
      let joined = false;
      let requestedName = null;
      const notices = [];
      const child = {
        id: 'child-conversation-1',
        parentId: 'conversation-1',
        isThread: () => true,
        async join() {
          joined = true;
        },
        async send(payload) {
          notices.push(payload);
        },
      };
      const raw = createRawMessage();
      raw.channel.threads = {
        async create(options) {
          requestedName = options.name;
          return child;
        },
      };
      const source = createInboundMessageContext(
        adapter.eventNormalizer.normalizeMessage(raw, { botUserId: 'bot-1' }),
      );
      const spawned = await adapter.conversationSpawn.spawn(source, { name: 'Child conversation' });
      const prompt = adapter.conversationSpawn.createPromptMessage(source, spawned);
      await adapter.conversationSpawn.send(spawned, { content: 'child ready' });
      return {
        spawnedId: spawned.id,
        joined,
        requestedName,
        prompt,
        notice: notices[0]?.content,
      };
    },

    async errorRecovery() {
      const statuses = [];
      enqueueError = new Error('adapter boom');
      const raw = createRawMessage({
        react: async (emoji) => {
          if (emoji === '❌') statuses.push('failed');
        },
      });
      await adapter.entryHandlers.handleMessageCreate(raw, { user: { id: 'bot-1' } });

      const listeners = new Map();
      const selfHealReasons = [];
      adapter.entryHandlers.bindClientHandlers({
        once() {},
        on(name, handler) {
          listeners.set(name, handler);
        },
      }, {
        scheduleSelfHeal(reason) {
          selfHealReasons.push(reason);
        },
      });
      listeners.get('shardDisconnect')({ code: 1006 }, 2);
      return {
        statuses,
        reply: state.errorReplies.at(-1),
        selfHealReasons,
      };
    },
  };
}

definePlatformAdapterConformance({
  platformName: 'Discord',
  createDriver: createDiscordDriver,
});
