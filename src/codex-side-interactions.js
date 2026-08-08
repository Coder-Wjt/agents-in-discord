import {
  closeCodexSideConversationFlow,
  createCodexSideConversation,
  formatCodexSideCloseResult,
  formatCodexSideResult,
  getCodexSideAvailability,
} from './codex-side-flow.js';

const COMPONENT_PREFIX = 'cxs';
const MODAL_PREFIX = 'cxsm';
const QUESTION_INPUT_ID = 'question';

function normalizeText(value) {
  return String(value || '').trim();
}

function parseCustomId(value, expectedPrefix) {
  const [prefix, action, parentChannelId, extra] = normalizeText(value).split(':');
  if (prefix !== expectedPrefix || !action || !parentChannelId || extra) return null;
  return { action, parentChannelId };
}

function interactionLanguage(session, getSessionLanguage) {
  return String(getSessionLanguage(session) || '').trim().toLowerCase() === 'en' ? 'en' : 'zh';
}

function readModalText(interaction) {
  return normalizeText(interaction?.fields?.getTextInputValue?.(QUESTION_INPUT_ID));
}

export function isCodexSideComponentId(value) {
  return Boolean(parseCustomId(value, COMPONENT_PREFIX));
}

export function isCodexSideModalId(value) {
  return Boolean(parseCustomId(value, MODAL_PREFIX));
}

export function createCodexSideInteractionSurface({
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  getSession,
  getSessionId = (session) => session?.runnerSessionId || null,
  getSessionProvider = (session) => session?.provider || 'codex',
  getSessionLanguage = (session) => session?.language || 'zh',
  resolveRuntimeModeSetting = () => ({ mode: 'normal' }),
  resolveCodexProfileSetting = () => ({ isExplicit: false }),
  getRuntimeSnapshot = () => ({ running: false }),
  commandActions = {},
  startCodexSideConversation,
  closeCodexSideConversation,
  enqueuePrompt,
  resolveSecurityContext,
  ensureWorkspace,
  cancelChannelWork,
  steerProviderTask,
} = {}) {
  function availability(session) {
    return getCodexSideAvailability({
      session,
      provider: getSessionProvider(session),
      runtimeMode: resolveRuntimeModeSetting(session).mode,
      codexProfile: resolveCodexProfileSetting(session),
    });
  }

  function buildRunningTaskComponents({ message, session, language = 'zh' } = {}) {
    const parentChannelId = normalizeText(message?.channel?.id || message?.channelId);
    if (!parentChannelId || !normalizeText(getSessionId(session)) || !availability(session).ok) return [];
    const label = String(language).toLowerCase() === 'en' ? 'Ask aside' : '问一下';
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${COMPONENT_PREFIX}:ask:${parentChannelId}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Secondary),
    )];
  }

  function buildHeaderComponents({ parentChannelId, language = 'zh' } = {}) {
    const lang = String(language).toLowerCase() === 'en' ? 'en' : 'zh';
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${COMPONENT_PREFIX}:return:${parentChannelId}`)
        .setLabel(lang === 'en' ? 'Main task' : '回主任务')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${COMPONENT_PREFIX}:tell:${parentChannelId}`)
        .setLabel(lang === 'en' ? 'Tell main task' : '告诉主任务')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${COMPONENT_PREFIX}:close:${parentChannelId}`)
        .setLabel(lang === 'en' ? 'Close' : '关闭旁问')
        .setStyle(ButtonStyle.Danger),
    )];
  }

  function buildQuestionModal({ action, parentChannelId, language }) {
    const isTell = action === 'tell';
    const lang = language === 'en' ? 'en' : 'zh';
    const modal = new ModalBuilder()
      .setCustomId(`${MODAL_PREFIX}:${action}:${parentChannelId}`)
      .setTitle(isTell
        ? (lang === 'en' ? 'Tell main task' : '告诉主任务')
        : (lang === 'en' ? 'Ask aside' : '问一下'));
    const input = new TextInputBuilder()
      .setCustomId(QUESTION_INPUT_ID)
      .setLabel(isTell
        ? (lang === 'en' ? 'What should the main task know?' : '要补充什么？')
        : (lang === 'en' ? 'What do you want to ask?' : '想问什么？'))
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(4000);
    return modal.addComponents(new ActionRowBuilder().addComponents(input));
  }

  async function deferEphemeral(interaction) {
    if (interaction.deferred || interaction.replied) return;
    await interaction.deferReply({ flags: 64 });
  }

  async function handleComponent(interaction, respond) {
    const parsed = parseCustomId(interaction?.customId, COMPONENT_PREFIX);
    if (!parsed) return false;
    const session = getSession(parsed.parentChannelId, {
      channel: interaction.channelId === parsed.parentChannelId ? interaction.channel : null,
    });
    const language = interactionLanguage(session, getSessionLanguage);

    if (parsed.action === 'ask') {
      const sideAvailability = availability(session);
      if (!sideAvailability.ok) {
        await respond({ content: formatCodexSideResult({ ok: false, reason: sideAvailability.reason }, language), flags: 64 });
        return true;
      }
      if (!getRuntimeSnapshot(parsed.parentChannelId)?.running) {
        await respond({ content: language === 'en' ? 'The main task has already finished.' : '主任务已经结束。', flags: 64 });
        return true;
      }
      await interaction.showModal(buildQuestionModal({
        action: 'ask',
        parentChannelId: parsed.parentChannelId,
        language,
      }));
      return true;
    }

    if (parsed.action === 'return') {
      await respond({
        content: language === 'en' ? `Back to the main task <#${parsed.parentChannelId}>` : `回主任务 <#${parsed.parentChannelId}>`,
        flags: 64,
      });
      return true;
    }

    if (parsed.action === 'tell') {
      await interaction.showModal(buildQuestionModal({
        action: 'tell',
        parentChannelId: parsed.parentChannelId,
        language,
      }));
      return true;
    }

    if (parsed.action === 'close') {
      await deferEphemeral(interaction);
      const sideSession = getSession(interaction.channelId, { channel: interaction.channel });
      const result = await closeCodexSideConversationFlow({
        key: interaction.channelId,
        session: sideSession,
        getSession,
        commandActions,
        closeCodexSideConversation,
        cancelChannelWork,
        source: interaction,
      });
      await respond({ content: formatCodexSideCloseResult(result, language), flags: 64 });
      return true;
    }

    return false;
  }

  async function handleModalSubmit(interaction, respond) {
    const parsed = parseCustomId(interaction?.customId, MODAL_PREFIX);
    if (!parsed) return false;
    const parentSession = getSession(parsed.parentChannelId, {
      channel: interaction.channelId === parsed.parentChannelId ? interaction.channel : null,
    });
    const language = interactionLanguage(parentSession, getSessionLanguage);
    const question = readModalText(interaction);
    await deferEphemeral(interaction);

    if (!question) {
      await respond({ content: formatCodexSideResult({ ok: false, reason: 'missing_question' }, language), flags: 64 });
      return true;
    }

    if (parsed.action === 'ask') {
      const sideAvailability = availability(parentSession);
      if (!sideAvailability.ok) {
        await respond({ content: formatCodexSideResult({ ok: false, reason: sideAvailability.reason }, language), flags: 64 });
        return true;
      }
      const result = await createCodexSideConversation({
        key: parsed.parentChannelId,
        session: parentSession,
        source: interaction,
        parentSessionId: getSessionId(parentSession),
        question,
        provider: getSessionProvider(parentSession),
        getRuntimeSnapshot,
        getSession,
        commandActions,
        startCodexSideConversation,
        closeCodexSideConversation,
        enqueuePrompt,
        resolveSecurityContext,
        ensureWorkspace,
        getSessionLanguage,
        buildHeaderComponents,
      });
      await respond({ content: formatCodexSideResult(result, language), flags: 64 });
      return true;
    }

    if (parsed.action === 'tell') {
      const sideSession = getSession(interaction.channelId, { channel: interaction.channel });
      if (sideSession?.sideConversation?.status !== 'open'
        || sideSession.sideConversation.parentChannelId !== parsed.parentChannelId) {
        await respond({ content: language === 'en' ? 'This side thread is no longer open.' : '这个旁问已经关闭。', flags: 64 });
        return true;
      }
      const outcome = await steerProviderTask({
        session: parentSession,
        sessionKey: parsed.parentChannelId,
        prompt: question,
      });
      if (!outcome?.steered) {
        await respond({ content: language === 'en' ? 'The main task is not accepting updates right now.' : '主任务现在不能接收补充。', flags: 64 });
        return true;
      }
      await respond({ content: language === 'en' ? 'Sent to the main task.' : '已告诉主任务。', flags: 64 });
      return true;
    }

    return false;
  }

  return {
    buildHeaderComponents,
    buildRunningTaskComponents,
    handleComponent,
    handleModalSubmit,
    isComponentId: isCodexSideComponentId,
    isModalId: isCodexSideModalId,
  };
}
