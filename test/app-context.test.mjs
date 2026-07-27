import test from 'node:test';
import assert from 'node:assert/strict';

import { bootApp, createAppContext } from '../src/app-context.js';
import { createPlatformCapabilities } from '../src/platforms/capabilities.js';

test('createAppContext wires factories and cross-links composition dependencies', () => {
  const platformCapabilities = createPlatformCapabilities({
    threads: true,
    slashCommands: true,
    buttons: true,
    selectMenus: true,
    modals: true,
    messageEdits: false,
    reactions: true,
    attachments: true,
  });
  const calls = {};
  const identity = {
    clearSessionId: () => {},
    formatSessionIdLabel: (value) => `\`${value}\``,
    getSessionId: () => 'sess-1',
    getSessionProvider: () => 'codex',
    setSessionId: () => {},
  };
  const sessionSettings = {
    getSessionLanguage: () => 'zh',
    getEffectiveSecurityProfile: () => 'team',
    getProviderDefaults: () => ({ model: 'gpt-5.4', effort: 'high', source: 'config.toml' }),
    resolveModelSetting: () => ({ value: 'gpt-5.4', source: 'config.toml' }),
    resolveReasoningEffortSetting: () => ({ value: 'high', source: 'config.toml' }),
    resolveFastModeSetting: () => ({ enabled: false, supported: true, source: 'config.toml' }),
    resolveReplyDeliverySetting: () => ({ mode: 'stream_mention', source: 'env default' }),
    resolveTimeoutSetting: () => ({ timeoutMs: 60000 }),
    resolveTaskRetrySetting: () => ({ maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 8000 }),
    resolveCompactStrategySetting: () => ({ strategy: 'hard' }),
    resolveCompactEnabledSetting: () => ({ enabled: true }),
    resolveCompactThresholdSetting: () => ({ tokens: 200000 }),
    resolveNativeCompactTokenLimitSetting: () => ({ tokens: 200000 }),
  };
  const securityPolicy = {
    resolveSecurityContext: () => ({ maxQueuePerChannel: 20 }),
  };
  const sessionStore = {
    getSession: () => ({ id: 'session' }),
    saveDb: () => {},
    ensureWorkspace: () => '/repo/demo',
    getWorkspaceBinding: () => ({ workspaceDir: '/repo/demo' }),
    listSessions: () => [],
    listFavoriteWorkspaces: () => [],
    addFavoriteWorkspace: () => {},
    removeFavoriteWorkspace: () => {},
  };
  const commandActions = { setProvider: () => {} };
  const workspaceRuntime = {
    acquireWorkspace: async () => ({ release() {} }),
    readLock: () => null,
  };
  const promptRuntime = {
    cancelAllChannelWork: () => 'cancel-all',
    cancelChannelWork: () => 'cancel-one',
    enqueuePrompt: () => 'queued',
    dequeuePrompt: () => 'dequeued',
    retryLastPrompt: () => 'retried',
    getRuntimeSnapshot: () => ({ running: false }),
    formatCompletedStepsSummary: () => 'steps',
    formatPermissionsLabel: () => 'permissions',
    formatProgressPlanSummary: () => 'plan',
    formatRuntimeLabel: () => 'runtime',
    formatSessionStatusLabel: () => 'session',
    formatTimeoutLabel: () => '60000ms',
    localizeProgressLines: (lines) => lines,
    renderCompletedStepsLines: () => [],
    renderProcessContentLines: () => [],
    renderProgressPlanLines: () => [],
  };
  const commandSurface = {
    formatWorkspaceBusyReport: () => 'busy',
    buildWorkspaceBusyPayload: () => ({ content: 'busy', components: [] }),
    handleCommand: () => 'handled',
    handleOnboardingButtonInteraction: () => 'onboarded',
    handleWorkspaceBusyInteraction: () => 'workspace-busy',
    handleSettingsPanelInteraction: () => 'settings',
    handleSettingsPanelModalSubmit: () => 'settings-modal',
    handleWorkspaceBrowserInteraction: () => 'browsed',
    isOnboardingButtonId: () => false,
    isSettingsPanelComponentId: () => false,
    isSettingsPanelModalId: () => false,
    isWorkspaceBusyComponentId: () => false,
    isWorkspaceBrowserComponentId: () => false,
    normalizeSlashCommandName: (name) => name,
    routeSlashCommand: () => 'routed',
    commandSpecs: [{ name: 'status' }],
    slashRef: (base) => `/bot-${base}`,
  };
  const accessPolicy = { allow: true };
  const entryHandlers = { bindClientHandlers: () => 'bound' };
  const lifecycle = {
    getClient: () => ({ user: { id: 'bot-user-1' } }),
    getHealthSnapshot: () => ({ state: 'connected' }),
  };
  const messageDelivery = {
    reply() {},
    send() {},
    edit() {},
    startTyping() {},
    splitText() {},
    formatUserMention() {},
    setMessageStatus() {},
    getMetricsSnapshot: () => ({ succeeded: 7, failed: 1, inFlight: 0 }),
  };
  const notificationDelivery = {
    sendNotification() {},
  };
  const commandViewRenderer = {
    renderActionRows() {},
    renderMessage() {},
    renderModal() {},
  };
  const commandRegistryRenderer = {
    renderCommands() {},
    formatCommandName: (name) => `bot_${name}`,
    normalizeCommandName: (name) => String(name).replace(/^bot_/, ''),
    formatCommandReference: (name) => `/bot_${name}`,
  };
  const interactionResponse = {
    respond() {},
    update() {},
    showModal() {},
    defer() {},
  };
  const conversationSpawn = {
    canSpawn() {},
    spawn() {},
    rename() {},
    remove() {},
    archive() {},
    send() {},
    listRecentMessages() {},
    splitText() {},
    createPromptMessage() {},
    formatUserMention() {},
    formatConversationReference() {},
  };
  const conversationPresentation = {
    getTerm: (key, language) => `${key}:${language}`,
  };
  const conversationSecurity = {
    resolve: () => ({
      conversationId: null,
      parentConversationId: null,
      tenantId: null,
      available: false,
      isDirect: false,
      visibility: 'unknown',
      reason: 'conversation unavailable',
    }),
  };
  const textPresentation = {
    sanitizeDisplayText: (value) => `display:${value}`,
  };
  const singleInstanceLock = {
    acquire: () => {},
    setupCleanupHandlers: () => {},
  };
  const eventNormalizer = {
    normalizeMessage() {},
    normalizeInteraction() {},
  };
  const platformFoundation = {
    id: 'example',
    capabilities: platformCapabilities,
    commandRegistryRenderer,
    commandViewRenderer,
    interactionResponse,
    messageDelivery,
    notificationDelivery,
    conversationSpawn,
    conversationPresentation,
    conversationSecurity,
    textPresentation,
    createAdapter(options) {
      calls.platformAdapter = options;
      calls.accessPolicy = options.accessPolicyOptions;
      calls.entryHandlers = {
        ...options.entryHandlerOptions,
        accessPolicy,
        platformCapabilities,
        commandRegistryRenderer,
        interactionResponse,
        messageDelivery,
        conversationSpawn,
        normalizeInteractionEvent: eventNormalizer.normalizeInteraction,
        normalizeMessageEvent: eventNormalizer.normalizeMessage,
      };
      calls.lifecycle = {
        ...options.lifecycleOptions,
        bindClientHandlers: entryHandlers.bindClientHandlers,
      };
      return {
        id: 'example',
        capabilities: platformCapabilities,
        commandRegistryRenderer,
        commandViewRenderer,
        interactionResponse,
        eventNormalizer,
        messageDelivery,
        notificationDelivery,
        conversationSpawn,
        conversationPresentation,
        conversationSecurity,
        textPresentation,
        accessPolicy,
        entryHandlers,
        lifecycle,
      };
    },
  };

  const appContext = createAppContext({
    platformFoundation,
    identityOptions: { defaultProvider: 'codex' },
    sessionSettingsOptions: { codexTimeoutMs: 60000 },
    securityPolicyOptions: {
      enableConfigCmd: true,
    },
    sessionStoreOptions: {
      dataFile: '/tmp/sessions.json',
      workspaceRoot: '/tmp/workspaces',
    },
    commandActionsOptions: {
      resolveProviderDefaultWorkspace: () => ({ workspaceDir: '/repo/default' }),
      setProviderDefaultWorkspace: () => {},
      resolveChildThreadWorkspaceMode: () => ({ mode: 'inherit' }),
      setChildThreadWorkspaceMode: () => ({ mode: 'separate' }),
      getProviderShortName: () => 'Codex',
      listRecentSessions: () => [],
      humanAge: () => '1s',
    },
    workspaceRuntimeOptions: {
      lockRoot: '/tmp/locks',
    },
    promptRuntimeOptions: {
      runtimePresentationOptions: {
        showReasoning: true,
      },
      promptOrchestratorOptions: {
        safeReply: async () => {},
        withDiscordNetworkRetry: async (fn) => fn(),
        splitForDiscord: (text) => [text],
        getProviderDisplayName: () => 'Codex CLI',
        getProviderShortName: () => 'Codex',
        getProviderDefaultBin: () => 'codex',
        getProviderBinEnvName: () => 'CODEX_BIN',
        acquireWorkspace: async () => ({ release() {} }),
        stopChildProcess: () => {},
        isCliNotFound: () => false,
        safeError: (error) => error?.message || String(error),
        truncate: (text) => text,
        toOptionalInt: () => null,
        humanElapsed: () => '1s',
        createProgressEventDeduper: () => () => false,
        buildProgressEventDedupeKey: () => 'key',
        extractInputTokensFromUsage: () => null,
        composeFinalAnswerText: () => 'answer',
      },
      channelQueueOptions: {
        safeReply: async () => {},
        safeError: (error) => error?.message || String(error),
      },
    },
    commandSurfaceOptions: {
      botProvider: null,
      defaultUiLanguage: 'zh',
      enableConfigCmd: true,
      onboardingOptions: {
        onboardingEnabledByDefault: true,
      },
      reportOptions: {},
      workspaceBrowserOptions: {
        resolveProviderDefaultWorkspace: () => ({ workspaceDir: '/repo/default' }),
        resolveChildThreadWorkspaceMode: () => ({ mode: 'inherit', source: 'default' }),
        setChildThreadWorkspaceMode: () => ({ mode: 'separate', source: 'provider-scoped env' }),
      },
      slashRouterOptions: {},
      textCommandOptions: {},
    },
    accessPolicyOptions: {
      allowedChannelIds: ['channel-1'],
      allowedUserIds: ['user-1'],
    },
    entryHandlerOptions: {
      logger: console,
    },
    lifecycleOptions: {
      selfHealEnabled: true,
      createClient: () => ({ client: true }),
    },
    singleInstanceLockOptions: {
      lockFile: '/tmp/bot.lock',
    },
    factories: {
      createSessionIdentityHelpersFn: (options) => {
        calls.identity = options;
        return identity;
      },
      createSessionSettingsFn: (options) => {
        calls.sessionSettings = options;
        return sessionSettings;
      },
      createSecurityPolicyFn: (options) => {
        calls.securityPolicy = options;
        return securityPolicy;
      },
      createSessionStoreFn: (options) => {
        calls.sessionStore = options;
        return sessionStore;
      },
      createSessionCommandActionsFn: (options) => {
        calls.commandActions = options;
        return commandActions;
      },
      createWorkspaceRuntimeFn: (options) => {
        calls.workspaceRuntime = options;
        return workspaceRuntime;
      },
      createPromptRuntimeFn: (options) => {
        calls.promptRuntime = options;
        return promptRuntime;
      },
      createCommandSurfaceFn: (options) => {
        calls.commandSurface = options;
        return commandSurface;
      },
      createSingleInstanceLockFn: (options) => {
        calls.singleInstanceLock = options;
        return singleInstanceLock;
      },
    },
  });

  assert.equal(calls.identity.defaultProvider, 'codex');
  assert.equal(calls.securityPolicy.getEffectiveSecurityProfile, sessionSettings.getEffectiveSecurityProfile);
  assert.equal(calls.securityPolicy.conversationSecurityResolver, conversationSecurity);
  assert.equal(calls.sessionStore.getSessionId, identity.getSessionId);
  assert.equal(calls.commandActions.saveDb, sessionStore.saveDb);
  assert.equal(calls.commandActions.resolveTimeoutSetting, sessionSettings.resolveTimeoutSetting);
  assert.equal(calls.promptRuntime.runtimePresentationOptions.getSessionId, identity.getSessionId);
  assert.equal(
    calls.promptRuntime.runtimePresentationOptions.sanitizeProgressDisplayText,
    textPresentation.sanitizeDisplayText,
  );
  assert.equal(calls.promptRuntime.runnerExecutorOptions.getSessionProvider, identity.getSessionProvider);
  assert.equal(calls.promptRuntime.promptOrchestratorOptions.getSession, sessionStore.getSession);
  assert.equal(calls.promptRuntime.promptOrchestratorOptions.resolveTimeoutSetting, sessionSettings.resolveTimeoutSetting);
  assert.equal(calls.promptRuntime.promptOrchestratorOptions.resolveTaskRetrySetting, sessionSettings.resolveTaskRetrySetting);
  assert.equal(calls.promptRuntime.promptOrchestratorOptions.resolveModelSetting, sessionSettings.resolveModelSetting);
  assert.equal(calls.promptRuntime.promptOrchestratorOptions.resolveReasoningEffortSetting, sessionSettings.resolveReasoningEffortSetting);
  assert.equal(calls.promptRuntime.promptOrchestratorOptions.resolveReplyDeliverySetting, sessionSettings.resolveReplyDeliverySetting);
  assert.equal(calls.promptRuntime.channelQueueOptions.resolveSecurityContext, securityPolicy.resolveSecurityContext);
  assert.equal(calls.promptRuntime.channelQueueOptions.resolveBusyPromptModeSetting, sessionSettings.resolveBusyPromptModeSetting);
  assert.equal(calls.promptRuntime.channelQueueOptions.getCurrentUserId, undefined);
  assert.equal(calls.promptRuntime.messageDelivery, appContext.messageDelivery);
  assert.equal(calls.promptRuntime.promptOrchestratorOptions.progressUpdatesEnabled, false);
  assert.equal('commandViewRenderer' in calls.promptRuntime, false);
  assert.equal(calls.promptRuntime.channelQueueOptions.slashRef('status'), '/bot_status');
  assert.match(
    calls.promptRuntime.promptOrchestratorOptions.formatWorkspaceBusyReport(
      { language: 'zh' },
      '/repo/demo',
      { provider: 'codex', key: 'thread-1' },
    ),
    /workspace 正忙/,
  );
  assert.equal(calls.promptRuntime.promptOrchestratorOptions.slashRef('status'), '/bot_status');
  assert.equal(calls.commandSurface.reportOptions.getRuntimeSnapshot, promptRuntime.getRuntimeSnapshot);
  assert.equal(calls.commandSurface.commandRegistryRenderer, appContext.commandRegistryRenderer);
  assert.equal(calls.commandSurface.interactionResponse, appContext.interactionResponse);
  assert.equal(calls.commandSurface.messageDelivery, appContext.messageDelivery);
  assert.equal(calls.commandSurface.conversationPresentation, conversationPresentation);
  assert.equal(calls.commandSurface.platformCapabilities, appContext.platformAdapter.capabilities);
  assert.equal(calls.commandSurface.reportOptions.getSessionId, identity.getSessionId);
  const platformHealth = calls.commandSurface.reportOptions.getPlatformHealth();
  assert.deepEqual(platformHealth, {
    platformId: 'example',
    observedAt: platformHealth.observedAt,
    connection: { state: 'connected' },
    delivery: { succeeded: 7, failed: 1, inFlight: 0 },
  });
  assert.equal(calls.commandSurface.settingsPanelOptions.resolveCompactThresholdSetting, sessionSettings.resolveCompactThresholdSetting);
  assert.equal(calls.commandSurface.settingsPanelOptions.resolveReplyDeliverySetting, sessionSettings.resolveReplyDeliverySetting);
  assert.equal(calls.commandSurface.workspaceBrowserOptions.commandActions, commandActions);
  assert.equal(typeof calls.commandSurface.workspaceBrowserOptions.resolveChildThreadWorkspaceMode, 'function');
  assert.equal(typeof calls.commandSurface.workspaceBrowserOptions.setChildThreadWorkspaceMode, 'function');
  assert.equal(calls.commandSurface.slashRouterOptions.cancelChannelWork, promptRuntime.cancelChannelWork);
  assert.equal(calls.commandSurface.slashRouterOptions.enqueuePrompt, promptRuntime.enqueuePrompt);
  assert.equal(calls.commandSurface.slashRouterOptions.getSessionId, identity.getSessionId);
  assert.equal(calls.commandSurface.slashRouterOptions.retryLastPrompt, promptRuntime.retryLastPrompt);
  assert.equal(calls.commandSurface.slashRouterOptions.conversationSpawn, conversationSpawn);
  assert.equal(calls.commandSurface.textCommandOptions.cancelChannelWork, promptRuntime.cancelChannelWork);
  assert.equal(calls.commandSurface.textCommandOptions.enqueuePrompt, promptRuntime.enqueuePrompt);
  assert.equal(calls.commandSurface.textCommandOptions.dequeuePrompt, promptRuntime.dequeuePrompt);
  assert.equal(calls.commandSurface.textCommandOptions.getRuntimeSnapshot, promptRuntime.getRuntimeSnapshot);
  assert.equal(calls.commandSurface.textCommandOptions.resolveSecurityContext, securityPolicy.resolveSecurityContext);
  assert.equal(calls.commandSurface.textCommandOptions.conversationSpawn, conversationSpawn);
  assert.equal(calls.platformAdapter.accessPolicyOptions.allowedChannelIds[0], 'channel-1');
  assert.equal(calls.platformAdapter.commandRegistryRenderer, appContext.commandRegistryRenderer);
  assert.equal(calls.platformAdapter.messageDelivery, appContext.messageDelivery);
  assert.equal(calls.platformAdapter.notificationDelivery, notificationDelivery);
  assert.equal(calls.platformAdapter.commandViewRenderer, appContext.commandViewRenderer);
  assert.equal(calls.platformAdapter.interactionResponse, appContext.interactionResponse);
  assert.equal(calls.platformAdapter.conversationSpawn, conversationSpawn);
  assert.equal(calls.platformAdapter.conversationPresentation, conversationPresentation);
  assert.equal(calls.platformAdapter.conversationSecurity, conversationSecurity);
  assert.equal(calls.platformAdapter.textPresentation, textPresentation);
  assert.equal(calls.platformAdapter.lifecycleOptions.cancelAllChannelWork, promptRuntime.cancelAllChannelWork);
  assert.equal(calls.entryHandlers.enqueuePrompt, promptRuntime.enqueuePrompt);
  assert.equal(calls.entryHandlers.messageDelivery, appContext.messageDelivery);
  assert.equal(calls.entryHandlers.conversationSpawn, conversationSpawn);
  assert.equal(calls.entryHandlers.commandRegistryRenderer, appContext.commandRegistryRenderer);
  assert.equal(calls.entryHandlers.commandSpecs, commandSurface.commandSpecs);
  assert.equal(calls.entryHandlers.routeSlashCommand, commandSurface.routeSlashCommand);
  assert.equal(calls.lifecycle.bindClientHandlers, entryHandlers.bindClientHandlers);
  assert.equal(calls.lifecycle.cancelAllChannelWork, promptRuntime.cancelAllChannelWork);
  assert.equal(appContext.core.identity, identity);
  assert.equal(appContext.core.sessionStore, sessionStore);
  assert.equal(appContext.promptRuntime, promptRuntime);
  assert.equal(appContext.commandSurface, commandSurface);
  assert.equal(appContext.messageDelivery, messageDelivery);
  assert.equal(appContext.notificationDelivery, notificationDelivery);
  assert.equal(appContext.commandRegistryRenderer, commandRegistryRenderer);
  assert.equal(appContext.commandViewRenderer, commandViewRenderer);
  assert.equal(appContext.interactionResponse, interactionResponse);
  assert.equal(appContext.eventNormalizer, appContext.platformAdapter.eventNormalizer);
  assert.equal(appContext.platformAdapter.id, 'example');
  assert.equal(appContext.platformFoundation.id, 'example');
  assert.equal(appContext.platformFoundation.createAdapter instanceof Function, true);
  assert.equal(appContext.platformAdapter.commandRegistryRenderer, appContext.commandRegistryRenderer);
  assert.equal(appContext.platformAdapter.commandViewRenderer, appContext.commandViewRenderer);
  assert.equal(appContext.platformAdapter.interactionResponse, appContext.interactionResponse);
  assert.equal(appContext.platformAdapter.notificationDelivery, appContext.notificationDelivery);
  assert.equal(appContext.platformAdapter.conversationSpawn, appContext.conversationSpawn);
  assert.equal(appContext.platformAdapter.conversationPresentation, appContext.conversationPresentation);
  assert.equal(appContext.platformAdapter.conversationSecurity, appContext.conversationSecurity);
  assert.equal(appContext.platformAdapter.textPresentation, appContext.textPresentation);
  assert.equal(appContext.platformAdapter.entryHandlers, entryHandlers);
  assert.equal(appContext.accessPolicy, accessPolicy);
  assert.equal(appContext.lifecycle, lifecycle);
  assert.equal(appContext.singleInstanceLock, singleInstanceLock);
});

test('bootApp acquires lock sets cleanup and boots lifecycle', async () => {
  const events = [];

  await bootApp({
    singleInstanceLock: {
      acquire: () => events.push('lock.acquire'),
      setupCleanupHandlers: () => events.push('lock.cleanup'),
    },
    lifecycle: {
      setupProcessSelfHeal: () => events.push('lifecycle.heal'),
      bootClient: async (reason) => events.push(`lifecycle.boot:${reason}`),
    },
    reason: 'restart',
  });

  assert.deepEqual(events, [
    'lock.acquire',
    'lock.cleanup',
    'lifecycle.heal',
    'lifecycle.boot:restart',
  ]);
});
