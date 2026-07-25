import test from 'node:test';
import assert from 'node:assert/strict';

import { createAppContext } from '../src/app-context.js';
import { createSyntheticPlatformFoundation } from './support/synthetic-platform.mjs';

const noop = () => {};

test('core smoke composes from a synthetic Foundation without Discord SDK objects', () => {
  const state = {};
  const foundation = createSyntheticPlatformFoundation({ state });
  const identity = {
    clearSessionId: noop,
    formatSessionIdLabel: String,
    getSessionId: () => 'session-1',
    getSessionProvider: () => 'codex',
    setSessionId: noop,
  };
  const sessionSettings = {
    getSessionLanguage: () => 'en',
    getEffectiveSecurityProfile: () => 'team',
    getProviderDefaults: () => ({}),
    resolveModelSetting: () => ({}),
    resolveCodexProfileSetting: () => ({}),
    resolveReasoningEffortSetting: () => ({}),
    resolveFastModeSetting: () => ({}),
    resolveRuntimeModeSetting: () => ({}),
    resolveBusyPromptModeSetting: () => ({}),
    resolveReplyDeliverySetting: () => ({}),
    resolveTimeoutSetting: () => ({}),
    resolveTaskRetrySetting: () => ({}),
    resolveCompactStrategySetting: () => ({}),
    resolveCompactEnabledSetting: () => ({}),
    resolveCompactThresholdSetting: () => ({}),
    resolveNativeCompactTokenLimitSetting: () => ({}),
    resolveExtraInfoSetting: () => ({}),
  };
  const sessionStore = {
    getSession: () => ({}),
    saveDb: noop,
    ensureWorkspace: () => '/workspace',
    getParentSession: () => null,
    getWorkspaceBinding: () => ({ workspaceDir: '/workspace' }),
    listSessions: () => [],
    listFavoriteWorkspaces: () => [],
    addFavoriteWorkspace: noop,
    removeFavoriteWorkspace: noop,
  };
  const securityPolicy = {
    resolveSecurityContext: () => ({ profile: 'team' }),
    formatSecurityProfileDisplay: String,
    formatQueueLimit: String,
    formatConfigCommandStatus: String,
    describeConfigPolicy: String,
    isConfigKeyAllowed: () => false,
  };
  const promptRuntime = {
    cancelAllChannelWork: noop,
    cancelChannelWork: noop,
    closeRuntimeSession: noop,
    compactSession: noop,
    startCodexSideConversation: noop,
    closeCodexSideConversation: noop,
    enqueuePrompt: noop,
    dequeuePrompt: noop,
    retryLastPrompt: noop,
    getChannelState: () => ({}),
    getRuntimeSnapshot: () => ({ running: false }),
    formatCompletedStepsSummary: String,
    formatPermissionsLabel: String,
    formatProgressPlanSummary: String,
    formatRuntimeLabel: String,
    formatSessionStatusLabel: String,
    formatTimeoutLabel: String,
    localizeProgressLines: (lines) => lines,
    renderCompletedStepsLines: () => [],
    renderProcessContentLines: () => [],
    renderProgressPlanLines: () => [],
  };
  const commandSurface = {
    commandSpecs: [],
    handleCommand: noop,
    handleOnboardingButtonInteraction: noop,
    handleWorkspaceBusyInteraction: noop,
    handleWorkspaceBrowserInteraction: noop,
    handleSettingsPanelInteraction: noop,
    handleSettingsPanelModalSubmit: noop,
    handleGoalModalSubmit: noop,
    isOnboardingButtonId: () => false,
    isWorkspaceBusyComponentId: () => false,
    isWorkspaceBrowserComponentId: () => false,
    isSettingsPanelComponentId: () => false,
    isSettingsPanelModalId: () => false,
    isGoalModalId: () => false,
    normalizeSlashCommandName: String,
    routeSlashCommand: noop,
  };
  const singleInstanceLock = { acquire: noop, setupCleanupHandlers: noop };
  const calls = {};

  const context = createAppContext({
    platformFoundation: foundation,
    factories: {
      createSessionIdentityHelpersFn: () => identity,
      createSessionSettingsFn: () => sessionSettings,
      createSecurityPolicyFn: (options) => {
        calls.securityPolicyOptions = options;
        return securityPolicy;
      },
      createSessionStoreFn: () => sessionStore,
      createSessionCommandActionsFn: () => ({}),
      createWorkspaceRuntimeFn: () => ({ acquireWorkspace: noop, readLock: noop }),
      createPromptRuntimeFn: (options) => {
        calls.promptRuntimeOptions = options;
        return promptRuntime;
      },
      createCommandSurfaceFn: (options) => {
        calls.commandSurfaceOptions = options;
        return commandSurface;
      },
      createSingleInstanceLockFn: () => singleInstanceLock,
    },
  });

  assert.equal(context.platformFoundation, foundation);
  assert.equal(context.platformAdapter.id, 'synthetic');
  assert.equal(context.messageDelivery, foundation.messageDelivery);
  assert.equal(context.conversationSpawn, foundation.conversationSpawn);
  assert.equal(context.eventNormalizer.normalizeMessage({ id: 'event-1' }).id, 'event-1');
  assert.equal(calls.securityPolicyOptions.conversationSecurityResolver, foundation.conversationSecurity);
  assert.equal(calls.promptRuntimeOptions.messageDelivery, foundation.messageDelivery);
  assert.equal(calls.commandSurfaceOptions.commandRegistryRenderer, foundation.commandRegistryRenderer);
  assert.equal(calls.commandSurfaceOptions.interactionResponse, foundation.interactionResponse);
  assert.equal(state.adapterOptions.entryHandlerOptions.enqueuePrompt, promptRuntime.enqueuePrompt);
  assert.equal(state.adapterOptions.lifecycleOptions.cancelAllChannelWork, promptRuntime.cancelAllChannelWork);
});
