import { randomUUID } from 'node:crypto';

import { assertConversationSpawn, assertSpawnedConversation } from './platforms/conversation-spawn.js';
import {
  DEFAULT_CONVERSATION_PRESENTATION,
  assertConversationPresentation,
} from './platforms/conversation-presentation.js';
import { getInboundActorId } from './platforms/inbound-event.js';

export function buildCodexSideBoundaryText(
  conversationPresentation = DEFAULT_CONVERSATION_PRESENTATION,
) {
  const presentation = assertConversationPresentation(conversationPresentation);
  const childConversationShort = presentation.getTerm('childConversationShort', 'en');
  return [
    'You are now in a Codex side conversation.',
    'Treat this as a temporary read-only side track by default.',
    'Do not change parent session goals, progress, queue, compact state, or reply delivery.',
    `Do not modify files or run destructive actions unless the user explicitly asks for edits inside this side ${childConversationShort}.`,
    'When answering, stay focused on the side question and do not claim that parent state changed.',
  ].join('\n');
}

export function buildCodexSideDeveloperInstructions(
  conversationPresentation = DEFAULT_CONVERSATION_PRESENTATION,
) {
  const presentation = assertConversationPresentation(conversationPresentation);
  const childConversationShort = presentation.getTerm('childConversationShort', 'en');
  const sideConversation = presentation.getTerm('sideConversation', 'en');
  return [
    'Side conversation rules:',
    `- This is an ephemeral side ${childConversationShort} forked from the parent Codex ${childConversationShort}.`,
    '- Prefer explanation, inspection, and lightweight non-destructive exploration.',
    `- File edits require an explicit user request in this ${sideConversation}.`,
    '- Never update or complete the parent goal from this side conversation.',
  ].join('\n');
}

export const CODEX_SIDE_BOUNDARY_TEXT = buildCodexSideBoundaryText();
export const CODEX_SIDE_DEVELOPER_INSTRUCTIONS = buildCodexSideDeveloperInstructions();

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function shortenId(value) {
  const text = normalizeText(value);
  if (!text) return 'new';
  return text.length <= 12 ? text : text.slice(0, 8);
}

function normalizeSideThreadName(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, 100) : '';
}

function getRequesterId(source) {
  return getInboundActorId(source) || null;
}

export function parseSideTextInput(input = '') {
  const [head, ...rest] = String(input || '').trim().split(/\s+/);
  const raw = String(head || '').trim().toLowerCase();
  if (!raw) return { action: 'start', threadName: '' };
  if (['start', 'open', 'new', '开启', '打开'].includes(raw)) {
    return { action: 'start', threadName: normalizeSideThreadName(rest.join(' ')) };
  }
  if (['status', 'state', 'show', '查看', '状态'].includes(raw)) {
    return { action: 'status', threadName: '' };
  }
  if (['close', 'stop', 'end', '关闭', '结束'].includes(raw)) {
    return { action: 'close', threadName: '' };
  }
  return { action: 'start', threadName: normalizeSideThreadName(input) };
}

export function buildCodexSideBoundaryItems(
  conversationPresentation = DEFAULT_CONVERSATION_PRESENTATION,
) {
  return [{
    type: 'message',
    role: 'user',
    content: [{
      type: 'input_text',
      text: buildCodexSideBoundaryText(conversationPresentation),
    }],
  }];
}

export function formatCodexSideThreadName({ parentSessionId, sideSessionId, threadName = '' } = {}) {
  const requested = normalizeSideThreadName(threadName);
  if (requested) return requested;
  return `codex side ${shortenId(sideSessionId)} from ${shortenId(parentSessionId)}`.slice(0, 100);
}

function formatSideOriginNotice({
  userMention,
  parentSessionId,
  parentReference,
  sideSessionId,
  language = 'zh',
  conversationPresentation = DEFAULT_CONVERSATION_PRESENTATION,
} = {}) {
  const presentation = assertConversationPresentation(conversationPresentation);
  const mention = userMention ? `${userMention} ` : '';
  const parentLabel = parentReference || presentation.getTerm('parentConversation', 'en');
  if (language === 'en') {
    return `${mention}Codex side conversation opened from ${parentLabel}, parent session \`${parentSessionId}\`. Side session: \`${sideSessionId}\`. Inherited context is for reference only; this ${presentation.getTerm('childConversationShort', 'en')} must not change parent state.`;
  }
  return `${mention}已从${presentation.getTerm('parentConversation', 'zh')} ${parentLabel}、父 Codex session \`${parentSessionId}\` 开启 side conversation。side session：\`${sideSessionId}\`。继承上下文只用于参考，这里不能改${presentation.getTerm('parentConversationLocalized', 'zh')}状态。`;
}

async function sendSideOriginNotice(childConversation, {
  conversationSpawn,
  source,
  parentSessionId,
  parentChannelId,
  sideSessionId,
  language,
  conversationPresentation,
} = {}) {
  const userId = getRequesterId(source);
  const content = formatSideOriginNotice({
    userMention: conversationSpawn.formatUserMention(userId),
    parentSessionId,
    parentReference: conversationSpawn.formatConversationReference(parentChannelId),
    sideSessionId,
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

function getOpenSideMeta(session) {
  const meta = session?.openSideConversation;
  if (!meta || !['open', 'cleanup_failed'].includes(meta.status)) return null;
  if (!normalizeText(meta.sideSessionId) || !normalizeText(meta.sideChannelId)) return null;
  return meta;
}

function getCurrentSideMeta(session) {
  const meta = session?.sideConversation;
  if (!meta || !['open', 'cleanup_failed'].includes(meta.status)) return null;
  if (!normalizeText(meta.sideSessionId) || !normalizeText(meta.sideChannelId)) return null;
  return meta;
}

export async function createCodexSideConversation({
  key,
  session,
  source,
  parentSessionId,
  threadName = '',
  provider = 'codex',
  getRuntimeSnapshot = () => ({ running: false }),
  getSession,
  commandActions = {},
  startCodexSideConversation,
  closeCodexSideConversation,
  enqueuePrompt,
  resolveSecurityContext,
  ensureWorkspace,
  getSessionLanguage = () => 'zh',
  conversationSpawn,
  conversationPresentation = DEFAULT_CONVERSATION_PRESENTATION,
  generateSideSeed = randomUUID,
} = {}) {
  if (provider !== 'codex') {
    return { ok: false, reason: 'provider_unsupported', provider };
  }
  const conversationPort = assertConversationSpawn(conversationSpawn);
  const presentation = assertConversationPresentation(conversationPresentation);
  const normalizedParentSessionId = normalizeText(parentSessionId);
  if (!normalizedParentSessionId) {
    return { ok: false, reason: 'missing_parent_session' };
  }
  if (['open', 'cleanup_failed'].includes(session?.sideConversation?.status)) {
    return { ok: false, reason: 'nested_side' };
  }
  const openSide = getOpenSideMeta(session);
  if (openSide?.status === 'cleanup_failed') {
    return { ok: false, reason: 'cleanup_failed', error: openSide.cleanupError || 'previous side cleanup failed' };
  }
  if (openSide) {
    const childConversation = { id: openSide.sideChannelId, raw: null };
    return {
      ok: true,
      reused: true,
      sideSessionId: openSide.sideSessionId,
      childConversation,
      childConversationReference: conversationPort.formatConversationReference(openSide.sideChannelId),
      parentSessionId: normalizedParentSessionId,
    };
  }
  if (!conversationPort.canSpawn(source)) {
    return { ok: false, reason: 'thread_unavailable' };
  }
  if (typeof startCodexSideConversation !== 'function') {
    return { ok: false, reason: 'side_unavailable' };
  }
  if (typeof getSession !== 'function') {
    throw new Error('getSession is required for Codex side conversation');
  }
  if (typeof commandActions.bindSideConversation !== 'function') {
    throw new Error('bindSideConversation is required for Codex side conversation');
  }

  const runtime = getRuntimeSnapshot(key) || {};
  const workspaceDir = typeof ensureWorkspace === 'function' ? ensureWorkspace(session, key) : session?.workspaceDir;
  const plannedSideSessionId = normalizeText(generateSideSeed()) || `side-${Date.now()}`;
  const requesterId = getRequesterId(source);
  const requestedName = normalizeSideThreadName(threadName);
  const childConversation = assertSpawnedConversation(await conversationPort.spawn(source, {
    name: formatCodexSideThreadName({
      parentSessionId: normalizedParentSessionId,
      sideSessionId: plannedSideSessionId,
      threadName: requestedName,
    }),
    reason: `codex side from ${normalizedParentSessionId}`,
  }));
  if (!childConversation.id) {
    throw new Error(`${presentation.getTerm('childConversation', 'en')} creation did not return a ${presentation.getTerm('childConversationId', 'en')}`);
  }
  const removeChildConversation = async (reason) => {
    try {
      return await conversationPort.remove(childConversation, { reason });
    } catch (error) {
      return {
        ok: false,
        removed: false,
        error: String(error?.message || error || 'unknown error'),
      };
    }
  };

  let sideResult = null;
  try {
    sideResult = await startCodexSideConversation({
      session,
      sessionKey: key,
      workspaceDir,
      sideDeveloperInstructions: buildCodexSideDeveloperInstructions(presentation),
      boundaryItems: buildCodexSideBoundaryItems(presentation),
    });
  } catch (err) {
    await removeChildConversation('Codex side conversation failed before session binding');
    throw err;
  }
  if (!sideResult?.ok || !normalizeText(sideResult.sideThreadId)) {
    await removeChildConversation('Codex side conversation did not return a side session id');
    return {
      ok: false,
      reason: sideResult?.reason || 'side_start_failed',
      error: sideResult?.error || 'Codex side conversation did not return a side session id',
    };
  }

  const sideSessionId = normalizeText(sideResult.sideThreadId);
  const childSession = getSession(childConversation.id, {
    parentChannelId: key,
  });
  if (!requestedName) {
    await conversationPort.rename(childConversation, {
      name: formatCodexSideThreadName({ parentSessionId: normalizedParentSessionId, sideSessionId }),
      reason: 'codex side session assigned',
    });
  }
  const notice = await sendSideOriginNotice(childConversation, {
    conversationSpawn: conversationPort,
    source,
    parentSessionId: normalizedParentSessionId,
    parentChannelId: key,
    sideSessionId,
    language: getSessionLanguage(session),
    conversationPresentation: presentation,
  });
  if (!notice.ok) {
    let cleanup = { ok: false, skipped: true, reason: 'cleanup_unavailable' };
    if (typeof closeCodexSideConversation === 'function') {
      cleanup = await closeCodexSideConversation({
        session: childSession,
        sessionKey: key,
        threadId: sideSessionId,
        reason: 'side origin notice failed',
      });
    }
    const conversationCleanup = await removeChildConversation('Codex side origin notice failed');
    return {
      ok: false,
      reason: 'origin_notice_failed',
      error: notice.error || 'failed to send side origin notice',
      sideSessionId,
      parentSessionId: normalizedParentSessionId,
      cleanup,
      conversationCleanup,
    };
  }
  let binding = null;
  try {
    binding = commandActions.bindSideConversation(session, childSession, {
      sideSessionId,
      parentSessionId: normalizedParentSessionId,
      parentChannelId: key,
      sideChannelId: childConversation.id,
      requesterId,
      workspaceDir,
    });
  } catch (err) {
    let cleanup = { ok: false, skipped: true, reason: 'cleanup_unavailable' };
    if (typeof closeCodexSideConversation === 'function') {
      cleanup = await closeCodexSideConversation({
        session: childSession,
        sessionKey: key,
        threadId: sideSessionId,
        reason: 'side session binding failed',
      });
    }
    const conversationCleanup = await removeChildConversation('Codex side binding failed');
    return {
      ok: false,
      reason: 'binding_failed',
      error: String(err?.message || err || 'binding failed'),
      sideSessionId,
      parentSessionId: normalizedParentSessionId,
      cleanup,
      conversationCleanup,
    };
  }
  const promptQueue = runtime.running ? null : null;
  void enqueuePrompt;
  void resolveSecurityContext;
  return {
    ok: true,
    parentSessionId: normalizedParentSessionId,
    sideSessionId,
    parentThreadId: sideResult.parentThreadId || normalizedParentSessionId,
    childConversation,
    childConversationReference: conversationPort.formatConversationReference(childConversation.id),
    childSession,
    binding,
    notice,
    promptQueue,
  };
}

export async function closeCodexSideConversationFlow({
  key,
  session,
  getSession,
  commandActions = {},
  closeCodexSideConversation,
  cancelChannelWork,
  source = null,
  conversationSpawn,
} = {}) {
  const parentMeta = getOpenSideMeta(session);
  const currentSideMeta = getCurrentSideMeta(session);
  const meta = parentMeta || currentSideMeta;
  if (!meta) return { ok: false, reason: 'no_open_side' };
  const parentSession = parentMeta ? session : getSession(meta.parentChannelId);
  const sideSession = currentSideMeta ? session : getSession(meta.sideChannelId, { parentChannelId: key });
  const cancelOutcome = typeof cancelChannelWork === 'function'
    ? cancelChannelWork(meta.sideChannelId, 'side_close')
    : null;
  let cleanup = { ok: true, skipped: true };
  if (typeof closeCodexSideConversation === 'function') {
    cleanup = await closeCodexSideConversation({
      session: sideSession,
      sessionKey: meta.parentChannelId,
      threadId: meta.sideSessionId,
      reason: 'side conversation closed',
    });
  }
  const cleanupError = cleanup?.ok ? null : (cleanup?.error || cleanup?.reason || 'cleanup failed');
  commandActions.markSideConversationClosed?.(parentSession, sideSession, {
    status: cleanup?.ok ? 'closed' : 'cleanup_failed',
    cleanupError,
  });
  const conversationArchive = cleanup?.ok
    ? await assertConversationSpawn(conversationSpawn).archive(source, {
      conversationId: meta.sideChannelId,
      reason: 'Codex side conversation closed',
    })
    : { ok: false, skipped: true };
  return {
    ok: Boolean(cleanup?.ok),
    sideSessionId: meta.sideSessionId,
    sideChannelId: meta.sideChannelId,
    cleanup,
    conversationArchive,
    cancelOutcome,
    error: cleanupError,
  };
}

export function formatCodexSideResult(
  result,
  language = 'zh',
  conversationPresentation = DEFAULT_CONVERSATION_PRESENTATION,
) {
  const presentation = assertConversationPresentation(conversationPresentation);
  if (!result?.ok) {
    if (result?.reason === 'missing_parent_session') {
      return language === 'en' ? '❌ No Codex session is bound here yet. Run one task first.' : `❌ ${presentation.getTerm('currentSourceConversation', 'zh')}还没有绑定 Codex session。先跑一轮。`;
    }
    if (result?.reason === 'provider_unsupported') {
      return language === 'en' ? '❌ Side conversation is only available for Codex.' : '❌ side conversation 只支持 Codex。';
    }
    if (result?.reason === 'nested_side') {
      return language === 'en' ? '❌ Nested side conversations are not supported.' : `❌ side ${presentation.getTerm('childConversationLocalized', 'zh')}里不能再开 side。`;
    }
    if (result?.reason === 'thread_unavailable') {
      return language === 'en'
        ? `❌ This ${presentation.getTerm('sourceConversation', 'en')} cannot create a side ${presentation.getTerm('childConversationShort', 'en')}.`
        : `❌ 当前 ${presentation.getTerm('sourceConversation', 'zh')}不能创建 side ${presentation.getTerm('childConversationShort', 'zh')}。`;
    }
    if (result?.reason === 'side_unavailable' || result?.reason === 'unsupported_runtime') {
      return language === 'en' ? '❌ Codex side conversation requires Codex long runtime.' : '❌ Codex side conversation 需要 Codex long runtime。';
    }
    if (result?.reason === 'origin_notice_failed') {
      return language === 'en' ? `❌ Codex side failed before opening: ${result?.error || 'origin notice failed'}` : `❌ Codex side 开启前失败：${result?.error || 'origin notice failed'}`;
    }
    if (result?.reason === 'binding_failed') {
      return language === 'en' ? `❌ Codex side failed before binding: ${result?.error || 'binding failed'}` : `❌ Codex side 绑定前失败：${result?.error || 'binding failed'}`;
    }
    if (result?.reason === 'cleanup_failed') {
      return language === 'en' ? `❌ Previous Codex side cleanup failed. Close it again before starting a new side: ${result?.error || 'unknown error'}` : `❌ 上次 Codex side 清理失败。先再关闭一次，再开新的 side：${result?.error || '未知错误'}`;
    }
    return language === 'en' ? `❌ Codex side failed: ${result?.error || result?.reason || 'unknown error'}` : `❌ Codex side 失败：${result?.error || result?.reason || '未知错误'}`;
  }
  const channelLabel = result.childConversationReference
    || result.childConversation?.id
    || `(new ${presentation.getTerm('childConversationShort', 'en')})`;
  const prefix = result.reused
    ? (language === 'en' ? 'ℹ️ Existing Codex side conversation' : 'ℹ️ 已有 Codex side conversation')
    : (language === 'en' ? '✅ Codex side conversation opened' : '✅ 已开启 Codex side conversation');
  return [
    `${prefix}：${channelLabel}`,
    `• side session: \`${result.sideSessionId}\``,
    `• parent session: \`${result.parentSessionId}\``,
  ].join('\n');
}

export function formatCodexSideStatus(
  session,
  language = 'zh',
  runtime = null,
  conversationSpawn = null,
  conversationPresentation = DEFAULT_CONVERSATION_PRESENTATION,
) {
  const presentation = assertConversationPresentation(conversationPresentation);
  const meta = getOpenSideMeta(session) || getCurrentSideMeta(session);
  if (!meta) {
    return language === 'en' ? 'No open Codex side conversation.' : '当前没有打开的 Codex side conversation。';
  }
  const running = runtime
    ? (runtime.running || runtime.queued ? (language === 'en' ? 'yes' : '是') : (language === 'en' ? 'no' : '否'))
    : (language === 'en' ? 'unknown' : '未知');
  const statusLine = meta.status === 'cleanup_failed'
    ? (language === 'en'
      ? `Cleanup previously failed: ${meta.cleanupError || 'unknown error'}`
      : `上次清理失败：${meta.cleanupError || '未知错误'}`)
    : (language === 'en'
      ? 'Codex side conversation is open and temporary.'
      : `Codex side conversation 已打开，是${presentation.getTerm('temporaryChildConversation', 'zh')}。`);
  const formatReference = typeof conversationSpawn?.formatConversationReference === 'function'
    ? (conversationId) => conversationSpawn.formatConversationReference(conversationId)
    : (conversationId) => String(conversationId || '');
  return [
    statusLine,
    `• ${presentation.getTerm('parentConversationStatusLabel', language)}: ${formatReference(meta.parentChannelId)}`,
    `• ${presentation.getTerm('sideConversationStatusLabel', language)}: ${formatReference(meta.sideChannelId)}`,
    `• side session: \`${meta.sideSessionId}\``,
    `• parent session: \`${meta.parentSessionId}\``,
    `• opened: ${meta.openedAt || '(unknown)'}`,
    `• running: ${running}`,
  ].join('\n');
}

export function formatCodexSideCloseResult(result, language = 'zh') {
  if (!result?.ok) {
    if (result?.reason === 'no_open_side') {
      return language === 'en' ? 'No open Codex side conversation to close.' : '当前没有可关闭的 Codex side conversation。';
    }
    return language === 'en' ? `❌ Codex side close failed: ${result?.error || 'unknown error'}` : `❌ Codex side 关闭失败：${result?.error || '未知错误'}`;
  }
  const conversationArchive = result.conversationArchive;
  const archiveTarget = conversationArchive?.targetLabel || 'conversation';
  const archiveWarning = conversationArchive && conversationArchive.ok === false && !conversationArchive.skipped
    ? (language === 'en' ? `\n⚠️ ${archiveTarget} cleanup warning: ${conversationArchive.error || 'archive failed'}` : `\n⚠️ ${archiveTarget} 清理警告：${conversationArchive.error || 'archive failed'}`)
    : '';
  return language === 'en'
    ? `✅ Closed Codex side conversation \`${result.sideSessionId}\`.${archiveWarning}`
    : `✅ 已关闭 Codex side conversation：\`${result.sideSessionId}\`。${archiveWarning}`;
}

export function createSyntheticSideMessage(source, childConversation, conversationSpawn) {
  return assertConversationSpawn(conversationSpawn).createPromptMessage(source, childConversation);
}
