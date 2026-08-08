import { randomUUID } from 'node:crypto';

import { canCreateDiscordForkThread, createSyntheticForkMessage } from './codex-fork-flow.js';

export const CODEX_SIDE_BOUNDARY_TEXT = [
  'You are now in a Codex side conversation.',
  'Treat this as a temporary read-only side track.',
  'Do not change parent session goals, progress, queue, compact state, or reply delivery.',
  'Do not modify files or run destructive actions, even if the user asks from this side thread.',
  'When answering, stay focused on the side question and do not claim that parent state changed.',
].join('\n');

export const CODEX_SIDE_DEVELOPER_INSTRUCTIONS = [
  'Side conversation rules:',
  '- This is an ephemeral side thread forked from the parent Codex thread.',
  '- Only explain, inspect, and perform non-destructive exploration.',
  '- Never edit files or change external state from this side conversation.',
  '- Never update or complete the parent goal from this side conversation.',
].join('\n');

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function resolveThreadCreateChannel(channel) {
  if (channel?.threads && typeof channel.threads.create === 'function') return channel;
  if (typeof channel?.isThread === 'function' && channel.isThread() && channel.parent?.threads && typeof channel.parent.threads.create === 'function') {
    return channel.parent;
  }
  if (channel?.parent?.threads && typeof channel.parent.threads.create === 'function') return channel.parent;
  return null;
}

function normalizeSideThreadName(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, 100) : '';
}

function getRequesterId(source) {
  return String(source?.user?.id || source?.author?.id || '').trim() || null;
}

export function parseSideTextInput(input = '') {
  const [head, ...rest] = String(input || '').trim().split(/\s+/);
  const raw = String(head || '').trim().toLowerCase();
  if (!raw) return { action: 'start', question: '' };
  if (['start', 'open', 'new', '开启', '打开'].includes(raw)) {
    return { action: 'start', question: rest.join(' ').trim() };
  }
  if (['status', 'state', 'show', '查看', '状态'].includes(raw)) {
    return { action: 'status', question: '' };
  }
  if (['close', 'stop', 'end', '关闭', '结束'].includes(raw)) {
    return { action: 'close', question: '' };
  }
  return { action: 'start', question: String(input || '').trim() };
}

export function buildCodexSideBoundaryItems() {
  return [{
    type: 'message',
    role: 'user',
    content: [{
      type: 'input_text',
      text: CODEX_SIDE_BOUNDARY_TEXT,
    }],
  }];
}

export function formatCodexSideThreadName({ parentChannelName = '' } = {}) {
  const parentName = normalizeSideThreadName(parentChannelName) || '主任务';
  return `旁问 · ${parentName}`.slice(0, 100);
}

async function createDiscordSideThread(source) {
  const targetChannel = resolveThreadCreateChannel(source?.channel);
  if (!targetChannel) {
    throw new Error('当前频道不能创建旁问线程。');
  }
  const thread = await targetChannel.threads.create({
    name: formatCodexSideThreadName({ parentChannelName: source?.channel?.name }),
    autoArchiveDuration: 1440,
    reason: `Codex side conversation from Discord channel ${source?.channel?.id || 'unknown'}`,
  });
  try {
    await thread.join?.();
  } catch {
  }
  return thread;
}

function formatSideOriginNotice({ userId, parentChannelId, language = 'zh' } = {}) {
  const mention = userId ? `<@${userId}> ` : '';
  const parentLabel = parentChannelId ? `<#${parentChannelId}>` : (language === 'en' ? 'the main task' : '主任务');
  if (language === 'en') {
    return `${mention}Side question for ${parentLabel}. This thread can inspect and discuss, but cannot change files or external state.`;
  }
  return `${mention}这是 ${parentLabel} 的旁问。这里只查阅和讨论，不会改文件或外部状态。`;
}

async function sendSideOriginNotice(childThread, {
  source,
  parentChannelId,
  language,
  components = [],
} = {}) {
  if (typeof childThread?.send !== 'function') {
    return { ok: false, skipped: true, error: 'child thread cannot send messages' };
  }
  const userId = getRequesterId(source);
  const payload = {
    content: formatSideOriginNotice({
      userId,
      parentChannelId,
      language,
    }),
    components,
  };
  if (userId) payload.allowedMentions = { users: [userId] };
  try {
    const message = await childThread.send(payload);
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

export function getCodexSideAvailability({
  session,
  provider = session?.provider || 'codex',
  runtimeMode = 'long',
  codexProfile = null,
} = {}) {
  if (String(provider || '').trim().toLowerCase() !== 'codex') {
    return { ok: false, reason: 'provider_unsupported' };
  }
  if (['open', 'cleanup_failed'].includes(session?.sideConversation?.status)) {
    return { ok: false, reason: 'nested_side' };
  }
  if (String(runtimeMode || '').trim().toLowerCase() !== 'long') {
    return { ok: false, reason: 'unsupported_runtime' };
  }
  if (Array.isArray(session?.configOverrides) && session.configOverrides.length > 0) {
    return { ok: false, reason: 'incompatible_config' };
  }
  if (codexProfile?.isExplicit) {
    return { ok: false, reason: 'incompatible_profile' };
  }
  return { ok: true, reason: null };
}

async function enqueueSideQuestion({
  source,
  childThread,
  childSession,
  question,
  enqueuePrompt,
  resolveSecurityContext,
} = {}) {
  const normalizedQuestion = String(question || '').trim();
  if (!normalizedQuestion) return null;
  if (typeof enqueuePrompt !== 'function') {
    return { ok: false, enqueued: false, error: '旁问暂时无法接收问题。' };
  }
  try {
    const syntheticMessage = createSyntheticForkMessage(source, childThread);
    const securityContext = typeof resolveSecurityContext === 'function'
      ? resolveSecurityContext(childThread, childSession)
      : null;
    return await enqueuePrompt(syntheticMessage, childThread.id, normalizedQuestion, securityContext);
  } catch (err) {
    return {
      ok: false,
      enqueued: false,
      error: String(err?.message || err || '旁问提交失败'),
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

async function deleteDiscordSideThread(childThread, reason) {
  try {
    await childThread?.delete?.(reason);
    return { ok: true, deleted: true };
  } catch (err) {
    return {
      ok: false,
      deleted: false,
      error: String(err?.message || err || 'unknown error'),
    };
  }
}

async function resolveDiscordSideThread(source, sideChannelId) {
  const normalizedSideChannelId = normalizeText(sideChannelId);
  if (!normalizedSideChannelId) return null;
  if (source?.channel?.id === normalizedSideChannelId) return source.channel;
  const cached = source?.client?.channels?.cache?.get?.(normalizedSideChannelId)
    || source?.channel?.client?.channels?.cache?.get?.(normalizedSideChannelId);
  if (cached) return cached;
  const fetcher = source?.client?.channels?.fetch || source?.channel?.client?.channels?.fetch;
  if (typeof fetcher !== 'function') return null;
  return fetcher.call(source?.client?.channels || source?.channel?.client?.channels, normalizedSideChannelId);
}

async function archiveDiscordSideThread(source, meta) {
  const thread = await resolveDiscordSideThread(source, meta?.sideChannelId);
  if (!thread) {
    return { ok: false, archived: false, locked: false, error: 'side Discord thread not found' };
  }
  const result = { ok: true, archived: false, locked: false, error: '' };
  try {
    if (typeof thread.setLocked === 'function') {
      await thread.setLocked(true, 'Codex side conversation closed');
      result.locked = true;
    }
  } catch (err) {
    result.ok = false;
    result.error = String(err?.message || err || 'lock failed');
  }
  try {
    if (typeof thread.setArchived === 'function') {
      await thread.setArchived(true, 'Codex side conversation closed');
      result.archived = true;
    }
  } catch (err) {
    result.ok = false;
    const message = String(err?.message || err || 'archive failed');
    result.error = result.error ? `${result.error}; ${message}` : message;
  }
  if (typeof thread.setArchived !== 'function') {
    result.ok = false;
    result.error = result.error || 'side Discord thread cannot be archived';
  }
  return result;
}

export async function createCodexSideConversation({
  key,
  session,
  source,
  parentSessionId,
  question = '',
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
  buildHeaderComponents = () => [],
  createThread = createDiscordSideThread,
  generateSideSeed = randomUUID,
} = {}) {
  if (provider !== 'codex') {
    return { ok: false, reason: 'provider_unsupported', provider };
  }
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
    const childThread = await resolveDiscordSideThread(source, openSide.sideChannelId);
    if (!childThread) return { ok: false, reason: 'side_thread_missing' };
    const childSession = getSession(openSide.sideChannelId, {
      channel: childThread,
      parentChannelId: key,
    });
    const promptQueue = await enqueueSideQuestion({
      source,
      childThread,
      childSession,
      question,
      enqueuePrompt,
      resolveSecurityContext,
    });
    return {
      ok: true,
      reused: true,
      sideSessionId: openSide.sideSessionId,
      childThread,
      childSession,
      parentSessionId: normalizedParentSessionId,
      promptQueue,
    };
  }
  if (!getRuntimeSnapshot(key)?.running) {
    return { ok: false, reason: 'parent_not_running' };
  }
  if (!canCreateDiscordForkThread(source)) {
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

  const workspaceDir = typeof ensureWorkspace === 'function' ? ensureWorkspace(session, key) : session?.workspaceDir;
  const plannedSideSessionId = normalizeText(generateSideSeed()) || `side-${Date.now()}`;
  const requesterId = getRequesterId(source);
  const childThread = await createThread(source, {
    parentSessionId: normalizedParentSessionId,
    sideSessionId: plannedSideSessionId,
    parentChannelName: source?.channel?.name || '',
  });
  if (!childThread?.id) {
    throw new Error('Discord thread creation did not return a thread id');
  }

  let sideResult = null;
  try {
    sideResult = await startCodexSideConversation({
      session,
      sessionKey: key,
      workspaceDir,
      sideDeveloperInstructions: CODEX_SIDE_DEVELOPER_INSTRUCTIONS,
      boundaryItems: buildCodexSideBoundaryItems(),
    });
  } catch (err) {
    await deleteDiscordSideThread(childThread, 'Codex side conversation failed before session binding');
    throw err;
  }
  if (!sideResult?.ok || !normalizeText(sideResult.sideThreadId)) {
    await deleteDiscordSideThread(childThread, 'Codex side conversation did not return a side session id');
    return {
      ok: false,
      reason: sideResult?.reason || 'side_start_failed',
      error: sideResult?.error || 'Codex side conversation did not return a side session id',
    };
  }

  const sideSessionId = normalizeText(sideResult.sideThreadId);
  const childSession = getSession(childThread.id, {
    channel: childThread,
    parentChannelId: key,
  });
  const notice = await sendSideOriginNotice(childThread, {
    source,
    parentChannelId: key,
    language: getSessionLanguage(session),
    components: buildHeaderComponents({
      parentChannelId: key,
      sideChannelId: childThread.id,
      language: getSessionLanguage(session),
    }),
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
    const discordCleanup = await deleteDiscordSideThread(childThread, 'Codex side origin notice failed');
    return {
      ok: false,
      reason: 'origin_notice_failed',
      error: notice.error || 'failed to send side origin notice',
      sideSessionId,
      parentSessionId: normalizedParentSessionId,
      cleanup,
      discordCleanup,
    };
  }
  let binding = null;
  try {
    binding = commandActions.bindSideConversation(session, childSession, {
      sideSessionId,
      parentSessionId: normalizedParentSessionId,
      parentChannelId: key,
      sideChannelId: childThread.id,
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
    const discordCleanup = await deleteDiscordSideThread(childThread, 'Codex side binding failed');
    return {
      ok: false,
      reason: 'binding_failed',
      error: String(err?.message || err || 'binding failed'),
      sideSessionId,
      parentSessionId: normalizedParentSessionId,
      cleanup,
      discordCleanup,
    };
  }
  const promptQueue = await enqueueSideQuestion({
    source,
    childThread,
    childSession,
    question,
    enqueuePrompt,
    resolveSecurityContext,
  });
  return {
    ok: true,
    parentSessionId: normalizedParentSessionId,
    sideSessionId,
    parentThreadId: sideResult.parentThreadId || normalizedParentSessionId,
    childThread,
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
} = {}) {
  const parentMeta = getOpenSideMeta(session);
  const currentSideMeta = getCurrentSideMeta(session);
  const meta = parentMeta || currentSideMeta;
  if (!meta) return { ok: false, reason: 'no_open_side' };
  const parentSession = parentMeta ? session : getSession(meta.parentChannelId, { channel: null });
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
  const discordArchive = cleanup?.ok ? await archiveDiscordSideThread(source, meta) : { ok: false, skipped: true };
  return {
    ok: Boolean(cleanup?.ok),
    sideSessionId: meta.sideSessionId,
    sideChannelId: meta.sideChannelId,
    cleanup,
    discordArchive,
    cancelOutcome,
    error: cleanupError,
  };
}

export function formatCodexSideResult(result, language = 'zh') {
  if (!result?.ok) {
    if (result?.reason === 'missing_parent_session') {
      return language === 'en' ? 'This task is not ready for side questions yet.' : '主任务还没准备好接旁问。';
    }
    if (result?.reason === 'provider_unsupported') {
      return language === 'en' ? 'Side questions are only available for Codex.' : '旁问只支持 Codex。';
    }
    if (result?.reason === 'nested_side') {
      return language === 'en' ? 'A side question cannot open another side question.' : '旁问里不能再开旁问。';
    }
    if (result?.reason === 'thread_unavailable') {
      return language === 'en' ? 'This Discord channel cannot create a side thread.' : '当前频道不能创建旁问线程。';
    }
    if (result?.reason === 'side_unavailable' || result?.reason === 'unsupported_runtime') {
      return language === 'en' ? 'This task was started in a mode that cannot answer side questions concurrently.' : '这个任务的运行方式不支持同时旁问。';
    }
    if (result?.reason === 'parent_not_running') {
      return language === 'en' ? 'The main task has already finished.' : '主任务已经结束。';
    }
    if (result?.reason === 'incompatible_profile' || result?.reason === 'incompatible_config') {
      return language === 'en' ? 'This task uses Codex settings that are not side-compatible.' : '这个任务用了暂不兼容旁问的 Codex 设置。';
    }
    if (result?.reason === 'missing_question') {
      return language === 'en' ? 'Add a question after the command.' : '请在命令后面写上问题。';
    }
    if (result?.reason === 'side_thread_missing') {
      return language === 'en' ? 'The existing side thread is no longer available.' : '原来的旁问线程已经不可用，请先关闭后重开。';
    }
    if (result?.reason === 'origin_notice_failed') {
      return language === 'en' ? `The side thread could not open because its first message failed: ${result?.error || 'unknown error'}` : `旁问没有打开，新线程的首条消息发送失败：${result?.error || '未知错误'}`;
    }
    if (result?.reason === 'binding_failed') {
      return language === 'en' ? `The side thread could not open because it was not connected to the main task: ${result?.error || 'unknown error'}` : `旁问没有打开，新线程没有连上主任务：${result?.error || '未知错误'}`;
    }
    if (result?.reason === 'cleanup_failed') {
      return language === 'en' ? `The previous side thread did not close cleanly. Close it again before retrying: ${result?.error || 'unknown error'}` : `上次旁问没有关干净，请先再关闭一次：${result?.error || '未知错误'}`;
    }
    return language === 'en' ? `The side thread could not open: ${result?.error || result?.reason || 'unknown error'}` : `旁问没有打开：${result?.error || result?.reason || '未知错误'}`;
  }
  const channelLabel = result.childThread?.id ? `<#${result.childThread.id}>` : '(new thread)';
  const prefix = result.reused
    ? (language === 'en' ? 'Sent to the existing side thread' : '已发到现有旁问')
    : (language === 'en' ? 'Side thread opened' : '旁问已打开');
  if (result.promptQueue && !result.promptQueue.ok) {
    return language === 'en'
      ? `${prefix}: ${channelLabel}. The question could not be sent: ${result.promptQueue.error || result.promptQueue.reason || 'unknown error'}`
      : `${prefix}：${channelLabel}。问题没有发出去：${result.promptQueue.error || result.promptQueue.reason || '未知错误'}`;
  }
  return `${prefix}：${channelLabel}`;
}

export function formatCodexSideStatus(session, language = 'zh', runtime = null) {
  const meta = getOpenSideMeta(session) || getCurrentSideMeta(session);
  if (!meta) {
    return language === 'en' ? 'No side thread is open.' : '当前没有打开的旁问。';
  }
  const activityLine = runtime
    ? (runtime.running || runtime.queued
      ? (language === 'en' ? 'Answering now.' : '正在回答。')
      : (language === 'en' ? 'Idle for now.' : '当前空闲。'))
    : (language === 'en' ? 'Current activity is unknown.' : '当前状态未知。');
  const statusLine = meta.status === 'cleanup_failed'
    ? (language === 'en'
      ? `Cleanup previously failed: ${meta.cleanupError || 'unknown error'}`
      : `上次清理失败：${meta.cleanupError || '未知错误'}`)
    : (language === 'en' ? 'The side thread is open.' : '旁问正在进行。');
  return [
    statusLine,
    `${language === 'en' ? 'Main task' : '主任务'} <#${meta.parentChannelId}>`,
    `${language === 'en' ? 'Side thread' : '旁问'} <#${meta.sideChannelId}>`,
    activityLine,
  ].join('\n');
}

export function formatCodexSideCloseResult(result, language = 'zh') {
  if (!result?.ok) {
    if (result?.reason === 'no_open_side') {
      return language === 'en' ? 'No side thread is open.' : '当前没有可关闭的旁问。';
    }
    return language === 'en' ? `The side thread could not close: ${result?.error || 'unknown error'}` : `旁问没有关闭：${result?.error || '未知错误'}`;
  }
  const archiveWarning = result.discordArchive && result.discordArchive.ok === false && !result.discordArchive.skipped
    ? (language === 'en' ? `\nThe conversation closed, but the thread could not be archived: ${result.discordArchive.error || 'unknown error'}` : `\n对话已关闭，但线程没有成功归档：${result.discordArchive.error || '未知错误'}`)
    : '';
  return language === 'en'
    ? `Side thread closed.${archiveWarning}`
    : `旁问已关闭。${archiveWarning}`;
}

export async function notifyCodexSideConversation({ source, session, kind, language = 'zh' } = {}) {
  const meta = getOpenSideMeta(session);
  if (!meta || meta.status !== 'open') return { ok: false, skipped: true, reason: 'no_open_side' };
  const thread = await resolveDiscordSideThread(source, meta.sideChannelId);
  if (!thread || typeof thread.send !== 'function') {
    return { ok: false, skipped: false, reason: 'side_thread_missing' };
  }
  const mention = meta.requesterId ? `<@${meta.requesterId}> ` : '';
  const parent = `<#${meta.parentChannelId}>`;
  const content = kind === 'completed'
    ? (language === 'en' ? `${mention}The main task has finished ${parent}` : `${mention}主任务已完成 ${parent}`)
    : (language === 'en' ? `${mention}The main task needs your attention ${parent}` : `${mention}主任务需要你回去确认 ${parent}`);
  try {
    await thread.send({
      content,
      allowedMentions: meta.requesterId ? { users: [meta.requesterId] } : undefined,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, skipped: false, error: String(err?.message || err || 'notification failed') };
  }
}

export function createSyntheticSideMessage(source, childThread) {
  return createSyntheticForkMessage(source, childThread);
}
