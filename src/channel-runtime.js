import {
  getInboundMessageActorId,
  getInboundMessageConversationId,
} from './platforms/inbound-event.js';

const STOP_CHILD_PROCESS_STATE = Symbol('agentsInDiscordStopChildProcessState');

export function createChannelRuntimeStore({
  cloneProgressPlan,
  truncate,
  promptPreviewChars = 120,
  stopChildProcessFn = stopChildProcess,
  childKillGraceMs = 3000,
  childKillWaitMs = 1000,
} = {}) {
  const channelStates = new Map();

  function getChannelState(key) {
    let state = channelStates.get(key);
    if (!state) {
      state = {
        running: false,
        queue: [],
        activeRun: null,
        cancelRequested: false,
        lastFailedPrompt: null,
      };
      channelStates.set(key, state);
    }
    return state;
  }

  function resolveChannelState(target) {
    return typeof target === 'string' ? getChannelState(target) : target;
  }

  function setActiveRun(channelState, message, prompt, child, phase = 'exec') {
    const prev = channelState.activeRun;
    channelState.activeRun = {
      child,
      startedAt: Date.now(),
      messageId: message.id,
      phase,
      promptPreview: truncate(String(prompt || '').replace(/\s+/g, ' '), promptPreviewChars),
      cancelRequested: Boolean(channelState.cancelRequested),
      progressEvents: prev?.progressEvents || 0,
      lastProgressText: prev?.lastProgressText || null,
      lastProgressAt: prev?.lastProgressAt || null,
      progressMessageId: prev?.progressMessageId || null,
      progressPlan: cloneProgressPlan(prev?.progressPlan),
      completedSteps: Array.isArray(prev?.completedSteps) ? [...prev.completedSteps] : [],
      recentActivities: Array.isArray(prev?.recentActivities) ? [...prev.recentActivities] : [],
      streamedProcessActivityKeys: Array.isArray(prev?.streamedProcessActivityKeys)
        ? [...prev.streamedProcessActivityKeys]
        : [],
    };
  }

  function cancelChannelWork(key, reason = 'manual') {
    const state = getChannelState(key);
    const queued = state.queue.length;
    state.queue.length = 0;
    state.cancelRequested = true;

    let cancelledRunning = false;
    let pid = null;
    let completion = Promise.resolve({ exited: true, alreadyStopped: true });
    if (state.activeRun) {
      state.activeRun.cancelRequested = true;
      cancelledRunning = true;
      pid = state.activeRun.child?.pid ?? null;
      if (state.activeRun.child) {
        completion = stopChildProcessFn(
          state.activeRun.child,
          childKillGraceMs,
          childKillWaitMs,
        );
      }
    }

    return {
      key,
      reason,
      cancelledRunning,
      pid,
      clearedQueued: queued,
      completion,
    };
  }

  function cancelAllChannelWork(reason = 'system') {
    const completions = [];
    for (const key of channelStates.keys()) {
      completions.push(cancelChannelWork(key, reason).completion);
    }
    return Promise.all(completions);
  }

  function getRuntimeSnapshot(key) {
    const state = getChannelState(key);
    const active = state.activeRun;
    const queuedPrompts = state.queue.map((job, index) => ({
      index: index + 1,
      id: job.id || null,
      authorId: job.authorId || getInboundMessageActorId(job.message) || null,
      messageId: job.messageId || job.message?.id || null,
      channelId: job.channelId || getInboundMessageConversationId(job.message) || null,
      enqueuedAt: job.enqueuedAt || null,
      promptPreview: truncate(String(job.content || '').replace(/\s+/g, ' '), promptPreviewChars),
    }));
    return {
      running: Boolean(state.running || active),
      queued: state.queue.length,
      queuedPrompts,
      activeSinceMs: active ? Math.max(0, Date.now() - active.startedAt) : null,
      phase: active?.phase || null,
      pid: active?.child?.pid ?? null,
      messageId: active?.messageId || null,
      progressEvents: active?.progressEvents || 0,
      progressText: active?.lastProgressText || null,
      progressAgoMs: active?.lastProgressAt ? Math.max(0, Date.now() - active.lastProgressAt) : null,
      progressMessageId: active?.progressMessageId || null,
      progressPlan: cloneProgressPlan(active?.progressPlan),
      completedSteps: Array.isArray(active?.completedSteps) ? [...active.completedSteps] : [],
      recentActivities: Array.isArray(active?.recentActivities) ? [...active.recentActivities] : [],
    };
  }

  function getAllRuntimeSnapshots() {
    return [...channelStates.entries()].map(([key]) => ({
      key,
      ...getRuntimeSnapshot(key),
    }));
  }

  function rememberFailedPrompt(target, failedPrompt) {
    const state = resolveChannelState(target);
    state.lastFailedPrompt = failedPrompt || null;
    return state.lastFailedPrompt;
  }

  function clearLastFailedPrompt(target) {
    const state = resolveChannelState(target);
    state.lastFailedPrompt = null;
  }

  function getLastFailedPrompt(key) {
    return getChannelState(key).lastFailedPrompt || null;
  }

  return {
    getChannelState,
    setActiveRun,
    cancelChannelWork,
    cancelAllChannelWork,
    getRuntimeSnapshot,
    getAllRuntimeSnapshots,
    rememberFailedPrompt,
    clearLastFailedPrompt,
    getLastFailedPrompt,
  };
}

export function stopChildProcess(child, killGraceMs = 3000, killWaitMs = 1000) {
  if (!child) return Promise.resolve({ exited: true, alreadyStopped: true });
  let exited = child.exitCode !== null && child.exitCode !== undefined;
  exited = exited || Boolean(child.signalCode);
  if (exited) return Promise.resolve({ exited: true, alreadyStopped: true });
  if (child[STOP_CHILD_PROCESS_STATE]?.promise) return child[STOP_CHILD_PROCESS_STATE].promise;

  let resolveCompletion;
  let graceTimer = null;
  let killWaitTimer = null;
  let forced = false;
  const promise = new Promise((resolve) => {
    resolveCompletion = resolve;
  });
  child[STOP_CHILD_PROCESS_STATE] = { stopping: true, promise };

  const finish = (result) => {
    if (exited) return;
    exited = true;
    if (graceTimer) clearTimeout(graceTimer);
    if (killWaitTimer) clearTimeout(killWaitTimer);
    if (child[STOP_CHILD_PROCESS_STATE]) {
      child[STOP_CHILD_PROCESS_STATE].stopping = false;
    }
    resolveCompletion({ forced, ...result });
  };
  const markExited = (code, signal) => {
    finish({ exited: true, code: code ?? null, signal: signal || child.signalCode || null });
  };
  child.once?.('exit', markExited);
  child.once?.('close', markExited);
  try {
    child.kill?.('SIGTERM');
  } catch (error) {
    finish({ exited: false, error });
    return promise;
  }
  if (exited) return promise;

  graceTimer = setTimeout(() => {
    if (exited) return;
    forced = true;
    try {
      child.kill?.('SIGKILL');
    } catch (error) {
      finish({ exited: false, error });
      return;
    }
    if (exited) return;
    killWaitTimer = setTimeout(() => {
      finish({ exited: false, timedOut: true });
    }, Math.max(100, Number(killWaitMs) || 1000));
  }, Math.max(0, Number(killGraceMs) || 0));
  return promise;
}
