import { randomUUID } from 'node:crypto';
import {
  assertConversationHistory,
  assertConversationSpawn,
  assertSpawnedConversation,
} from './platforms/conversation-spawn.js';
import {
  DEFAULT_CONVERSATION_PRESENTATION,
  assertConversationPresentation,
} from './platforms/conversation-presentation.js';
import { getInboundActorId } from './platforms/inbound-event.js';

const FORKABLE_PROVIDERS = new Set(['codex', 'claude']);

function normalizeForkProvider(value) {
  const text = String(value || '').trim().toLowerCase();
  return text || 'codex';
}

export function providerSupportsNativeFork(provider) {
  return FORKABLE_PROVIDERS.has(normalizeForkProvider(provider));
}

export function normalizeForkSessionId(value) {
  const text = String(value || '').trim();
  return text || null;
}

export function normalizeForkThreadName(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, 100) : '';
}

function normalizeForkWorkspaceDir(value) {
  const text = String(value || '').trim();
  return text || null;
}

function shortenId(value) {
  const text = normalizeForkSessionId(value);
  if (!text) return 'new';
  return text.length <= 12 ? text : text.slice(0, 8);
}

function getForkRequesterId(source) {
  return getInboundActorId(source) || null;
}

function normalizeMessageContent(message) {
  const text = String(message?.text || '').trim();
  return text || null;
}

function compareMessageRecency(a, b) {
  const aTime = Number(a?.createdAtMs || 0);
  const bTime = Number(b?.createdAtMs || 0);
  if (aTime !== bTime) return bTime - aTime;
  try {
    const aId = BigInt(String(a?.id || '0'));
    const bId = BigInt(String(b?.id || '0'));
    if (aId === bId) return 0;
    return aId > bId ? -1 : 1;
  } catch {
    return String(b?.id || '').localeCompare(String(a?.id || ''));
  }
}

function findLatestParentAgentMessage(messages, source) {
  const sourceId = String(source?.id || '').trim();
  return messages
    .filter((message) => {
      if (!message || String(message.id || '') === sourceId) return false;
      if (!normalizeMessageContent(message)) return false;
      if (typeof message.actor?.isCurrentBot === 'boolean') {
        return message.actor.isCurrentBot;
      }
      return Boolean(message.actor?.isBot);
    })
    .sort(compareMessageRecency)[0] || null;
}

function formatLatestAgentReplayContent(text, conversationSpawn, language = 'zh') {
  const body = String(text || '').trim();
  if (!body) return [];
  const title = language === 'en' ? 'Latest agent message:' : '最近一次 agent 输出：';
  const combined = `${title}\n\n${body}`;
  const chunks = conversationSpawn.splitText(combined, 1900);
  return chunks.length ? chunks : [combined.slice(0, 1900).trim()];
}

function isOptionalParentHistoryUnavailableError(error) {
  const code = String(
    error?.code
    || error?.response?.data?.code
    || error?.cause?.code
    || '',
  ).trim().toLowerCase();
  return code === 'user_unauthorized' || code === '230027';
}

async function replayLatestParentAgentMessage(childConversation, {
  conversationSpawn,
  source,
  language = 'zh',
} = {}) {
  try {
    const history = assertConversationHistory(
      await conversationSpawn.listRecentMessages(source, {
        beforeId: source?.id,
        limit: 25,
      }),
    );
    const latest = findLatestParentAgentMessage(history, source);
    const text = normalizeMessageContent(latest);
    if (!text) return { ok: false, skipped: true, reason: 'no_parent_agent_message' };
    const messages = [];
    for (const content of formatLatestAgentReplayContent(text, conversationSpawn, language)) {
      messages.push(await conversationSpawn.send(childConversation, { content }));
    }
    return { ok: true, sourceMessageId: latest.id || null, messages };
  } catch (err) {
    if (isOptionalParentHistoryUnavailableError(err)) {
      return {
        ok: false,
        skipped: true,
        reason: 'parent_history_unavailable',
      };
    }
    return {
      ok: false,
      skipped: false,
      error: String(err?.message || err || 'unknown error'),
    };
  }
}

export function parseForkTextInput(input) {
  return { threadName: normalizeForkThreadName(input) };
}

export function formatForkThreadName({ forkedSessionId, parentSessionId, provider = 'codex' } = {}) {
  const providerLabel = normalizeForkProvider(provider);
  const forkShort = shortenId(forkedSessionId);
  const parentShort = shortenId(parentSessionId);
  return `${providerLabel} fork ${forkShort} from ${parentShort}`.slice(0, 100);
}

export function canSpawnForkConversation(source, conversationSpawn) {
  return Boolean(conversationSpawn?.canSpawn?.(source));
}

export function createSyntheticForkMessage(source, childConversation, conversationSpawn) {
  return assertConversationSpawn(conversationSpawn).createPromptMessage(source, childConversation);
}

function formatForkProviderLabel(provider) {
  const normalizedProvider = normalizeForkProvider(provider);
  if (normalizedProvider === 'claude') return 'Claude';
  if (normalizedProvider === 'antigravity') return 'Antigravity';
  return 'Codex';
}

function formatForkOriginNotice({
  userMention,
  provider,
  parentSessionId,
  forkedSessionId,
  language = 'zh',
  conversationPresentation = DEFAULT_CONVERSATION_PRESENTATION,
} = {}) {
  const presentation = assertConversationPresentation(conversationPresentation);
  const mention = userMention ? `${userMention} ` : '';
  const providerLabel = formatForkProviderLabel(provider);
  if (language === 'en') {
    return `${mention}This ${presentation.getTerm('childConversationShort', 'en')} was forked from ${providerLabel} session \`${parentSessionId}\`. Fork session: \`${forkedSessionId}\`.`;
  }
  return `${mention}这是从 ${providerLabel} session \`${parentSessionId}\` fork 过来的。fork session：\`${forkedSessionId}\`。`;
}

async function sendForkOriginNotice(childConversation, {
  conversationSpawn,
  conversationPresentation,
  source,
  provider,
  parentSessionId,
  forkedSessionId,
  language,
} = {}) {
  const userId = getForkRequesterId(source);
  const content = formatForkOriginNotice({
    userMention: conversationSpawn.formatUserMention(userId),
    provider,
    parentSessionId,
    forkedSessionId,
    language,
    conversationPresentation,
  });
  try {
    const message = await conversationSpawn.send(childConversation, {
      content,
      mentionUserIds: userId ? [userId] : [],
    });
    return { ok: true, message, userId };
  } catch (err) {
    return {
      ok: false,
      skipped: false,
      userId,
      error: String(err?.message || err || 'unknown error'),
    };
  }
}

export async function createCodexForkThread({
  ...options
} = {}) {
  return createProviderForkThread({
    ...options,
    provider: 'codex',
  });
}

export async function createProviderForkThread({
  key,
  session,
  source,
  parentSessionId,
  threadName = '',
  prompt = '',
  provider = 'codex',
  getRuntimeSnapshot = () => ({ running: false, queued: 0 }),
  getSession,
  commandActions = {},
  forkCodexThread,
  enqueuePrompt,
  resolveSecurityContext,
  conversationSpawn,
  conversationPresentation = DEFAULT_CONVERSATION_PRESENTATION,
  generateSessionId = randomUUID,
  resolveForkWorkspace = () => null,
} = {}) {
  const normalizedProvider = normalizeForkProvider(provider);
  const presentation = assertConversationPresentation(conversationPresentation);
  const normalizedParentSessionId = normalizeForkSessionId(parentSessionId);
  if (!normalizedParentSessionId) {
    return { ok: false, reason: 'missing_parent_session' };
  }
  if (!providerSupportsNativeFork(normalizedProvider)) {
    return { ok: false, reason: 'fork_unsupported', provider: normalizedProvider };
  }
  const conversationPort = assertConversationSpawn(conversationSpawn);
  const runtime = getRuntimeSnapshot(key) || {};
  if (runtime.running) {
    return { ok: false, reason: 'parent_running' };
  }
  if (!canSpawnForkConversation(source, conversationPort)) {
    return { ok: false, reason: 'thread_unavailable' };
  }
  if (normalizedProvider === 'codex' && typeof forkCodexThread !== 'function') {
    return { ok: false, reason: 'fork_unavailable' };
  }
  if (typeof getSession !== 'function') {
    throw new Error('getSession is required for provider fork');
  }
  if (typeof commandActions.bindForkedSession !== 'function') {
    throw new Error('bindForkedSession is required for provider fork');
  }

  const plannedForkedSessionId = normalizedProvider === 'claude'
    ? normalizeForkSessionId(generateSessionId())
    : null;
  if (normalizedProvider === 'claude' && !plannedForkedSessionId) {
    throw new Error('Claude fork did not receive a generated session id');
  }
  const forkWorkspaceDir = normalizedProvider === 'claude'
    ? normalizeForkWorkspaceDir(resolveForkWorkspace({
      provider: normalizedProvider,
      parentSessionId: normalizedParentSessionId,
      parentSession: session,
      source,
    }))
    : null;
  if (normalizedProvider === 'claude' && !forkWorkspaceDir) {
    return {
      ok: false,
      reason: 'fork_workspace_unavailable',
      provider: normalizedProvider,
      parentSessionId: normalizedParentSessionId,
    };
  }

  const requestedName = normalizeForkThreadName(threadName);
  const childConversation = assertSpawnedConversation(await conversationPort.spawn(source, {
    name: requestedName || formatForkThreadName({
      parentSessionId: normalizedParentSessionId,
      forkedSessionId: plannedForkedSessionId,
      provider: normalizedProvider,
    }),
    reason: `${normalizedProvider} fork from ${normalizedParentSessionId}`,
  }));
  const childConversationTarget = childConversation.raw;
  if (!childConversation.id) {
    throw new Error(`${presentation.getTerm('childConversation', 'en')} creation did not return a ${presentation.getTerm('childConversationId', 'en')}`);
  }
  const removeChildConversation = async (reason) => {
    try {
      return await conversationPort.remove(childConversation, { reason });
    } catch {
      return null;
    }
  };

  let forkResult = null;
  let forkedSessionId = plannedForkedSessionId;
  if (normalizedProvider === 'codex') {
    try {
      forkResult = await forkCodexThread({
        threadId: normalizedParentSessionId,
      });
    } catch (err) {
      await removeChildConversation('Codex fork failed before session binding');
      throw err;
    }
    forkedSessionId = normalizeForkSessionId(forkResult?.threadId || forkResult?.thread?.id);
    if (!forkedSessionId) {
      await removeChildConversation('Codex fork did not return a session id');
      throw new Error('Codex fork did not return a session id');
    }
  }
  if (!requestedName) {
    await conversationPort.rename(childConversation, {
      name: formatForkThreadName({
        parentSessionId: normalizedParentSessionId,
        forkedSessionId,
        provider: normalizedProvider,
      }),
      reason: `${normalizedProvider} fork session assigned`,
    });
  }

  const childSession = getSession(childConversation.id, {
    parentChannelId: key,
  });
  if (forkWorkspaceDir) {
    childSession.workspaceDir = forkWorkspaceDir;
  }
  const binding = commandActions.bindForkedSession(childSession, {
    sessionId: forkedSessionId,
    parentSessionId: normalizedParentSessionId,
    parentChannelId: key,
    provider: normalizedProvider,
    pendingForkFromSessionId: normalizedProvider === 'claude' ? normalizedParentSessionId : null,
    workspaceDir: forkWorkspaceDir,
  });
  const notice = await sendForkOriginNotice(childConversation, {
    conversationSpawn: conversationPort,
    conversationPresentation: presentation,
    source,
    provider: normalizedProvider,
    parentSessionId: normalizedParentSessionId,
    forkedSessionId,
    language: session?.language || childSession?.language || 'zh',
  });
  const latestAgentReplay = await replayLatestParentAgentMessage(childConversation, {
    conversationSpawn: conversationPort,
    source,
    language: session?.language || childSession?.language || 'zh',
  });

  const normalizedPrompt = String(prompt || '').trim();
  let promptQueue = null;
  if (normalizedPrompt) {
    if (typeof enqueuePrompt !== 'function') {
      promptQueue = { ok: false, enqueued: false, error: 'enqueuePrompt is unavailable' };
    } else {
      try {
        const syntheticMessage = createSyntheticForkMessage(source, childConversation, conversationPort);
        const securityContext = typeof resolveSecurityContext === 'function'
          ? resolveSecurityContext(childConversationTarget, childSession)
          : null;
        promptQueue = await enqueuePrompt(syntheticMessage, childConversation.id, normalizedPrompt, securityContext);
      } catch (err) {
        promptQueue = {
          ok: false,
          enqueued: false,
          error: String(err?.message || err || 'unknown error'),
        };
      }
    }
  }

  return {
    ok: true,
    provider: normalizedProvider,
    parentSessionId: normalizedParentSessionId,
    forkedSessionId,
    forkedFromId: normalizeForkSessionId(forkResult?.forkedFromId) || normalizedParentSessionId,
    childConversation,
    childConversationReference: conversationPort.formatConversationReference(childConversation.id),
    childSession,
    binding,
    notice,
    latestAgentReplay,
    promptQueue,
  };
}

export function formatCodexForkResult(
  result,
  language = 'zh',
  conversationPresentation = DEFAULT_CONVERSATION_PRESENTATION,
) {
  return formatProviderForkResult(result, language, conversationPresentation);
}

export function formatProviderForkResult(
  result,
  language = 'zh',
  conversationPresentation = DEFAULT_CONVERSATION_PRESENTATION,
) {
  const presentation = assertConversationPresentation(conversationPresentation);
  const providerLabel = formatForkProviderLabel(result?.provider || 'codex');
  if (!result?.ok) {
    if (result?.reason === 'missing_parent_session') {
      return language === 'en'
        ? `❌ No ${providerLabel} session is bound here yet. Run one task first.`
        : `❌ ${presentation.getTerm('currentSourceConversation', 'zh')}还没有绑定 ${providerLabel} session。先跑一轮。`;
    }
    if (result?.reason === 'parent_running') {
      return language === 'en'
        ? `⏳ The ${presentation.getTerm('parentSourceConversation', 'en')} is running. Fork after the current task finishes.`
        : `⏳ ${presentation.getTerm('parentSourceConversation', 'zh')}正在运行任务，等这轮结束后再 fork。`;
    }
    if (result?.reason === 'fork_unsupported') {
      return language === 'en'
        ? `❌ Native fork is unavailable for ${providerLabel}.`
        : `❌ ${providerLabel} 不支持原生 fork。`;
    }
    if (result?.reason === 'fork_unavailable') {
      return language === 'en'
        ? `❌ ${providerLabel} native fork is unavailable in this runtime.`
        : `❌ 当前运行环境没有接入 ${providerLabel} 原生 fork。`;
    }
    if (result?.reason === 'fork_workspace_unavailable') {
      return language === 'en'
        ? `❌ Cannot resolve the parent ${providerLabel} workspace for fork.`
        : `❌ 无法解析父 ${providerLabel} session 的工作目录，fork 已取消。`;
    }
    if (result?.reason === 'thread_unavailable') {
      return language === 'en'
        ? `❌ This ${presentation.getTerm('sourceConversation', 'en')} cannot create a fork ${presentation.getTerm('childConversationShort', 'en')}.`
        : `❌ 当前 ${presentation.getTerm('sourceConversation', 'zh')}不能创建 fork ${presentation.getTerm('childConversationShort', 'zh')}。`;
    }
    return language === 'en' ? `❌ ${providerLabel} fork failed.` : `❌ ${providerLabel} fork 失败。`;
  }

  const channelLabel = result.childConversationReference
    || result.childConversation?.id
    || `(new ${presentation.getTerm('childConversationShort', 'en')})`;
  const promptQueued = result.promptQueue?.enqueued;
  const queuedAhead = Number(result.promptQueue?.queuedAhead || 0);
  const promptError = String(result.promptQueue?.error || '').trim();
  const noticeError = result.notice && !result.notice.ok && !result.notice.skipped
    ? String(result.notice.error || '').trim()
    : '';
  const replayError = result.latestAgentReplay && !result.latestAgentReplay.ok && !result.latestAgentReplay.skipped
    ? String(result.latestAgentReplay.error || '').trim()
    : '';
  if (language === 'en') {
    return [
      promptError
        ? `⚠️ Created ${providerLabel} fork in ${channelLabel}, but the prompt was not queued`
        : `✅ Created ${providerLabel} fork in ${channelLabel}`,
      `• fork session: \`${result.forkedSessionId}\``,
      `• parent session: \`${result.parentSessionId}\``,
      promptQueued ? `• prompt queued in fork${queuedAhead > 0 ? ` (${queuedAhead} ahead)` : ''}` : null,
      promptError ? `• error: ${promptError}` : null,
      noticeError ? `• notice failed: ${noticeError}` : null,
      replayError ? `• latest agent message replay failed: ${replayError}` : null,
    ].filter(Boolean).join('\n');
  }
  return [
    promptError
      ? `⚠️ 已创建 ${providerLabel} fork：${channelLabel}，但 prompt 没有入队`
      : `✅ 已创建 ${providerLabel} fork：${channelLabel}`,
    `• fork session: \`${result.forkedSessionId}\``,
    `• parent session: \`${result.parentSessionId}\``,
    promptQueued ? `• prompt 已进入 fork 队列${queuedAhead > 0 ? `，前面还有 ${queuedAhead} 条` : ''}` : null,
    promptError ? `• 错误：${promptError}` : null,
    noticeError ? `• 通知发送失败：${noticeError}` : null,
    replayError ? `• 最近一次 agent 输出转发失败：${replayError}` : null,
  ].filter(Boolean).join('\n');
}
