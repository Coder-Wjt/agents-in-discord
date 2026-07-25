import { createCommandMessageView } from './platforms/command-view.js';
import { registerDiscordCommands } from './platforms/discord/command-registration.js';
import { createDiscordInboundEventNormalizer } from './platforms/discord/inbound-event.js';
import { assertInteractionResponse } from './platforms/interaction-response.js';
import { createInboundMessageContext } from './platforms/inbound-event.js';

export function createDiscordEntryHandlers({
  platformCapabilities = null,
  logger = console,
  registerCommands = registerDiscordCommands,
  REST,
  Routes,
  discordToken,
  restProxyAgent = null,
  commandSpecs = [],
  commandRegistryRenderer,
  withDiscordNetworkRetry,
  safeReply,
  safeError = (err) => err?.message || String(err),
  isIgnorableDiscordRuntimeError = () => false,
  isRecoverableGatewayCloseCode = () => true,
  accessPolicy = {},
  interactionResponse,
  messageDelivery = null,
  normalizeInteractionEvent = null,
  normalizeMessageEvent = null,
  getSession,
  resolveSecurityContext,
  handleCommand,
  enqueuePrompt,
  messageInput = {},
  parseCommandActionButtonId,
  isWorkspaceBusyComponentId,
  isWorkspaceBrowserComponentId,
  isOnboardingButtonId,
  isSettingsPanelComponentId,
  isSettingsPanelModalId,
  isGoalModalId,
  handleWorkspaceBusyInteraction,
  handleWorkspaceBrowserInteraction,
  handleOnboardingButtonInteraction,
  handleSettingsPanelInteraction,
  handleSettingsPanelModalSubmit,
  handleGoalModalSubmit,
  routeSlashCommand,
  shouldDeferInteraction = () => true,
  normalizeSlashCommandName,
} = {}) {
  const responsePort = assertInteractionResponse(interactionResponse);
  const supportsThreads = platformCapabilities?.threads !== false;
  const setMessageStatus = messageDelivery?.setMessageStatus || (async () => {});
  const {
    isAllowedUser = () => true,
    isAllowedChannel = () => true,
    isAllowedInteractionChannel = async () => true,
  } = accessPolicy;
  const {
    doesMessageTargetBot = () => false,
    buildPromptFromMessage = () => '',
  } = messageInput;
  const toInboundMessageEvent = normalizeMessageEvent || ((message, { botUserId = null } = {}) => {
    const rawText = String(message?.content || '');
    const normalizedBotUserId = String(botUserId || '').trim();
    return {
      type: 'message',
      platformId: 'discord',
      id: String(message?.id || '').trim(),
      actor: {
        id: String(message?.author?.id || '').trim(),
        displayName: String(message?.author?.tag || message?.author?.id || '').trim(),
        isBot: Boolean(message?.author?.bot),
      },
      conversation: {
        id: String(message?.channel?.id || '').trim(),
        parentId: message?.channel?.isThread?.() ? String(message?.channel?.parentId || '').trim() || null : null,
        isThread: Boolean(message?.channel?.isThread?.()),
      },
      rawText,
      text: normalizedBotUserId
        ? rawText.replace(new RegExp(`<@!?${normalizedBotUserId}>`, 'g'), '').trim()
        : rawText.trim(),
      attachments: message?.attachments && typeof message.attachments.values === 'function'
        ? [...message.attachments.values()]
        : [],
      replyToMessageId: String(
        message?.reference?.messageId
        || message?.reference?.message_id
        || message?.reference?.message?.id
        || '',
      ).trim() || null,
      isSystem: Boolean(message?.system),
      targetsBot: Boolean(normalizedBotUserId && doesMessageTargetBot(message, normalizedBotUserId)),
      raw: message,
    };
  });
  const toInboundInteractionEvent = normalizeInteractionEvent
    || createDiscordInboundEventNormalizer().normalizeInteraction;

  async function joinThreadWithRetry(thread, context = 'thread.join') {
    if (!supportsThreads) return;
    if (!thread || thread.joined) return;

    await withDiscordNetworkRetry(
      () => thread.join(),
      {
        logger,
        label: `${context} thread.join (${thread.id})`,
        maxAttempts: 4,
        baseDelayMs: 500,
      },
    );
  }

  function describeInteraction(interaction) {
    if (!interaction) return 'interaction';
    const commandName = String(interaction.commandName || '').trim();
    if (commandName) return `interaction:${commandName}`;
    const customId = String(interaction.customId || '').trim();
    if (customId) return `interaction:${customId}`;
    return `interaction:${interaction.type || 'unknown'}`;
  }

  function isUnknownInteractionError(err) {
    const code = Number(err?.code ?? err?.rawError?.code);
    if (code === 10062) return true;
    const text = [
      String(err?.message || ''),
      String(err?.rawError?.message || ''),
    ].join(' ').toLowerCase();
    return text.includes('unknown interaction');
  }

  async function sendInteractionTimeoutNotice(interaction) {
    const channel = interaction?.channel;
    if (!channel || typeof channel.send !== 'function') return false;

    const commandLabel = String(interaction?.commandName || '').trim();
    const content = commandLabel
      ? `⚠️ \`/${commandLabel}\` 已收到，但 Discord 网络或代理抖动，没能在时限内确认这次 slash 交互。请重试一次。`
      : '⚠️ 这次交互已收到，但 Discord 网络或代理抖动，没能在时限内确认。请重试一次。';

    await withDiscordNetworkRetry(
      () => channel.send({ content }),
      {
        logger,
        label: `${describeInteraction(interaction)} channel.send (interaction-timeout)`,
        maxAttempts: 2,
        baseDelayMs: 200,
      },
    );
    return true;
  }

  async function handleMessageCreate(message, bot) {
    try {
      const event = toInboundMessageEvent(message, { botUserId: bot?.user?.id || null });
      const promptMessage = createInboundMessageContext(event, { fallbackRaw: message });
      if (event.actor.isBot) return;
      if (event.isSystem) return;
      if (!isAllowedUser(event.actor.id)) return;
      const channelAllowed = isAllowedChannel(message.channel);
      const key = event.conversation.id;
      const session = getSession(key, { conversation: event.conversation });
      const security = resolveSecurityContext(message.channel, session);

      const chId = event.conversation.id;
      const parentId = event.conversation.parentId;
      const attachmentCount = event.attachments.length;
      logger.log(`[msg] platform=${event.platformId} ch=${chId} parent=${parentId} author=${event.actor.displayName} allowed=${channelAllowed} profile=${security.profile} mentionOnly=${security.mentionOnly} contentLen=${event.rawText.length} attachments=${attachmentCount} system=${event.isSystem}`);

      if (!channelAllowed) return;

      const rawContent = event.text;
      const isCommand = rawContent.startsWith('!');

      if (isCommand) {
        await handleCommand(promptMessage, key, rawContent);
        return;
      }

      if (security.mentionOnly && !event.targetsBot) return;

      const content = buildPromptFromMessage(rawContent, event.attachments);
      if (!content) return;
      await enqueuePrompt(promptMessage, key, content, security);
    } catch (err) {
      logger.error('messageCreate handler error:', err);
      try {
        await setMessageStatus(message, 'failed').catch(() => {});
        await safeReply(message, `❌ 处理失败：${safeError(err)}`);
      } catch {
        // ignore
      }
    }
  }

  async function sendInteractionResponse(interaction, payload) {
    return responsePort.respond(interaction, payload);
  }

  async function safeInteractionFailureReply(interaction, err) {
    if (isIgnorableDiscordRuntimeError(err)) {
      if (isUnknownInteractionError(err) && interaction?.isChatInputCommand?.() && !interaction.deferred && !interaction.replied) {
        try {
          const sent = await sendInteractionTimeoutNotice(interaction);
          if (sent) {
            logger.warn(`Interaction timed out before acknowledgement; posted channel fallback notice (${describeInteraction(interaction)}).`);
            return;
          }
        } catch (fallbackErr) {
          logger.warn(`Failed to post interaction timeout fallback (${describeInteraction(interaction)}): ${safeError(fallbackErr)}`);
        }
      }
      logger.warn(`Ignoring non-fatal interaction error: ${safeError(err)}`);
      return;
    }

    try {
      await sendInteractionResponse(interaction, createCommandMessageView({
        content: `❌ ${safeError(err)}`,
        visibility: 'ephemeral',
      }));
    } catch (replyErr) {
      if (isIgnorableDiscordRuntimeError(replyErr)) {
        logger.warn(`Ignoring non-fatal interaction reply error: ${safeError(replyErr)}`);
        return;
      }
      throw replyErr;
    }
  }

  async function handleInteractionCreate(interaction) {
    const event = toInboundInteractionEvent(interaction);
    if (event.kind === 'button' || event.kind === 'select') {
      const componentId = event.component.id;
      const isButton = event.kind === 'button';
      const isWorkspaceBusy = isButton && isWorkspaceBusyComponentId(componentId);
      const isWorkspaceBrowser = isWorkspaceBrowserComponentId(componentId);
      const commandButton = isButton ? parseCommandActionButtonId(componentId) : null;
      const isOnboarding = isButton && isOnboardingButtonId(componentId);
      const isSettingsPanel = isSettingsPanelComponentId(componentId);
      if (!isWorkspaceBusy && !isWorkspaceBrowser && !isOnboarding && !commandButton && !isSettingsPanel) return;
      logger.log(`[interaction] kind=${event.kind} id=${componentId} user=${event.actor.displayName || event.actor.id || 'unknown'} channel=${event.conversation.id || 'unknown'}`);
      try {
        if (!isAllowedUser(event.actor.id)) {
          await sendInteractionResponse(event, createCommandMessageView({ content: '⛔ 没有权限。', visibility: 'ephemeral' }));
          return;
        }
        if (!(await isAllowedInteractionChannel(interaction))) {
          await sendInteractionResponse(event, createCommandMessageView({ content: '⛔ 当前频道未开放。', visibility: 'ephemeral' }));
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
            respond: (payload) => sendInteractionResponse(event, payload),
          });
          if (!handled) {
            await sendInteractionResponse(event, createCommandMessageView({
              content: '❌ 快捷按钮已失效，请重新执行 slash 命令。',
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
      } catch (err) {
        logger.error(`interactionCreate component handler error (${describeInteraction(interaction)}):`, err);
        await safeInteractionFailureReply(interaction, err);
      }
      return;
    }

    if (event.kind === 'modal') {
      const modalId = event.modal.id;
      const isSettingsModal = isSettingsPanelModalId(modalId);
      const isGoalModal = isGoalModalId?.(modalId);
      if (!isSettingsModal && !isGoalModal) return;
      logger.log(`[interaction] kind=modal id=${modalId} user=${event.actor.displayName || event.actor.id || 'unknown'} channel=${event.conversation.id || 'unknown'}`);
      try {
        if (!isAllowedUser(event.actor.id)) {
          await sendInteractionResponse(event, createCommandMessageView({ content: '⛔ 没有权限。', visibility: 'ephemeral' }));
          return;
        }
        if (!(await isAllowedInteractionChannel(interaction))) {
          await sendInteractionResponse(event, createCommandMessageView({ content: '⛔ 当前频道未开放。', visibility: 'ephemeral' }));
          return;
        }
        if (isSettingsModal) {
          await handleSettingsPanelModalSubmit(event);
        } else {
          await handleGoalModalSubmit(event);
        }
      } catch (err) {
        logger.error(`interactionCreate modal handler error (${describeInteraction(interaction)}):`, err);
        await safeInteractionFailureReply(interaction, err);
      }
      return;
    }

    if (event.kind !== 'command') return;
    logger.log(`[interaction] kind=chat-input cmd=${event.command.name} user=${event.actor.displayName || event.actor.id || 'unknown'} channel=${event.conversation.id || 'unknown'}`);
    if (!isAllowedUser(event.actor.id)) {
      await sendInteractionResponse(event, createCommandMessageView({ content: '⛔ 没有权限。', visibility: 'ephemeral' }));
      return;
    }

    try {
      const respond = (payload) => sendInteractionResponse(event, payload);
      const cmd = normalizeSlashCommandName(event.command.name);

      if (shouldDeferInteraction(event, cmd)) {
        await responsePort.defer(event, { visibility: 'ephemeral' });
      }

      if (!(await isAllowedInteractionChannel(interaction))) {
        await respond(createCommandMessageView({ content: '⛔ 当前频道未开放。', visibility: 'ephemeral' }));
        return;
      }

      const handled = await routeSlashCommand({
        interaction: event,
        commandName: cmd,
        respond,
      });
      if (!handled) {
        await respond(createCommandMessageView({
          content: `❌ 未知命令：\`${event.command.name}\``,
          visibility: 'ephemeral',
        }));
      }
    } catch (err) {
      logger.error(`interactionCreate chat-input handler error (${describeInteraction(interaction)}):`, err);
      await safeInteractionFailureReply(interaction, err);
    }
  }

  function bindClientHandlers(bot, lifecycle) {
    bot.once('ready', async () => {
      logger.log(`✅ Logged in as ${bot.user.tag}`);
      await registerCommands({
        client: bot,
        REST,
        Routes,
        discordToken,
        restProxyAgent,
        commandSpecs,
        commandRegistryRenderer,
        logger,
      });
    });

    if (supportsThreads) {
      bot.on('threadCreate', async (thread) => {
        try {
          await joinThreadWithRetry(thread, 'threadCreate');
          logger.log(`🧵 Joined thread: ${thread.name} (${thread.id})`);
        } catch (err) {
          logger.error(`Failed to join thread ${thread.id}:`, err.message);
        }
      });

      bot.on('threadListSync', (threads) => {
        for (const thread of threads.values()) {
          if (!thread.joined) {
            joinThreadWithRetry(thread, 'threadListSync')
              .then(() => logger.log(`🧵 Synced into thread: ${thread.name}`))
              .catch((err) => logger.error(`Failed to sync thread ${thread.id}:`, err.message));
          }
        }
      });
    }

    bot.on('messageCreate', (message) => handleMessageCreate(message, bot));
    bot.on('interactionCreate', handleInteractionCreate);

    bot.on('error', (err) => {
      if (isIgnorableDiscordRuntimeError(err)) {
        logger.warn(`Ignoring non-fatal Discord client error: ${safeError(err)}`);
        return;
      }
      logger.error('Discord client error:', err);
      lifecycle.scheduleSelfHeal('client_error', err);
    });

    bot.on('shardError', (err, shardId) => {
      logger.error(`Discord shard error (shard=${shardId}):`, err);
      lifecycle.scheduleSelfHeal(`shard_error:${shardId}`, err);
    });

    bot.on('shardDisconnect', (event, shardId) => {
      const code = event?.code ?? 'unknown';
      const recoverable = isRecoverableGatewayCloseCode(code);
      logger.warn(`Discord shard disconnected (shard=${shardId}, code=${code}, recoverable=${recoverable})`);
      if (recoverable) {
        lifecycle.scheduleSelfHeal(`shard_disconnect:${shardId}:code=${code}`);
      }
    });

    bot.on('invalidated', () => {
      logger.error('Discord session invalidated.');
      lifecycle.scheduleSelfHeal('session_invalidated');
    });
  }

  return {
    bindClientHandlers,
    handleInteractionCreate,
    handleMessageCreate,
    joinThreadWithRetry,
    sendInteractionResponse,
    safeInteractionFailureReply,
  };
}
