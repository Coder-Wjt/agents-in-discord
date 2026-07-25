import { createChannelQueue } from './channel-queue.js';
import { createChannelRuntimeStore } from './channel-runtime.js';
import { createPromptOrchestrator } from './prompt-orchestrator.js';
import { createPromptProgressReporterFactory } from './prompt-progress-reporter.js';
import { createRuntimePresentation } from './runtime-presentation.js';
import { createRunnerExecutor } from './runner-executor.js';
import { createSessionProgressBridgeFactory } from './session-progress-bridge.js';
import { assertMessageDelivery } from './platforms/message-delivery.js';

export function createPromptRuntime({
  messageDelivery = null,
  runtimePresentationOptions = {},
  channelRuntimeStoreOptions = {},
  sessionProgressBridgeOptions = {},
  runnerExecutorOptions = {},
  promptOrchestratorOptions = {},
  channelQueueOptions = {},
  factories = {},
} = {}) {
  const deliveryPort = assertMessageDelivery(messageDelivery);
  const {
    createChannelQueueFn = createChannelQueue,
    createChannelRuntimeStoreFn = createChannelRuntimeStore,
    createPromptOrchestratorFn = createPromptOrchestrator,
    createPromptProgressReporterFactoryFn = createPromptProgressReporterFactory,
    createRuntimePresentationFn = createRuntimePresentation,
    createRunnerExecutorFn = createRunnerExecutor,
    createSessionProgressBridgeFactoryFn = createSessionProgressBridgeFactory,
  } = factories;

  const presentation = createRuntimePresentationFn(runtimePresentationOptions);
  const channelRuntimeStore = createChannelRuntimeStoreFn({
    ...channelRuntimeStoreOptions,
    cloneProgressPlan: presentation.cloneProgressPlan,
  });
  const {
    getChannelState,
    setActiveRun,
    cancelChannelWork,
    cancelAllChannelWork,
    getRuntimeSnapshot,
    getAllRuntimeSnapshots,
    rememberFailedPrompt,
    clearLastFailedPrompt,
    getLastFailedPrompt,
  } = channelRuntimeStore;

  const { startSessionProgressBridge } = createSessionProgressBridgeFactoryFn(sessionProgressBridgeOptions);
  const runnerExecutor = createRunnerExecutorFn({
    ...runnerExecutorOptions,
    startSessionProgressBridge,
  });
  const runProviderTask = runnerExecutor.runProviderTask || runnerExecutor.runCodex;
  const steerProviderTask = runnerExecutor.steerProviderTask || (async () => ({
    ok: false,
    steered: false,
    reason: 'unsupported_runtime',
    error: 'steer unavailable',
  }));
  const startCodexSideConversation = runnerExecutor.startCodexSideConversation || (async () => ({
    ok: false,
    reason: 'unavailable',
    error: 'Codex side conversation unavailable',
  }));
  const closeCodexSideConversation = runnerExecutor.closeCodexSideConversation || (async () => ({
    ok: true,
    reason: 'unavailable',
  }));
  const createProgressReporter = createPromptProgressReporterFactoryFn({
    ...promptOrchestratorOptions,
    messageDelivery: deliveryPort,
    presentation,
  });
  const { handlePrompt, compactCurrentSession } = createPromptOrchestratorFn({
    ...promptOrchestratorOptions,
    messageDelivery: deliveryPort,
    createProgressReporter,
    formatTimeoutLabel: presentation.formatTimeoutLabel,
    setActiveRun,
    runTask: (options) => runProviderTask(options),
  });
  const compactSession = compactCurrentSession
    ? (message, key) => compactCurrentSession(message, key, getChannelState(key))
    : async () => ({ ok: false, error: 'manual compact unavailable' });
  const { enqueuePrompt, dequeuePrompt, retryLastPrompt } = createChannelQueueFn({
    ...channelQueueOptions,
    messageDelivery: deliveryPort,
    getChannelState,
    handlePrompt,
    steerPrompt: (options) => steerProviderTask(options),
    rememberFailedPrompt,
    clearLastFailedPrompt,
    getLastFailedPrompt,
  });

  return {
    ...presentation,
    messageDelivery: deliveryPort,
    enqueuePrompt,
    dequeuePrompt,
    retryLastPrompt,
    getChannelState,
    setActiveRun,
    cancelChannelWork,
    cancelAllChannelWork,
    getRuntimeSnapshot,
    getAllRuntimeSnapshots,
    handlePrompt,
    compactSession,
    runProviderTask,
    steerProviderTask,
    startCodexSideConversation,
    closeCodexSideConversation,
    runCodex: runnerExecutor.runCodex || runProviderTask,
    closeRuntimeSession: runnerExecutor.closeRuntimeSession || (() => false),
    closeAllRuntimeSessions: runnerExecutor.closeAllRuntimeSessions || (() => 0),
    getClaudeLongSessions: runnerExecutor.getClaudeLongSessions || (() => []),
    startSessionProgressBridge,
  };
}
