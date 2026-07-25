import { createPlatformCapabilities } from '../../src/platforms/capabilities.js';
import { assertPlatformAdapter } from '../../src/platforms/contracts.js';
import { assertPlatformFoundation } from '../../src/platforms/foundation.js';

export function createSyntheticPlatformFoundation({
  id = 'synthetic',
  capabilities = createPlatformCapabilities({
    slashCommands: true,
    messageEdits: true,
    attachments: true,
  }),
  state = {},
} = {}) {
  const commandRegistryRenderer = {
    renderCommands: (commands) => commands,
    formatCommandName: (name) => String(name || ''),
    normalizeCommandName: (name) => String(name || ''),
    formatCommandReference: (name) => `:${String(name || '')}`,
  };
  const commandViewRenderer = {
    renderActionRows: (rows) => rows,
    renderMessage: (view) => view,
    renderModal: (view) => view,
  };
  const interactionResponse = {
    respond: async () => {},
    update: async () => {},
    showModal: async () => {},
    defer: async () => {},
  };
  const eventNormalizer = {
    normalizeMessage: (event) => event,
    normalizeInteraction: (event) => event,
  };
  const messageDelivery = {
    reply: async () => {},
    send: async () => {},
    edit: async () => {},
    startTyping: () => () => {},
    splitText: (text) => [String(text || '')],
    formatUserMention: (userId) => `@${String(userId || '')}`,
    setMessageStatus: async () => {},
  };
  const notificationDelivery = { sendNotification: async () => {} };
  const conversationSpawn = {
    canSpawn: () => true,
    spawn: async () => ({ id: 'synthetic-child', raw: {} }),
    rename: async () => ({ ok: true }),
    remove: async () => ({ ok: true }),
    archive: async () => ({ ok: true }),
    send: async () => {},
    listRecentMessages: async () => [],
    splitText: (text) => [String(text || '')],
    createPromptMessage: (source) => source,
    formatUserMention: (userId) => `@${String(userId || '')}`,
    formatConversationReference: (conversationId) => `#${String(conversationId || '')}`,
  };
  const conversationPresentation = { getTerm: () => 'conversation' };
  const conversationSecurity = {
    resolve: () => ({
      conversationId: null,
      parentConversationId: null,
      tenantId: null,
      available: false,
      isDirect: false,
      visibility: 'unknown',
      reason: 'synthetic fixture',
    }),
  };
  const textPresentation = { sanitizeDisplayText: (value) => String(value || '') };

  return assertPlatformFoundation({
    id,
    capabilities,
    commandRegistryRenderer,
    commandViewRenderer,
    interactionResponse,
    messageDelivery,
    notificationDelivery,
    conversationSpawn,
    conversationPresentation,
    conversationSecurity,
    textPresentation,
    createAdapter(options = {}) {
      state.adapterOptions = options;
      return assertPlatformAdapter({
        id,
        capabilities,
        commandRegistryRenderer,
        commandViewRenderer,
        interactionResponse,
        eventNormalizer,
        messageDelivery,
        notificationDelivery,
        conversationSpawn,
        conversationPresentation,
        conversationSecurity,
        textPresentation,
        accessPolicy: { kind: 'synthetic-access' },
        entryHandlers: { kind: 'synthetic-entry' },
        lifecycle: { kind: 'synthetic-lifecycle' },
      });
    },
  });
}
