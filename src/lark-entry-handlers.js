import { buildPromptFromMessage as defaultBuildPromptFromMessage } from './message-input.js';
import { createCommandMessageView } from './platforms/command-view.js';
import { assertCommandRegistryRenderer } from './platforms/command-registry.js';
import { assertInteractionResponse } from './platforms/interaction-response.js';
import { createInboundMessageContext } from './platforms/inbound-event.js';

const BOT_MENU_PROCESSING_CARD = Object.freeze({
  config: {
    enable_forward: false,
    update_multi: true,
    wide_screen_mode: true,
  },
  elements: [{ tag: 'markdown', content: '⏳ 正在处理菜单命令…' }],
});

const DEFAULT_EVENT_DEDUP_WINDOW_MS = 12 * 60 * 60_000;
const DEFAULT_EVENT_DEDUP_MAX_ENTRIES = 5000;

function normalizeId(value) {
  return String(value || '').trim() || null;
}

function resolveRawEventId(value) {
  const visited = new Set();
  let current = value;
  for (let depth = 0; current && typeof current === 'object' && depth < 6; depth += 1) {
    if (visited.has(current)) break;
    visited.add(current);
    const id = normalizeId(
      current.eventId
      || current.event_id
      || current.uuid
      || current.header?.event_id
      || current.header?.eventId,
    );
    if (id) return id;
    current = current.raw || current.event || null;
  }
  return null;
}

function createEventDeduper({
  ttlMs = DEFAULT_EVENT_DEDUP_WINDOW_MS,
  maxEntries = DEFAULT_EVENT_DEDUP_MAX_ENTRIES,
  now = Date.now,
} = {}) {
  const ttl = Math.max(1000, Number(ttlMs) || DEFAULT_EVENT_DEDUP_WINDOW_MS);
  const limit = Math.max(100, Number(maxEntries) || DEFAULT_EVENT_DEDUP_MAX_ENTRIES);
  const seen = new Map();

  return function isDuplicate(key) {
    const normalizedKey = normalizeId(key);
    if (!normalizedKey) return false;
    const currentTime = Number(now()) || Date.now();
    for (const [candidate, expiresAt] of seen) {
      if (expiresAt > currentTime) continue;
      seen.delete(candidate);
    }
    const expiresAt = seen.get(normalizedKey);
    if (expiresAt && expiresAt > currentTime) return true;
    seen.delete(normalizedKey);
    seen.set(normalizedKey, currentTime + ttl);
    while (seen.size > limit) {
      const oldest = seen.keys().next().value;
      if (oldest === undefined) break;
      seen.delete(oldest);
    }
    return false;
  };
}

function createNativeSlashCommandResolver(commandSpecs, commandRegistryRenderer) {
  const renderer = commandRegistryRenderer
    ? assertCommandRegistryRenderer(commandRegistryRenderer)
    : null;
  const registeredNames = new Set();
  if (renderer) {
    for (const item of renderer.renderCommands(commandSpecs || [])) {
      const formatted = String(item?.command || '').trim().toLowerCase();
      if (formatted) registeredNames.add(formatted);
    }
  }

  return function resolveNativeSlashCommand(content) {
    const raw = String(content || '').trim();
    const match = raw.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
    if (!match || !renderer) return null;
    const invokedName = String(match[1] || '').replace(/@[^\s]+$/, '').toLowerCase();
    if (!registeredNames.has(invokedName)) return null;
    const commandName = renderer.normalizeCommandName(invokedName);
    const argument = String(match[2] || '').trim();
    return `!${commandName}${argument ? ` ${argument}` : ''}`;
  };
}

export function createLarkEntryHandlers({
  accessPolicy,
  interactionResponse,
  messageDelivery,
  normalizeInteractionEvent,
  normalizeMessageEvent,
  getSession,
  resolveSecurityContext,
  handleCommand,
  enqueuePrompt,
  commandSpecs = [],
  commandRegistryRenderer = null,
  parseCommandActionButtonId = () => null,
  isWorkspaceBusyComponentId = () => false,
  isWorkspaceBrowserComponentId = () => false,
  isOnboardingButtonId = () => false,
  isSettingsPanelComponentId = () => false,
  isSettingsPanelModalId = () => false,
  isGoalModalId = () => false,
  handleWorkspaceBusyInteraction = async () => {},
  handleWorkspaceBrowserInteraction = async () => {},
  handleOnboardingButtonInteraction = async () => {},
  handleSettingsPanelInteraction = async () => {},
  handleSettingsPanelModalSubmit = async () => {},
  handleGoalModalSubmit = async () => {},
  routeSlashCommand = async () => false,
  normalizeSlashCommandName = (name) => String(name || '').trim().toLowerCase(),
  messageInput = {},
  eventDedupWindowMs = DEFAULT_EVENT_DEDUP_WINDOW_MS,
  eventDedupMaxEntries = DEFAULT_EVENT_DEDUP_MAX_ENTRIES,
  now = Date.now,
  safeError = (error) => error?.message || String(error),
  logger = console,
} = {}) {
  const buildPromptFromMessage = messageInput.buildPromptFromMessage || defaultBuildPromptFromMessage;
  const responsePort = assertInteractionResponse(interactionResponse);
  const {
    isAllowedUser = () => true,
    isAllowedChannel = () => true,
    isAllowedInteractionChannel = async () => true,
  } = accessPolicy || {};
  const isDuplicateEvent = createEventDeduper({
    ttlMs: eventDedupWindowMs,
    maxEntries: eventDedupMaxEntries,
    now,
  });
  const resolveNativeSlashCommand = createNativeSlashCommandResolver(
    commandSpecs,
    commandRegistryRenderer,
  );

  function dropDuplicate(key) {
    const duplicate = isDuplicateEvent(key);
    if (duplicate) logger.debug?.(`[dedup] platform=lark event=${key}`);
    return duplicate;
  }

  async function handleMessageCreate(message) {
    let promptMessage = null;
    try {
      const event = normalizeMessageEvent(message);
      promptMessage = createInboundMessageContext(event);
      if (event.actor.isBot || event.isSystem) return;
      if (dropDuplicate(`message:${event.id}`)) return;
      if (!isAllowedUser(event.actor.id)) return;
      if (!isAllowedChannel(event.conversation.raw)) return;
      const key = event.conversation.id;
      const session = getSession(key, { conversation: event.conversation });
      const security = resolveSecurityContext(event.conversation.raw, session);
      logger.log(`[msg] platform=lark ch=${key} actor=${event.actor.displayName} profile=${security.profile} mentionOnly=${security.mentionOnly} contentLen=${event.rawText.length} attachments=${event.attachments.length}`);

      const rawContent = event.text;
      const commandContent = rawContent.startsWith('!')
        ? rawContent
        : resolveNativeSlashCommand(rawContent);
      if (commandContent) {
        await handleCommand(promptMessage, key, commandContent);
        return;
      }
      if (security.mentionOnly && !event.targetsBot) return;
      const content = buildPromptFromMessage(rawContent, event.attachments);
      if (!content) return;
      await enqueuePrompt(promptMessage, key, content, security);
    } catch (error) {
      logger.error('Lark message handler error:', error);
      try {
        await messageDelivery.reply(promptMessage || { responseTarget: message }, `❌ 处理失败：${safeError(error)}`);
      } catch {
        // Ignore secondary delivery failures.
      }
    }
  }

  async function sendInteractionResponse(interaction, view) {
    return responsePort.respond(interaction, view);
  }

  async function handleInteractionCreate(interaction) {
    const event = normalizeInteractionEvent(interaction);
    if (event.kind !== 'button' && event.kind !== 'select' && event.kind !== 'modal') return;
    const isModal = event.kind === 'modal';
    const componentId = isModal ? event.modal.id : event.component.id;
    const isButton = event.kind === 'button';
    const isSettingsModal = isModal && isSettingsPanelModalId(componentId);
    const isGoalModal = isModal && isGoalModalId(componentId);
    const isWorkspaceBusy = isButton && isWorkspaceBusyComponentId(componentId);
    const isWorkspaceBrowser = !isModal && isWorkspaceBrowserComponentId(componentId);
    const commandButton = isButton ? parseCommandActionButtonId(componentId) : null;
    const isOnboarding = isButton && isOnboardingButtonId(componentId);
    const isSettingsPanel = !isModal && isSettingsPanelComponentId(componentId);
    if (!isSettingsModal && !isGoalModal && !isWorkspaceBusy && !isWorkspaceBrowser && !commandButton && !isOnboarding && !isSettingsPanel) return;
    const rawEventId = resolveRawEventId(event.raw);
    if (rawEventId && dropDuplicate(`interaction:${rawEventId}`)) return;

    logger.log(`[interaction] platform=lark kind=${event.kind} id=${componentId} user=${event.actor.displayName || event.actor.id} chat=${event.conversation.id}`);
    try {
      if (!isAllowedUser(event.actor.id)) {
        await sendInteractionResponse(event, createCommandMessageView({ content: '⛔ 没有权限。', visibility: 'ephemeral' }));
        return;
      }
      if (!(await isAllowedInteractionChannel(event))) {
        await sendInteractionResponse(event, createCommandMessageView({ content: '⛔ 当前会话未开放。', visibility: 'ephemeral' }));
        return;
      }
      if (isSettingsModal) {
        await handleSettingsPanelModalSubmit(event);
        return;
      }
      if (isGoalModal) {
        await handleGoalModalSubmit(event);
        return;
      }
      if (commandButton) {
        if (commandButton.userId !== event.actor.id) {
          await sendInteractionResponse(event, createCommandMessageView({
            content: '⛔ 这组快捷按钮属于发起命令的用户。',
            visibility: 'ephemeral',
          }));
          return;
        }
        const handled = await routeSlashCommand({
          interaction: event,
          commandName: commandButton.command,
          respond: (view) => sendInteractionResponse(event, view),
        });
        if (!handled) {
          await sendInteractionResponse(event, createCommandMessageView({
            content: '❌ 快捷按钮已失效，请重新执行命令。',
            visibility: 'ephemeral',
          }));
        }
        return;
      }
      if (isWorkspaceBusy) {
        await handleWorkspaceBusyInteraction(event);
        return;
      }
      if (isWorkspaceBrowser) {
        await handleWorkspaceBrowserInteraction(event);
        return;
      }
      if (isSettingsPanel) {
        await handleSettingsPanelInteraction(event);
        return;
      }
      await handleOnboardingButtonInteraction(event);
    } catch (error) {
      logger.error(`Lark ${event.kind} interaction handler error:`, error);
      try {
        await sendInteractionResponse(event, createCommandMessageView({
          content: `❌ ${safeError(error)}`,
          visibility: 'ephemeral',
        }));
      } catch {
        // Ignore secondary delivery failures.
      }
    }
  }

  async function handleBotMenu(menu) {
    let sent = null;
    try {
      const actorId = String(menu?.actorId || '').trim();
      if (!actorId || !isAllowedUser(actorId)) return;
      const commandName = normalizeSlashCommandName(menu?.eventKey);
      if (!commandName) return;
      const menuEventId = resolveRawEventId(menu) || normalizeId(menu?.id);
      if (menuEventId && dropDuplicate(`menu:${menuEventId}`)) return;

      sent = await messageDelivery.send({
        platformId: 'lark',
        userId: actorId,
        tenantId: menu?.tenantId || null,
      }, {
        card: BOT_MENU_PROCESSING_CARD,
        interactive: true,
        text: '正在处理菜单命令…',
      });
      const event = normalizeInteractionEvent({
        kind: 'command',
        id: menu?.id,
        messageId: sent.messageId,
        chatId: sent.chatId,
        tenantId: menu?.tenantId || null,
        actorId,
        actorName: menu?.actorName || actorId,
        commandName,
        options: {},
        isCard: true,
        raw: menu?.raw || menu,
      });

      logger.log(`[interaction] platform=lark kind=menu command=${commandName} user=${event.actor.displayName || actorId} chat=${event.conversation.id}`);
      if (!(await isAllowedInteractionChannel(event))) {
        await responsePort.update(event, createCommandMessageView({ content: '⛔ 当前会话未开放。' }));
        return;
      }
      const handled = await routeSlashCommand({
        interaction: event,
        commandName,
        respond: (view) => responsePort.update(event, view),
      });
      if (!handled) {
        await responsePort.update(event, createCommandMessageView({
          content: `❌ 未识别的飞书菜单命令：${commandName}`,
        }));
      }
    } catch (error) {
      logger.error('Lark bot menu handler error:', error);
      if (sent) {
        try {
          await messageDelivery.edit(sent, createCommandMessageView({ content: `❌ ${safeError(error)}` }));
        } catch {
          // Ignore secondary delivery failures.
        }
      }
    }
  }

  function bindClientHandlers(channel, lifecycle) {
    channel.on('message', handleMessageCreate);
    channel.on('cardAction', handleInteractionCreate);
    channel.on('botMenu', handleBotMenu);
    channel.on('error', (error) => {
      logger.error('Lark channel error:', error);
      lifecycle.scheduleSelfHeal('channel_error', error);
    });
    channel.on('reconnecting', () => logger.warn('Lark channel reconnecting...'));
    channel.on('reconnected', () => logger.log('✅ Lark channel reconnected.'));
  }

  return {
    bindClientHandlers,
    handleMessageCreate,
    handleInteractionCreate,
    handleBotMenu,
    sendInteractionResponse,
  };
}
