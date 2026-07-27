import fs from 'node:fs';
import {
  getActionButtonCommandNames,
  normalizeCommandName,
} from './command-spec.js';
import {
  createProviderForkThread,
  formatProviderForkResult,
  normalizeForkSessionId,
  providerSupportsNativeFork,
} from './codex-fork-flow.js';
import {
  closeCodexSideConversationFlow,
  createCodexSideConversation,
  formatCodexSideCloseResult,
  formatCodexSideResult,
  formatCodexSideStatus,
} from './codex-side-flow.js';
import {
  CODEX_GOAL_CONTINUATION_PROMPT,
  executeCodexGoalAction,
  formatCodexGoalResult,
  parseCodexGoalSlashInput,
  shouldStartCodexGoalContinuation,
} from './codex-goal-flow.js';
import {
  formatProjectUpgradeReport,
  parseProjectUpgradeSlashInput,
} from './project-upgrade.js';
import {
  getInboundInteractionField,
  getInboundInteractionOption,
} from './platforms/inbound-event.js';
import { assertInteractionResponse } from './platforms/interaction-response.js';
import {
  DEFAULT_CONVERSATION_PRESENTATION,
  assertConversationPresentation,
} from './platforms/conversation-presentation.js';
import { assertConversationSpawn } from './platforms/conversation-spawn.js';

const ACTION_BUTTON_PREFIX = 'cmd';
const ACTION_BUTTON_COMMANDS = new Set(getActionButtonCommandNames());
const GOAL_MODAL_PREFIX = 'goalm';
const GOAL_OBJECTIVE_INPUT_ID = 'goal_objective';
const GOAL_TOKEN_BUDGET_INPUT_ID = 'goal_token_budget';

function formatThreadsUnavailable(language = 'zh') {
  return language === 'en'
    ? '❌ This platform does not support thread-based conversations.'
    : '❌ 当前平台不支持基于 thread 的会话功能。';
}

function isExistingDirectory(dir) {
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function registerSlashHandlers(map, names, handler) {
  for (const name of names) {
    const key = String(name || '').trim().toLowerCase();
    if (!key) continue;
    map.set(key, handler);
  }
}

function getInteractionChannel(interaction) {
  return interaction?.conversation?.raw || null;
}

function getInteractionUserId(interaction) {
  return String(interaction?.actor?.id || '').trim();
}

export function buildCommandActionButtonId(command, userId) {
  const normalizedCommand = String(command || '').trim().toLowerCase();
  const normalizedUserId = String(userId || '').trim();
  return `${ACTION_BUTTON_PREFIX}:${normalizedCommand}:${normalizedUserId}`;
}

export function parseCommandActionButtonId(customId) {
  const match = /^cmd:([a-z_]+):([a-z0-9_-]{1,64})$/i.exec(String(customId || '').trim());
  if (!match) return null;

  const command = normalizeCommandName(match[1]);
  const userId = String(match[2] || '').trim();
  if (!ACTION_BUTTON_COMMANDS.has(command)) return null;
  return { command, userId };
}

export function isCommandActionButtonId(customId) {
  return Boolean(parseCommandActionButtonId(customId));
}

export function createSlashCommandRouter({
  platformCapabilities = null,
  botProvider = null,
  defaultUiLanguage = 'zh',
  slashRef = (name) => `/${name}`,
  messageDelivery = null,
  conversationPresentation = DEFAULT_CONVERSATION_PRESENTATION,
  getSession,
  getSessionLanguage,
  getSessionProvider,
  getSessionId = (session) => session?.runnerSessionId || session?.codexThreadId || null,
  getProviderDisplayName,
  getEffectiveSecurityProfile,
  getRuntimeSnapshot = () => ({ running: false, queued: 0 }),
  resolveFastModeSetting = () => ({ enabled: false, supported: false, source: 'provider unsupported' }),
  resolveRuntimeModeSetting = () => ({ mode: 'normal', supported: false, source: 'provider unsupported' }),
  resolveTimeoutSetting,
  resolveModelSetting = (session) => ({ value: session?.model || null }),
  resolveReasoningEffortSetting = (session) => ({ value: session?.effort || null }),
  getModelCatalog = () => ({ models: [], error: null }),
  isReasoningEffortSupported,
  commandActions = {},
  isOnboardingEnabled,
  buildOnboardingActionRows,
  buildOnboardingView = null,
  interactionResponse,
  formatOnboardingStepReport,
  formatOnboardingDisabledMessage,
  formatOnboardingConfigReport,
  formatStatusReport,
  formatQueueReport,
  formatDoctorReport,
  formatWorkspaceReport,
  formatWorkspaceSetHelp,
  formatWorkspaceUpdateReport,
  formatDefaultWorkspaceSetHelp,
  formatDefaultWorkspaceUpdateReport,
  formatLanguageConfigReport,
  formatFastModeConfigHelp = () => '',
  formatFastModeConfigReport = () => '',
  formatRuntimeModeConfigHelp = () => '',
  formatRuntimeModeConfigReport = () => '',
  formatProfileConfigHelp,
  formatProfileConfigReport,
  formatTimeoutConfigHelp,
  formatTimeoutConfigReport,
  formatProgressReport,
  formatCancelReport,
  formatCompactStrategyConfigHelp,
  formatCompactConfigReport,
  formatExtraInfoConfigHelp,
  formatExtraInfoConfigReport,
  formatCompactConfigUnsupported = (provider) => `Compact config unsupported for ${provider}`,
  formatProviderSessionLabel = (provider) => `${provider} session`,
  formatReasoningEffortUnsupported,
  normalizeProvider,
  parseWorkspaceCommandAction,
  parseUiLanguageInput,
  parseFastModeAction = () => ({ type: 'status' }),
  parseRuntimeModeAction = () => ({ type: 'status' }),
  parseSecurityProfileInput,
  parseTimeoutConfigAction,
  parseCompactConfigAction,
  parseExtraInfoConfigAction = () => ({ type: 'status' }),
  getProjectUpgradeStatus = async () => ({ ok: false, error: 'project upgrade unavailable' }),
  setProjectUpgradeMode = null,
  applyProjectUpgrade = null,
  requestProjectUpgradeRestart = null,
  canManageProjectUpgrade = () => true,
  providerSupportsCompactConfigAction = () => true,
  cancelChannelWork,
  closeRuntimeSession = () => false,
  retryLastPrompt,
  compactSession,
  forkCodexThread,
  startCodexSideConversation,
  closeCodexSideConversation,
  conversationSpawn,
  resolveForkWorkspace,
  getCodexThreadGoal,
  setCodexThreadGoal,
  clearCodexThreadGoal,
  enqueuePrompt,
  resolveSecurityContext,
  openWorkspaceBrowser,
  openSettingsPanel,
  openModelSettingsPanel,
  ensureWorkspace,
  resolvePath,
  safeError,
} = {}) {
  const responsePort = assertInteractionResponse(interactionResponse);
  const presentation = assertConversationPresentation(conversationPresentation);
  const sendToConversation = typeof messageDelivery?.send === 'function'
    ? messageDelivery.send
    : null;
  const supportsThreads = platformCapabilities?.threads !== false;
  const handlers = new Map();
  const formatError = (err) => (typeof safeError === 'function' ? safeError(err) : String(err?.message || err));

  function createPromptMessageFromInteraction(interaction) {
    const port = assertConversationSpawn(conversationSpawn);
    return port.createPromptMessage(interaction, interaction?.conversation, {
      reply: sendToConversation,
    });
  }

  function parseGoalModalId(customId) {
    const match = /^goalm:(set|budget):([a-z0-9_-]{1,64})$/i.exec(String(customId || '').trim());
    if (!match) return null;
    return {
      action: match[1].toLowerCase(),
      userId: match[2],
    };
  }

  function isGoalModalId(customId) {
    return Boolean(parseGoalModalId(customId));
  }

  function shouldHandleBeforeDefer({ interaction, commandName } = {}) {
    const normalizedCommand = normalizeCommandName(commandName || interaction?.command?.name || '');
    if (normalizedCommand !== 'goal') return false;
    return false;
  }

  async function maybeEnqueueCodexGoalContinuation({ action, result, interaction, key, session }) {
    if (!shouldStartCodexGoalContinuation(action, result)) return result;
    if (typeof enqueuePrompt !== 'function') {
      return { ...result, continuation: { state: 'failed', reason: 'enqueue unavailable' } };
    }
    try {
      const security = typeof resolveSecurityContext === 'function'
        ? resolveSecurityContext(getInteractionChannel(interaction), session)
        : null;
      const queued = await enqueuePrompt(
        createPromptMessageFromInteraction(interaction),
        key,
        CODEX_GOAL_CONTINUATION_PROMPT,
        security,
      );
      if (queued?.enqueued) {
        return {
          ...result,
          continuation: {
            state: 'enqueued',
            queuedAhead: queued.queuedAhead || 0,
          },
        };
      }
      return {
        ...result,
        continuation: {
          state: 'failed',
          reason: queued?.reason || 'enqueue failed',
        },
      };
    } catch (err) {
      return {
        ...result,
        continuation: {
          state: 'failed',
          reason: safeError(err),
        },
      };
    }
  }

  const closeRuntimeForKey = (key, reason = 'runtime config changed') => {
    try {
      closeRuntimeSession(key, reason);
    } catch {
    }
  };

  registerSlashHandlers(handlers, ['status'], async ({ interaction, key, session, respond }) => {
    await respond({
      content: await formatStatusReport(key, session, getInteractionChannel(interaction)),
      visibility: 'ephemeral',
    });
  });

  registerSlashHandlers(handlers, ['settings'], async ({ interaction, key, session, respond }) => {
    if (typeof openSettingsPanel !== 'function') {
      await respond({
        content: '❌ 当前环境未启用 settings 面板。',
        visibility: 'ephemeral',
      });
      return;
    }

    await respond(openSettingsPanel({
      key,
      session,
      userId: getInteractionUserId(interaction),
      activeSection: getSessionProvider(session) === 'codex' ? 'defaults' : 'overview',
      visibility: 'ephemeral',
    }));
  });

  registerSlashHandlers(handlers, ['new'], async ({ interaction, key, session, respond }) => {
    const outcome = cancelChannelWork(key, 'slash_new');
    commandActions.startNewSession(session);
    closeRuntimeForKey(key, 'new session');
    const lines = ['🆕 已切换到新会话。'];
    if (outcome.cancelledRunning) lines.push('当前运行中的任务已尝试取消。');
    if (outcome.clearedQueued > 0) lines.push(`已清空 ${outcome.clearedQueued} 个排队任务。`);
    lines.push('下一条普通消息会开启新的上下文。');
    await respond({
      content: lines.join('\n'),
      visibility: 'ephemeral',
    });
  });

  registerSlashHandlers(handlers, ['reset'], async ({ interaction, key, session, respond }) => {
    commandActions.resetSession(session);
    closeRuntimeForKey(key, 'reset session');
    await respond({
      content: '♻️ 会话与额外配置已清空，下条消息新开上下文。',
      visibility: 'ephemeral',
    });
  });

  registerSlashHandlers(handlers, ['sessions'], async ({ interaction, key, session, respond }) => {
    try {
      await respond({
        content: commandActions.formatRecentSessionsReport({
          key,
          session,
          resumeRef: slashRef('resume'),
        }),
        visibility: 'ephemeral',
      });
    } catch (err) {
      await respond({
        content: `❌ ${safeError(err)}`,
        visibility: 'ephemeral',
      });
    }
  });

  registerSlashHandlers(handlers, ['setdir'], async ({ interaction, key, session, respond }) => {
    const action = parseWorkspaceCommandAction(getInboundInteractionOption(interaction, 'path'));
    if (!action || action.type === 'invalid') {
      await respond({ content: formatWorkspaceSetHelp(getSessionLanguage(session)), visibility: 'ephemeral' });
      return;
    }
    if (action.type === 'status') {
      await respond({ content: formatWorkspaceReport(key, session), visibility: 'ephemeral' });
      return;
    }
    if (action.type === 'clear') {
      const result = commandActions.clearWorkspaceDir(session, key);
      closeRuntimeForKey(key);
      await respond({ content: formatWorkspaceUpdateReport(key, session, result), visibility: 'ephemeral' });
      return;
    }
    if (action.type === 'browse') {
      if (typeof openWorkspaceBrowser !== 'function') {
        await respond({ content: formatWorkspaceSetHelp(getSessionLanguage(session)), visibility: 'ephemeral' });
        return;
      }
      await respond(openWorkspaceBrowser({
        key,
        session,
        userId: getInteractionUserId(interaction),
        mode: 'thread',
        visibility: 'ephemeral',
      }));
      return;
    }

    const resolved = resolvePath(action.value);
    if (!isExistingDirectory(resolved)) {
      await respond({ content: `❌ 目录不存在或不是目录：\`${resolved}\``, visibility: 'ephemeral' });
      return;
    }

    const result = commandActions.setWorkspaceDir(session, key, resolved);
    closeRuntimeForKey(key);
    await respond({ content: formatWorkspaceUpdateReport(key, session, result), visibility: 'ephemeral' });
  });

  registerSlashHandlers(handlers, ['setdefaultdir'], async ({ interaction, key, session, respond }) => {
    const action = parseWorkspaceCommandAction(getInboundInteractionOption(interaction, 'path'));
    if (!action || action.type === 'invalid') {
      await respond({ content: formatDefaultWorkspaceSetHelp(getSessionLanguage(session)), visibility: 'ephemeral' });
      return;
    }
    if (action.type === 'status') {
      await respond({ content: formatWorkspaceReport(key, session), visibility: 'ephemeral' });
      return;
    }
    if (action.type === 'clear') {
      const result = commandActions.setDefaultWorkspaceDir(session, null);
      closeRuntimeForKey(key);
      await respond({ content: formatDefaultWorkspaceUpdateReport(key, session, result), visibility: 'ephemeral' });
      return;
    }
    if (action.type === 'browse') {
      if (typeof openWorkspaceBrowser !== 'function') {
        await respond({ content: formatDefaultWorkspaceSetHelp(getSessionLanguage(session)), visibility: 'ephemeral' });
        return;
      }
      await respond(openWorkspaceBrowser({
        key,
        session,
        userId: getInteractionUserId(interaction),
        mode: 'default',
        visibility: 'ephemeral',
      }));
      return;
    }

    const resolved = resolvePath(action.value);
    if (!isExistingDirectory(resolved)) {
      await respond({ content: `❌ 目录不存在或不是目录：\`${resolved}\``, visibility: 'ephemeral' });
      return;
    }

    const result = commandActions.setDefaultWorkspaceDir(session, resolved);
    closeRuntimeForKey(key);
    await respond({ content: formatDefaultWorkspaceUpdateReport(key, session, result), visibility: 'ephemeral' });
  });

  registerSlashHandlers(handlers, ['provider'], async ({ interaction, key, session, respond }) => {
    if (botProvider) {
      await respond({
        content: `🔒 当前 bot 已锁定 provider = \`${botProvider}\` (${getProviderDisplayName(botProvider)})，不能在频道内切换。`,
        visibility: 'ephemeral',
      });
      return;
    }

    const rawRequested = getInboundInteractionOption(interaction, 'name');
    if (rawRequested === 'status') {
      await respond({
        content: `ℹ️ 当前 provider = \`${getSessionProvider(session)}\` (${getProviderDisplayName(getSessionProvider(session))})`,
        visibility: 'ephemeral',
      });
      return;
    }

    const requested = normalizeProvider(rawRequested);
    const { previous } = commandActions.setProvider(session, requested);
    closeRuntimeForKey(key);
    await respond(`✅ provider = \`${requested}\` (${getProviderDisplayName(requested)})${previous === requested ? '' : '，已清空旧 session 绑定'}`);
  });

  registerSlashHandlers(handlers, ['model'], async ({ interaction, key, session, respond }) => {
    const name = getInboundInteractionOption(interaction, 'name');
    const effort = getInboundInteractionOption(interaction, 'effort');
    const provider = getSessionProvider(session);
    const language = getSessionLanguage(session);

    if (!name && !effort) {
      if (typeof openModelSettingsPanel === 'function') {
        await respond(openModelSettingsPanel({
          key,
          session,
          userId: getInteractionUserId(interaction),
          visibility: 'ephemeral',
        }));
        return;
      }
      await respond({
        content: language === 'en' ? '❌ Model settings panel is unavailable.' : '❌ 当前环境没有可用的 model 设置面板。',
        visibility: 'ephemeral',
      });
      return;
    }

    const prospectiveSession = { ...session };
    if (name) prospectiveSession.model = String(name).trim().toLowerCase() === 'default' ? null : name;
    if (effort) prospectiveSession.effort = effort === 'default' ? null : effort;
    const requestedModel = resolveModelSetting(prospectiveSession)?.value;
    const effectiveEffort = String(resolveReasoningEffortSetting(prospectiveSession)?.value || '').trim().toLowerCase();
    const requestedEffort = effectiveEffort
      && !effectiveEffort.includes('default')
      && !effectiveEffort.startsWith('(')
      && !effectiveEffort.startsWith('（')
      ? effectiveEffort
      : null;
    const catalog = getModelCatalog(provider) || {};
    const catalogModel = Array.isArray(catalog.models)
      ? catalog.models.find((model) => String(model?.slug || '').trim() === String(requestedModel || '').trim())
      : null;
    const rawLevels = catalogModel?.supportedReasoningLevels || catalogModel?.supported_reasoning_levels;
    const catalogLevels = Array.isArray(rawLevels)
      ? rawLevels.map((level) => String(level?.effort || level || '').trim().toLowerCase()).filter(Boolean)
      : [];
    if (requestedEffort && catalogModel && catalogLevels.length && !catalogLevels.includes(String(requestedEffort).toLowerCase())) {
      await respond({
        content: language === 'en'
          ? `❌ Model \`${requestedModel}\` does not support effort \`${requestedEffort}\`.`
          : `❌ 模型 \`${requestedModel}\` 不支持 effort \`${requestedEffort}\`。`,
        visibility: 'ephemeral',
      });
      return;
    }
    if (effort && effort !== 'default' && !catalogLevels.includes(String(effort).toLowerCase()) && !isReasoningEffortSupported(provider, effort)) {
        await respond({
          content: formatReasoningEffortUnsupported(provider, language),
          visibility: 'ephemeral',
        });
        return;
    }

    const updates = [];
    if (name) {
      const { model } = commandActions.setModel(session, name);
      updates.push(`model = ${model || '(provider default)'}`);
    }
    if (effort) {
      const { effort: updatedEffort } = commandActions.setReasoningEffort(session, effort);
      updates.push(`effort = ${updatedEffort || '(provider default)'}`);
    }
    closeRuntimeForKey(key);
    await respond(`✅ ${updates.join('，')}`);
  });

  registerSlashHandlers(handlers, ['fast'], async ({ interaction, session, respond }) => {
    const provider = getSessionProvider(session);
    const language = getSessionLanguage(session);
    const action = parseFastModeAction(getInboundInteractionOption(interaction, 'action'));
    if (provider !== 'codex') {
      await respond({
        content: formatFastModeConfigReport(language, provider, { enabled: false, supported: false, source: 'provider unsupported' }, false),
        visibility: 'ephemeral',
      });
      return;
    }
    if (!action || action.type === 'invalid') {
      await respond({
        content: formatFastModeConfigHelp(language, provider),
        visibility: 'ephemeral',
      });
      return;
    }
    if (action.type === 'status') {
      await respond({
        content: formatFastModeConfigReport(language, provider, resolveFastModeSetting(session), false),
        visibility: 'ephemeral',
      });
      return;
    }
    const { fastModeSetting } = commandActions.setFastMode(session, action.enabled);
    await respond({
      content: formatFastModeConfigReport(language, provider, fastModeSetting, true),
      visibility: 'ephemeral',
    });
  });

  registerSlashHandlers(handlers, ['runtime'], async ({ interaction, key, session, respond }) => {
    const provider = getSessionProvider(session);
    const language = getSessionLanguage(session);
    const action = parseRuntimeModeAction(getInboundInteractionOption(interaction, 'mode'));
    if (provider !== 'claude' && provider !== 'codex') {
      await respond({
        content: formatRuntimeModeConfigReport(language, provider, { mode: 'normal', supported: false, source: 'provider unsupported' }, false),
        visibility: 'ephemeral',
      });
      return;
    }
    if (!action || action.type === 'invalid') {
      await respond({
        content: formatRuntimeModeConfigHelp(language, provider),
        visibility: 'ephemeral',
      });
      return;
    }
    if (action.type === 'status') {
      await respond({
        content: formatRuntimeModeConfigReport(language, provider, resolveRuntimeModeSetting(session), false),
        visibility: 'ephemeral',
      });
      return;
    }
    commandActions.setRuntimeMode(session, action.mode);
    closeRuntimeForKey(key);
    await respond({
      content: formatRuntimeModeConfigReport(language, provider, resolveRuntimeModeSetting(session), true),
      visibility: 'ephemeral',
    });
  });

  registerSlashHandlers(handlers, ['effort'], async ({ interaction, key, session, respond }) => {
    const level = getInboundInteractionOption(interaction, 'level');
    const provider = getSessionProvider(session);
    if (level !== 'default' && !isReasoningEffortSupported(provider, level)) {
      await respond({
        content: formatReasoningEffortUnsupported(provider, getSessionLanguage(session)),
        visibility: 'ephemeral',
      });
      return;
    }

    const { effort } = commandActions.setReasoningEffort(session, level);
    closeRuntimeForKey(key);
    await respond(`✅ effort = ${effort || '(provider default)'}`);
  });

  registerSlashHandlers(handlers, ['compact'], async ({ interaction, key, session, respond }) => {
    const provider = getSessionProvider(session);
    const language = getSessionLanguage(session);
    const parsed = parseCompactConfigAction(
      getInboundInteractionOption(interaction, 'key'),
      getInboundInteractionOption(interaction, 'value') || '',
    );
    if (!parsed || parsed.type === 'invalid') {
      await respond({
        content: formatCompactStrategyConfigHelp(language, provider),
        visibility: 'ephemeral',
      });
      return;
    }
    if (!providerSupportsCompactConfigAction(provider, parsed)) {
      await respond({
        content: formatCompactConfigUnsupported(provider, parsed, language),
        visibility: 'ephemeral',
      });
      return;
    }
    if (parsed.type === 'status') {
      await respond({
        content: formatCompactConfigReport(language, session, false),
        visibility: 'ephemeral',
      });
      return;
    }
    if (parsed.type === 'run') {
      if (typeof compactSession !== 'function') {
        await respond({
          content: language === 'en' ? '❌ Manual compact is unavailable.' : '❌ 当前环境不能手动压缩。',
          visibility: 'ephemeral',
        });
        return;
      }
      await respond({
        content: language === 'en' ? 'Manual compact started.' : '已开始手动压缩。',
        visibility: 'ephemeral',
      });
      await compactSession(createPromptMessageFromInteraction(interaction), key);
      return;
    }
    commandActions.applyCompactConfig(session, parsed);
    await respond({
      content: formatCompactConfigReport(language, session, true),
      visibility: 'ephemeral',
    });
  });

  registerSlashHandlers(handlers, ['extra_info', 'extrainfo'], async ({ interaction, key, session, respond }) => {
    const language = getSessionLanguage(session);
    const parsed = parseExtraInfoConfigAction(
      getInboundInteractionOption(interaction, 'key'),
      getInboundInteractionOption(interaction, 'value') || '',
    );
    if (!parsed || parsed.type === 'invalid') {
      await respond({
        content: formatExtraInfoConfigHelp(language),
        visibility: 'ephemeral',
      });
      return;
    }
    if (parsed.type === 'status') {
      await respond({
        content: formatExtraInfoConfigReport(language, session, key, getInteractionChannel(interaction), false),
        visibility: 'ephemeral',
      });
      return;
    }
    if (parsed.type === 'set_enabled') {
      commandActions.setExtraInfoEnabled(session, parsed.enabled);
    } else if (parsed.type === 'set_text') {
      commandActions.setExtraInfoText(session, parsed.text);
    } else if (parsed.type === 'reset') {
      commandActions.resetExtraInfo(session);
    }
    await respond({
      content: formatExtraInfoConfigReport(language, session, key, getInteractionChannel(interaction), true),
      visibility: 'ephemeral',
    });
  });

  registerSlashHandlers(handlers, ['mode'], async ({ interaction, key, session, respond }) => {
    const type = getInboundInteractionOption(interaction, 'type');
    const { mode } = commandActions.setMode(session, type);
    closeRuntimeForKey(key);
    await respond(`✅ mode = ${mode}`);
  });

  registerSlashHandlers(handlers, ['resume'], async ({ interaction, key, session, respond }) => {
    const sid = getInboundInteractionOption(interaction, 'session_id');
    const binding = commandActions.bindSession(session, interaction.conversation.id, sid);
    if (!binding.sessionId && binding.missingWorkspaceDir) {
      await respond(`❌ 这个 ${formatProviderSessionLabel(binding.provider, 'zh')} 对应的 workspace 不存在：\`${binding.missingWorkspaceDir}\``);
      return;
    }
    const notes = [];
    if (binding.adoptedWorkspaceDir) {
      notes.push(`已切到 session 对应 workspace：\`${binding.adoptedWorkspaceDir}\``);
    }
    if (binding.displacedKeys?.length) {
      notes.push('已清掉其他线程里重复绑定的同一 session。');
    }
    await respond([
      `✅ 已绑定 ${formatProviderSessionLabel(binding.provider, 'zh')}: \`${binding.sessionId}\``,
        ...notes,
      ].join('\n'));
    closeRuntimeForKey(key, 'resume session');
  });

  registerSlashHandlers(handlers, ['fork'], async ({ interaction, key, session, respond }) => {
    const language = getSessionLanguage(session);
    if (!supportsThreads) {
      await respond({
        content: formatThreadsUnavailable(language),
        visibility: 'ephemeral',
      });
      return;
    }
    const provider = getSessionProvider(session);
    if (!providerSupportsNativeFork(provider)) {
      await respond({
        content: language === 'en'
          ? `❌ Native fork is not available for ${getProviderDisplayName(provider)}.`
          : `❌ ${getProviderDisplayName(provider)} 不支持原生 fork。`,
        visibility: 'ephemeral',
      });
      return;
    }

    const parentSessionId = normalizeForkSessionId(getSessionId(session));
    const threadName = getInboundInteractionOption(interaction, 'name') || '';
    try {
      const result = await createProviderForkThread({
        key,
        session,
        source: interaction,
        parentSessionId,
        threadName,
        provider,
        getRuntimeSnapshot,
        getSession,
        commandActions,
        forkCodexThread,
        conversationSpawn,
        conversationPresentation: presentation,
        resolveForkWorkspace,
        enqueuePrompt,
        resolveSecurityContext,
      });
      await respond({
        content: formatProviderForkResult(result, language, presentation),
        visibility: 'ephemeral',
      });
    } catch (err) {
      await respond({
        content: `❌ ${getProviderDisplayName(provider)} fork 失败：${safeError(err)}`,
        visibility: 'ephemeral',
      });
    }
  });

  registerSlashHandlers(handlers, ['side'], async ({ interaction, key, session, respond }) => {
    const language = getSessionLanguage(session);
    if (!supportsThreads) {
      await respond({
        content: formatThreadsUnavailable(language),
        visibility: 'ephemeral',
      });
      return;
    }
    const provider = getSessionProvider(session);
    const action = String(getInboundInteractionOption(interaction, 'action') || 'start').trim().toLowerCase();
    if (provider !== 'codex') {
      await respond({
        content: formatCodexSideResult({ ok: false, reason: 'provider_unsupported', provider }, language, presentation),
        visibility: 'ephemeral',
      });
      return;
    }
    try {
      if (action === 'status') {
        const meta = session.openSideConversation?.status === 'open'
          ? session.openSideConversation
          : session.sideConversation?.status === 'open'
            ? session.sideConversation
            : null;
        await respond({
          content: formatCodexSideStatus(
            session,
            language,
            meta ? getRuntimeSnapshot(meta.sideChannelId) : null,
            conversationSpawn,
            presentation,
          ),
          visibility: 'ephemeral',
        });
        return;
      }
      if (action === 'close') {
        const result = await closeCodexSideConversationFlow({
          key,
          session,
          getSession,
          commandActions,
          closeCodexSideConversation,
          cancelChannelWork,
          source: interaction,
          conversationSpawn,
        });
        await respond({ content: formatCodexSideCloseResult(result, language), visibility: 'ephemeral' });
        return;
      }
      if (resolveRuntimeModeSetting(session).mode !== 'long') {
        await respond({
          content: formatCodexSideResult({ ok: false, reason: 'unsupported_runtime' }, language, presentation),
          visibility: 'ephemeral',
        });
        return;
      }
      const result = await createCodexSideConversation({
        key,
        session,
        source: interaction,
        parentSessionId: normalizeForkSessionId(getSessionId(session)),
        threadName: getInboundInteractionOption(interaction, 'name') || '',
        provider,
        getRuntimeSnapshot,
        getSession,
        commandActions,
        startCodexSideConversation,
        closeCodexSideConversation,
        ensureWorkspace,
        getSessionLanguage,
        conversationSpawn,
        conversationPresentation: presentation,
      });
      await respond({
        content: formatCodexSideResult(result, language, presentation),
        visibility: 'ephemeral',
      });
    } catch (err) {
      await respond({
        content: `❌ Codex side 失败：${safeError(err)}`,
        visibility: 'ephemeral',
      });
    }
  });

  registerSlashHandlers(handlers, ['goal'], async ({ interaction, key, session, respond }) => {
    const language = getSessionLanguage(session);
    const provider = getSessionProvider(session);
    const rawAction = String(getInboundInteractionOption(interaction, 'action') || 'status').trim().toLowerCase();
    const action = parseCodexGoalSlashInput({
      action: rawAction,
      objective: getInboundInteractionOption(interaction, 'objective') || '',
      tokenBudget: getInboundInteractionOption(interaction, 'token_budget') || '',
    });
    try {
      const result = await executeCodexGoalAction({
        action,
        session,
        provider,
        getSessionId,
        getCodexThreadGoal,
        setCodexThreadGoal,
        clearCodexThreadGoal,
      });
      const withContinuation = await maybeEnqueueCodexGoalContinuation({
        action,
        result,
        interaction,
        key,
        session,
      });
      await respond({
        content: formatCodexGoalResult(withContinuation, language),
        visibility: 'ephemeral',
      });
    } catch (err) {
      await respond({
        content: `❌ Codex goal 失败：${safeError(err)}`,
        visibility: 'ephemeral',
      });
    }
  });

  async function handleGoalModalSubmit(interaction) {
    const parsed = parseGoalModalId(interaction?.modal?.id);
    if (!parsed) return false;
    const key = interaction?.conversation?.id;
    const channel = getInteractionChannel(interaction);
    const session = getSession(key, { conversation: interaction?.conversation || null });
    const language = getSessionLanguage(session);
    if (getInteractionUserId(interaction) !== parsed.userId) {
      await responsePort.respond(interaction, {
        content: '⛔ 这个 goal 输入框属于另一个用户。',
        visibility: 'ephemeral',
      });
      return true;
    }

    const action = parsed.action === 'set'
      ? parseCodexGoalSlashInput({
        action: 'set',
        objective: getInboundInteractionField(interaction, GOAL_OBJECTIVE_INPUT_ID),
        tokenBudget: getInboundInteractionField(interaction, GOAL_TOKEN_BUDGET_INPUT_ID),
      })
      : parseCodexGoalSlashInput({
        action: 'budget',
        tokenBudget: getInboundInteractionField(interaction, GOAL_TOKEN_BUDGET_INPUT_ID),
      });

    try {
      const result = await executeCodexGoalAction({
        action,
        session,
        provider: getSessionProvider(session),
        getSessionId,
        getCodexThreadGoal,
        setCodexThreadGoal,
        clearCodexThreadGoal,
      });
      const withContinuation = await maybeEnqueueCodexGoalContinuation({
        action,
        result,
        interaction,
        key,
        session,
      });
      await responsePort.respond(interaction, {
        content: formatCodexGoalResult(withContinuation, language),
        visibility: 'ephemeral',
      });
    } catch (err) {
      await responsePort.respond(interaction, {
        content: `❌ Codex goal 失败：${formatError(err)}`,
        visibility: 'ephemeral',
      });
    }
    return true;
  }

  registerSlashHandlers(handlers, ['name'], async ({ interaction, session, respond }) => {
    const label = getInboundInteractionOption(interaction, 'label').trim();
    const renamed = commandActions.renameSession(session, label);
    await respond(`✅ session 命名为: **${renamed.label}**`);
  });

  registerSlashHandlers(handlers, ['queue'], async ({ interaction, key, session, respond }) => {
    await respond({
      content: formatQueueReport(key, session, getInteractionChannel(interaction)),
      visibility: 'ephemeral',
    });
  });

  registerSlashHandlers(handlers, ['upgrade'], async ({ interaction, session, respond }) => {
    const language = getSessionLanguage(session);
    const action = parseProjectUpgradeSlashInput({
      action: getInboundInteractionOption(interaction, 'action') || 'status',
      mode: getInboundInteractionOption(interaction, 'mode') || '',
    });
    if (action.type === 'set_mode') {
      if (!canManageProjectUpgrade(getInteractionUserId(interaction))) {
        await respond({ content: '❌ 只有项目升级管理员可以修改升级模式。', visibility: 'ephemeral' });
        return;
      }
      if (typeof setProjectUpgradeMode !== 'function') {
        await respond({ content: '❌ 当前环境未启用项目升级设置。', visibility: 'ephemeral' });
        return;
      }
      await respond({
        content: formatProjectUpgradeReport(null, language, { changedMode: setProjectUpgradeMode(action.mode) }),
        visibility: 'ephemeral',
      });
      return;
    }
    if (action.type === 'apply') {
      if (!canManageProjectUpgrade(getInteractionUserId(interaction))) {
        await respond({ content: '❌ 只有项目升级管理员可以执行升级。', visibility: 'ephemeral' });
        return;
      }
      if (typeof applyProjectUpgrade !== 'function') {
        await respond({ content: '❌ 当前环境未启用项目升级。', visibility: 'ephemeral' });
        return;
      }
      const result = await applyProjectUpgrade();
      await respond({
        content: formatProjectUpgradeReport(null, language, { applyResult: result }),
        visibility: 'ephemeral',
      });
      if (result?.ok && result.changed && typeof requestProjectUpgradeRestart === 'function') {
        setTimeout(() => requestProjectUpgradeRestart(), 750);
      }
      return;
    }
    await respond({
      content: formatProjectUpgradeReport(await getProjectUpgradeStatus({ fetch: true }), language),
      visibility: 'ephemeral',
    });
  });

  registerSlashHandlers(handlers, ['doctor'], async ({ interaction, key, session, respond }) => {
    await respond({
      content: formatDoctorReport(key, session, getInteractionChannel(interaction)),
      visibility: 'ephemeral',
    });
  });

  registerSlashHandlers(handlers, ['onboarding'], async ({ interaction, key, session, respond }) => {
    const language = getSessionLanguage(session);
    if (!isOnboardingEnabled(session)) {
      await respond({
        content: formatOnboardingDisabledMessage(language),
        visibility: 'ephemeral',
      });
      return;
    }

    const step = 1;
    if (buildOnboardingView) {
      await respond(buildOnboardingView(
        step,
        key,
        getInteractionUserId(interaction),
        session,
        getInteractionChannel(interaction),
        language,
        'ephemeral',
      ));
    } else {
      await respond({
        content: formatOnboardingStepReport(step, key, session, getInteractionChannel(interaction), language),
        rows: buildOnboardingActionRows(step, key, getInteractionUserId(interaction), session, language),
        visibility: 'ephemeral',
      });
    }
  });

  registerSlashHandlers(handlers, ['onboarding_config'], async ({ interaction, session, respond }) => {
    const action = String(getInboundInteractionOption(interaction, 'action') || '').trim().toLowerCase();
    const language = getSessionLanguage(session);
    if (action === 'on' || action === 'off') {
      const { enabled } = commandActions.setOnboardingEnabled(session, action === 'on');
      await respond({
        content: formatOnboardingConfigReport(language, enabled, true),
        visibility: 'ephemeral',
      });
      return;
    }

    await respond({
      content: formatOnboardingConfigReport(language, isOnboardingEnabled(session), false),
      visibility: 'ephemeral',
    });
  });

  registerSlashHandlers(handlers, ['language'], async ({ interaction, session, respond }) => {
    const requested = getInboundInteractionOption(interaction, 'name');
    const { language } = commandActions.setLanguage(session, parseUiLanguageInput(requested) || defaultUiLanguage);
    await respond({
      content: formatLanguageConfigReport(language, true),
      visibility: 'ephemeral',
    });
  });

  registerSlashHandlers(handlers, ['profile'], async ({ interaction, session, respond }) => {
    const requested = getInboundInteractionOption(interaction, 'name');
    if (String(requested || '').toLowerCase() === 'status') {
      await respond({
        content: formatProfileConfigReport(getSessionLanguage(session), getEffectiveSecurityProfile(session).profile, false),
        visibility: 'ephemeral',
      });
      return;
    }

    const profile = parseSecurityProfileInput(requested);
    if (!profile) {
      await respond({
        content: formatProfileConfigHelp(getSessionLanguage(session)),
        visibility: 'ephemeral',
      });
      return;
    }

    const updated = commandActions.setSecurityProfile(session, profile);
    await respond({
      content: formatProfileConfigReport(getSessionLanguage(session), updated.profile, true),
      visibility: 'ephemeral',
    });
  });

  registerSlashHandlers(handlers, ['timeout'], async ({ interaction, session, respond }) => {
    const language = getSessionLanguage(session);
    const parsedTimeout = parseTimeoutConfigAction(getInboundInteractionOption(interaction, 'value'));
    if (!parsedTimeout || parsedTimeout.type === 'invalid') {
      await respond({
        content: formatTimeoutConfigHelp(language),
        visibility: 'ephemeral',
      });
      return;
    }
    if (parsedTimeout.type === 'status') {
      await respond({
        content: formatTimeoutConfigReport(language, resolveTimeoutSetting(session), false),
        visibility: 'ephemeral',
      });
      return;
    }

    const { timeoutSetting } = commandActions.setTimeoutMs(session, parsedTimeout.timeoutMs);
    await respond({
      content: formatTimeoutConfigReport(language, timeoutSetting, true),
      visibility: 'ephemeral',
    });
  });

  registerSlashHandlers(handlers, ['progress'], async ({ interaction, key, session, respond }) => {
    await respond({
      content: formatProgressReport(key, session, getInteractionChannel(interaction)),
      visibility: 'ephemeral',
    });
  });

  registerSlashHandlers(handlers, ['cancel', 'abort'], async ({ interaction, key, commandName, session, respond }) => {
    const outcome = cancelChannelWork(key, `slash_${commandName}`);
    await respond({
      content: formatCancelReport(outcome),
      visibility: 'ephemeral',
    });
  });

  registerSlashHandlers(handlers, ['retry'], async ({ interaction, key, session, respond }) => {
    if (typeof retryLastPrompt !== 'function') {
      await respond({
        content: '❌ 当前环境未启用失败任务重试。',
        visibility: 'ephemeral',
      });
      return;
    }

    const outcome = await retryLastPrompt(key, getInteractionUserId(interaction));
    if (!outcome?.enqueued) {
      const content = outcome?.reason === 'queue_full' && Number.isFinite(outcome?.maxQueue)
        ? `🚧 当前频道队列已满（上限 ${outcome.maxQueue}），请稍后再试。`
        : '❌ 没有可重试的失败任务。';
      await respond({
        content,
        visibility: 'ephemeral',
      });
      return;
    }

    const content = outcome.queuedAhead > 0
      ? `🔁 已重新加入队列，前面还有 ${outcome.queuedAhead} 条。`
      : '🔁 已重新加入队列。';
    await respond({
      content,
      visibility: 'ephemeral',
    });
  });

  async function routeSlashCommand({ interaction, commandName, respond } = {}) {
    const key = interaction?.conversation?.id;
    if (!key) {
      await respond({ content: '❌ 无法识别当前频道。', visibility: 'ephemeral' });
      return true;
    }

    const normalizedCommand = normalizeCommandName(commandName);
    const handler = handlers.get(normalizedCommand);
    if (!handler) return false;

    const session = getSession(key, { conversation: interaction?.conversation || null });
    await handler({
      interaction,
      commandName: normalizedCommand,
      key,
      session,
      respond,
    });
    return true;
  }

  routeSlashCommand.isGoalModalId = isGoalModalId;
  routeSlashCommand.handleGoalModalSubmit = handleGoalModalSubmit;
  routeSlashCommand.shouldHandleBeforeDefer = shouldHandleBeforeDefer;
  return routeSlashCommand;
}
