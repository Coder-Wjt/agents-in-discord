import { buildPromptFromMessage } from '../src/message-input.js';
import { createTextCommandHandler } from '../src/text-command-handler.js';
import { createPlatformCapabilities, LARK_PLATFORM_CAPABILITIES } from '../src/platforms/capabilities.js';
import { createLarkPlatformFoundation } from '../src/platforms/lark/foundation.js';
import { definePlatformAdapterConformance } from './support/platform-conformance.mjs';

function createMessage({ content = 'hello adapter', resources = [] } = {}) {
  return {
    messageId: `message-${Math.random()}`,
    chatId: 'conversation-1',
    chatType: 'group',
    senderId: 'user-1',
    senderName: 'User One',
    content,
    mentionedBot: true,
    resources,
    raw: { sender: { tenant_key: 'tenant-1' } },
  };
}

function createLarkDriver({ capabilities = null } = {}) {
  const state = {
    cancels: [],
    enqueues: [],
    replies: [],
    routes: [],
    sendCalls: [],
  };
  const listeners = new Map();
  let enqueueError = null;
  let nextMessageId = 1;
  const channel = {
    on(name, handler) {
      listeners.set(name, handler);
      return () => listeners.delete(name);
    },
    async send(chatId, input, options = {}) {
      state.sendCalls.push({ chatId, input, options });
      state.replies.push(input.text);
      const messageId = `sent-${nextMessageId}`;
      nextMessageId += 1;
      return { messageId };
    },
    async editMessage() {},
    async downloadResource() {
      return Buffer.from('resource');
    },
  };
  const resolvedCapabilities = capabilities || LARK_PLATFORM_CAPABILITIES;
  const foundation = createLarkPlatformFoundation({
    capabilities: resolvedCapabilities,
    eventNormalizerOptions: { getChannel: () => channel },
    messageDeliveryOptions: { getChannel: () => channel },
    notificationDeliveryOptions: { getChannel: () => channel },
    conversationSpawnOptions: { getChannel: () => channel },
  });
  const session = { provider: 'codex', language: 'en' };
  const textHandler = createTextCommandHandler({
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
    safeReply: foundation.messageDelivery.reply,
  });
  const handleCommand = async (message, key, content) => {
    if (content === '!status') {
      state.routes.push({
        mode: String(message?.content || '').startsWith('/') ? 'native_text' : 'text',
        commandName: 'status',
        actorId: message.actor.id,
        conversationId: key,
      });
      return;
    }
    return textHandler(message, key, content);
  };
  const adapter = foundation.createAdapter({
    entryHandlerOptions: {
      commandSpecs: [{ name: 'status', description: 'Show status' }],
      logger: { log() {}, warn() {}, error() {} },
      getSession: () => session,
      resolveSecurityContext: () => ({ profile: 'team', mentionOnly: false, maxQueuePerChannel: 20 }),
      handleCommand,
      async enqueuePrompt(message, conversationId, content) {
        if (enqueueError) throw enqueueError;
        state.enqueues.push({ message, conversationId, content });
      },
      messageInput: { buildPromptFromMessage },
    },
    factories: {
      createLifecycle: () => ({}),
    },
  });
  const expectedConversationId = adapter.eventNormalizer.normalizeMessage(createMessage()).conversation.id;

  return {
    adapter,

    async ordinaryMessage() {
      const raw = createMessage();
      const event = adapter.eventNormalizer.normalizeMessage(raw);
      await adapter.entryHandlers.handleMessageCreate(raw);
      const dispatch = state.enqueues.at(-1);
      return {
        adapterId: adapter.id,
        expectedConversationId,
        event,
        dispatch: {
          kind: 'prompt',
          actorId: dispatch.message.actor.id,
          conversationId: dispatch.conversationId,
          content: dispatch.content,
        },
      };
    },

    async command() {
      await adapter.entryHandlers.handleMessageCreate(createMessage({ content: '/status' }));
      return {
        expectedConversationId,
        route: state.routes.at(-1),
      };
    },

    async cancel() {
      await adapter.entryHandlers.handleMessageCreate(createMessage({ content: '!cancel' }));
      return {
        expectedConversationId,
        cancel: state.cancels.at(-1),
        promptCount: state.enqueues.length,
        reply: state.replies.at(-1),
      };
    },

    async attachments() {
      const raw = createMessage({
        content: 'inspect attachment',
        resources: [{
          type: 'image',
          fileKey: 'attachment-1',
          fileName: 'brief.png',
          sizeBytes: 42,
          url: 'https://cdn.example/brief.png',
        }],
      });
      const event = adapter.eventNormalizer.normalizeMessage(raw);
      await adapter.entryHandlers.handleMessageCreate(raw);
      const dispatch = state.enqueues.at(-1);
      return {
        event,
        dispatch: {
          attachmentCount: dispatch.message.attachments.length,
          content: dispatch.content,
        },
      };
    },

    async capabilityDegradation() {
      const degraded = createLarkDriver({ capabilities: createPlatformCapabilities() });
      let editCalls = 0;
      let statusCalls = 0;
      const target = {
        async edit() { editCalls += 1; },
        async react() { statusCalls += 1; },
      };
      await degraded.adapter.messageDelivery.edit(target, 'updated');
      await degraded.adapter.messageDelivery.setMessageStatus(target, 'failed');
      const event = degraded.adapter.eventNormalizer.normalizeMessage(createMessage({
        resources: [{ type: 'image', fileKey: 'ignored', fileName: 'ignored.png' }],
      }));
      return {
        attachments: event.attachments,
        editCalls,
        statusCalls,
        threadCreateListener: false,
        threadSyncListener: false,
      };
    },

    async childConversation() {
      const source = adapter.eventNormalizer.normalizeMessage(createMessage());
      const requestedName = 'Child conversation';
      const child = await adapter.conversationSpawn.spawn(source, { name: requestedName });
      const prompt = adapter.conversationSpawn.createPromptMessage(source, child);
      await adapter.conversationSpawn.send(child, 'child ready');
      return {
        source,
        spawnedId: child.id,
        expectedSpawnedId: child.id,
        joined: true,
        requestedName,
        prompt,
        expectedParentId: source.conversation.id,
        notice: state.sendCalls.at(-1).input.text,
      };
    },

    async errorRecovery() {
      enqueueError = new Error('adapter boom');
      await adapter.entryHandlers.handleMessageCreate(createMessage());
      const selfHealReasons = [];
      adapter.entryHandlers.bindClientHandlers(channel, {
        scheduleSelfHeal(reason) {
          selfHealReasons.push(reason);
        },
      });
      listeners.get('error')(new Error('socket closed'));
      return {
        statuses: [],
        expectedStatuses: [],
        reply: state.replies.at(-1),
        selfHealReasons,
        expectedSelfHealReasons: ['channel_error'],
      };
    },
  };
}

definePlatformAdapterConformance({
  platformName: 'Lark',
  createDriver: createLarkDriver,
});
