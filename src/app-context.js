import { createPromptRuntime } from './prompt-runtime.js';
import { createSessionCommandActions } from './session-command-actions.js';
import { createSessionStore } from './session-store.js';
import { createSecurityPolicy } from './security-policy.js';
import { createSessionSettings } from './session-settings.js';
import { createSessionIdentityHelpers } from './session-identity.js';
import { createCommandSurface } from './command-surface.js';
import { createWorkspaceRuntime } from './workspace-runtime.js';
import { createDiscordAccessPolicy } from './discord-access-policy.js';
import { createDiscordEntryHandlers } from './discord-entry-handlers.js';
import { createDiscordLifecycle } from './discord-lifecycle.js';
import { createDiscordPlatformAdapter } from './platforms/discord/adapter.js';
import { createDiscordPlatformFoundation } from './platforms/discord/foundation.js';
import { assertPlatformFoundation } from './platforms/foundation.js';
import { createDiscordMessageDelivery } from './platforms/discord/message-delivery.js';
import { createDiscordNotificationDelivery } from './platforms/discord/notification-delivery.js';
import { assertPlatformAdapter } from './platforms/contracts.js';
import { createDiscordCommandViewRenderer } from './platforms/discord/command-view-renderer.js';
import { createDiscordCommandRegistryRenderer } from './platforms/discord/command-registry-renderer.js';
import { createDiscordInteractionResponse } from './platforms/discord/interaction-response.js';
import { createDiscordConversationSpawn } from './platforms/discord/conversation-spawn.js';
import { createDiscordConversationPresentation } from './platforms/discord/conversation-presentation.js';
import { createDiscordConversationSecurity } from './platforms/discord/conversation-security.js';
import { createDiscordTextPresentation } from './platforms/discord/text-presentation.js';
import { DISCORD_PLATFORM_CAPABILITIES } from './platforms/capabilities.js';
import {
  createCapabilityAwareCommandRegistryRenderer,
  createCapabilityAwareCommandViewRenderer,
  createCapabilityAwareInteractionResponse,
} from './platforms/command-ui-policy.js';
import {
  createCapabilityAwareInboundEventNormalizer,
  createCapabilityAwareMessageDelivery,
} from './platforms/runtime-capability-policy.js';
import { createSingleInstanceLock } from './single-instance-lock.js';
import { formatWorkspaceBusyReport as formatWorkspaceBusyReportBase } from './workspace-busy-report.js';

export function createAppContext({
  platformCapabilities = DISCORD_PLATFORM_CAPABILITIES,
  platformFoundation = null,
  platformFoundationOptions = {},
  identityOptions = {},
  sessionSettingsOptions = {},
  securityPolicyOptions = {},
  sessionStoreOptions = {},
  commandActionsOptions = {},
  workspaceRuntimeOptions = {},
  promptRuntimeOptions = {},
  messageDeliveryOptions = {},
  notificationDeliveryOptions = {},
  commandViewRendererOptions = {},
  commandRegistryRendererOptions = {},
  interactionResponseOptions = {},
  conversationSpawnOptions = {},
  conversationPresentationOptions = {},
  conversationSecurityOptions = {},
  textPresentationOptions = {},
  commandSurfaceOptions = {},
  accessPolicyOptions = {},
  entryHandlerOptions = {},
  lifecycleOptions = {},
  singleInstanceLockOptions = {},
  factories = {},
} = {}) {
  const {
    createSessionIdentityHelpersFn = createSessionIdentityHelpers,
    createSessionSettingsFn = createSessionSettings,
    createSecurityPolicyFn = createSecurityPolicy,
    createSessionStoreFn = createSessionStore,
    createSessionCommandActionsFn = createSessionCommandActions,
    createWorkspaceRuntimeFn = createWorkspaceRuntime,
    createPromptRuntimeFn = createPromptRuntime,
    createCommandSurfaceFn = createCommandSurface,
    createMessageDeliveryFn = createDiscordMessageDelivery,
    createNotificationDeliveryFn = createDiscordNotificationDelivery,
    createCommandViewRendererFn = createDiscordCommandViewRenderer,
    createCommandRegistryRendererFn = createDiscordCommandRegistryRenderer,
    createInteractionResponseFn = createDiscordInteractionResponse,
    createConversationSpawnFn = createDiscordConversationSpawn,
    createConversationPresentationFn = createDiscordConversationPresentation,
    createConversationSecurityFn = createDiscordConversationSecurity,
    createTextPresentationFn = createDiscordTextPresentation,
    createCapabilityAwareCommandRegistryRendererFn = createCapabilityAwareCommandRegistryRenderer,
    createCapabilityAwareCommandViewRendererFn = createCapabilityAwareCommandViewRenderer,
    createCapabilityAwareInteractionResponseFn = createCapabilityAwareInteractionResponse,
    createCapabilityAwareInboundEventNormalizerFn = createCapabilityAwareInboundEventNormalizer,
    createCapabilityAwareMessageDeliveryFn = createCapabilityAwareMessageDelivery,
    createPlatformAdapterFn = createDiscordPlatformAdapter,
    createPlatformFoundationFn = createDiscordPlatformFoundation,
    createDiscordAccessPolicyFn = createDiscordAccessPolicy,
    createDiscordEntryHandlersFn = createDiscordEntryHandlers,
    createDiscordLifecycleFn = createDiscordLifecycle,
    createSingleInstanceLockFn = createSingleInstanceLock,
  } = factories;

  const {
    SlashCommandBuilder: foundationSlashCommandBuilder,
    slashPrefix: foundationSlashPrefix = '',
  } = commandSurfaceOptions;
  const foundationPromptOrchestratorOptions = promptRuntimeOptions.promptOrchestratorOptions || {};
  const {
    factories: platformFoundationFactoryOverrides = {},
    ...platformFoundationRest
  } = platformFoundationOptions;
  const resolvedPlatformFoundation = assertPlatformFoundation(
    platformFoundation || createPlatformFoundationFn({
      capabilities: platformCapabilities,
      commandRegistryRendererOptions: {
        SlashCommandBuilder: foundationSlashCommandBuilder,
        slashPrefix: foundationSlashPrefix,
        ...commandRegistryRendererOptions,
      },
      commandViewRendererOptions,
      messageDeliveryOptions: {
        reply: foundationPromptOrchestratorOptions.safeReply,
        send: foundationPromptOrchestratorOptions.safeChannelSend,
        splitText: foundationPromptOrchestratorOptions.splitForDiscord,
        ...messageDeliveryOptions,
      },
      notificationDeliveryOptions,
      interactionResponseOptions: {
        logger: entryHandlerOptions.logger,
        withDiscordNetworkRetry: entryHandlerOptions.withDiscordNetworkRetry,
        ...interactionResponseOptions,
      },
      conversationSpawnOptions,
      conversationPresentationOptions,
      conversationSecurityOptions: {
        permissionFlagsBits: securityPolicyOptions.permissionFlagsBits,
        ...conversationSecurityOptions,
      },
      textPresentationOptions,
      ...platformFoundationRest,
      factories: {
        createAdapter: createPlatformAdapterFn,
        createCommandRegistryRenderer: createCommandRegistryRendererFn,
        createCommandViewRenderer: createCommandViewRendererFn,
        createInteractionResponse: createInteractionResponseFn,
        createMessageDelivery: createMessageDeliveryFn,
        createNotificationDelivery: createNotificationDeliveryFn,
        createConversationSpawn: createConversationSpawnFn,
        createConversationPresentation: createConversationPresentationFn,
        createConversationSecurity: createConversationSecurityFn,
        createTextPresentation: createTextPresentationFn,
        createCommandRegistryPolicy: createCapabilityAwareCommandRegistryRendererFn,
        createCommandViewPolicy: createCapabilityAwareCommandViewRendererFn,
        createInteractionResponsePolicy: createCapabilityAwareInteractionResponseFn,
        createMessageDeliveryPolicy: createCapabilityAwareMessageDeliveryFn,
        ...platformFoundationFactoryOverrides,
      },
    }),
  );
  const resolvedPlatformCapabilities = resolvedPlatformFoundation.capabilities;

  const identity = createSessionIdentityHelpersFn(identityOptions);
  const sessionStore = createSessionStoreFn({
    ...sessionStoreOptions,
    getSessionId: identity.getSessionId,
  });
  const sessionSettings = createSessionSettingsFn({
    ...sessionSettingsOptions,
    getParentSession: sessionStore.getParentSession,
  });
  const conversationSecurity = resolvedPlatformFoundation.conversationSecurity;
  const textPresentation = resolvedPlatformFoundation.textPresentation;
  const securityPolicy = createSecurityPolicyFn({
    ...securityPolicyOptions,
    getEffectiveSecurityProfile: sessionSettings.getEffectiveSecurityProfile,
    conversationSecurityResolver: conversationSecurity,
  });
  const commandActions = createSessionCommandActionsFn({
    ...commandActionsOptions,
    saveDb: sessionStore.saveDb,
    ensureWorkspace: sessionStore.ensureWorkspace,
    getWorkspaceBinding: sessionStore.getWorkspaceBinding,
    listStoredSessions: sessionStore.listSessions,
    clearSessionId: identity.clearSessionId,
    getSessionId: identity.getSessionId,
    setSessionId: identity.setSessionId,
    getSessionProvider: identity.getSessionProvider,
    getSessionLanguage: sessionSettings.getSessionLanguage,
    resolveModelSetting: sessionSettings.resolveModelSetting,
    resolveCodexProfileSetting: sessionSettings.resolveCodexProfileSetting,
    resolveReasoningEffortSetting: sessionSettings.resolveReasoningEffortSetting,
    resolveFastModeSetting: sessionSettings.resolveFastModeSetting,
    resolveRuntimeModeSetting: sessionSettings.resolveRuntimeModeSetting,
    resolveBusyPromptModeSetting: sessionSettings.resolveBusyPromptModeSetting,
    resolveTimeoutSetting: sessionSettings.resolveTimeoutSetting,
    resolveReplyDeliveryDefault: commandActionsOptions.resolveReplyDeliveryDefault,
    setReplyDeliveryDefault: commandActionsOptions.setReplyDeliveryDefault,
  });
  const workspaceRuntime = createWorkspaceRuntimeFn(workspaceRuntimeOptions);
  const {
    SlashCommandBuilder: legacySlashCommandBuilder,
    slashPrefix: legacySlashPrefix = '',
    onboardingOptions = {},
    settingsPanelOptions = {},
    reportOptions = {},
    workspaceBrowserOptions = {},
    slashRouterOptions = {},
    textCommandOptions = {},
    ...commandSurfaceRest
  } = commandSurfaceOptions;
  void legacySlashCommandBuilder;
  void legacySlashPrefix;
  const commandRegistryRenderer = resolvedPlatformFoundation.commandRegistryRenderer;
  const promptSlashRef = (base) => commandRegistryRenderer.formatCommandReference(base);
  const formatWorkspaceBusyReport = (session, workspaceDir, owner = null) => formatWorkspaceBusyReportBase(
    session,
    workspaceDir,
    owner,
    {
      getSessionLanguage: sessionSettings.getSessionLanguage,
      normalizeUiLanguage: promptOrchestratorOptions.normalizeUiLanguage,
      humanAge: reportOptions.humanAge,
      slashRef: promptSlashRef,
    },
  );
  let buildWorkspaceBusyPayload = ({ key, session, userId, workspaceDir, owner }) => ({
    content: formatWorkspaceBusyReport(session, workspaceDir, owner),
  });

  const {
    runtimePresentationOptions = {},
    channelRuntimeStoreOptions = {},
    sessionProgressBridgeOptions = {},
    runnerExecutorOptions = {},
    promptOrchestratorOptions = {},
    channelQueueOptions = {},
    factories: promptRuntimeFactories = {},
    ...promptRuntimeRest
  } = promptRuntimeOptions;

  const commandViewRenderer = resolvedPlatformFoundation.commandViewRenderer;
  const messageDelivery = resolvedPlatformFoundation.messageDelivery;
  const notificationDelivery = resolvedPlatformFoundation.notificationDelivery;
  const interactionResponse = resolvedPlatformFoundation.interactionResponse;
  const conversationSpawn = resolvedPlatformFoundation.conversationSpawn;
  const conversationPresentation = resolvedPlatformFoundation.conversationPresentation;

  const promptRuntime = createPromptRuntimeFn({
    ...promptRuntimeRest,
    messageDelivery,
    runtimePresentationOptions: {
      ...runtimePresentationOptions,
      getSessionId: identity.getSessionId,
      getSessionProvider: identity.getSessionProvider,
      formatSessionIdLabel: identity.formatSessionIdLabel,
      sanitizeProgressDisplayText: textPresentation.sanitizeDisplayText,
    },
    channelRuntimeStoreOptions,
    sessionProgressBridgeOptions,
    runnerExecutorOptions: {
      ...runnerExecutorOptions,
      getSessionProvider: identity.getSessionProvider,
      getSessionId: identity.getSessionId,
      resolveModelSetting: sessionSettings.resolveModelSetting,
      resolveCodexProfileSetting: sessionSettings.resolveCodexProfileSetting,
      resolveReasoningEffortSetting: sessionSettings.resolveReasoningEffortSetting,
      resolveFastModeSetting: sessionSettings.resolveFastModeSetting,
      resolveRuntimeModeSetting: sessionSettings.resolveRuntimeModeSetting,
      resolveBusyPromptModeSetting: sessionSettings.resolveBusyPromptModeSetting,
      resolveReplyDeliverySetting: sessionSettings.resolveReplyDeliverySetting,
      resolveTimeoutSetting: sessionSettings.resolveTimeoutSetting,
      resolveCompactStrategySetting: sessionSettings.resolveCompactStrategySetting,
      resolveCompactEnabledSetting: sessionSettings.resolveCompactEnabledSetting,
      resolveNativeCompactTokenLimitSetting: sessionSettings.resolveNativeCompactTokenLimitSetting,
    },
    promptOrchestratorOptions: {
      ...promptOrchestratorOptions,
      progressUpdatesEnabled: resolvedPlatformCapabilities.messageEdits
        && promptOrchestratorOptions.progressUpdatesEnabled !== false,
      getSession: sessionStore.getSession,
      ensureWorkspace: sessionStore.ensureWorkspace,
      saveDb: sessionStore.saveDb,
      clearSessionId: identity.clearSessionId,
      getSessionId: identity.getSessionId,
      setSessionId: identity.setSessionId,
      getSessionProvider: identity.getSessionProvider,
      getSessionLanguage: sessionSettings.getSessionLanguage,
      resolveModelSetting: sessionSettings.resolveModelSetting,
      resolveCodexProfileSetting: sessionSettings.resolveCodexProfileSetting,
      resolveReasoningEffortSetting: sessionSettings.resolveReasoningEffortSetting,
      resolveFastModeSetting: sessionSettings.resolveFastModeSetting,
      resolveRuntimeModeSetting: sessionSettings.resolveRuntimeModeSetting,
      resolveBusyPromptModeSetting: sessionSettings.resolveBusyPromptModeSetting,
      resolveReplyDeliverySetting: sessionSettings.resolveReplyDeliverySetting,
      resolveTimeoutSetting: sessionSettings.resolveTimeoutSetting,
      resolveTaskRetrySetting: sessionSettings.resolveTaskRetrySetting,
      resolveCompactStrategySetting: sessionSettings.resolveCompactStrategySetting,
      resolveCompactEnabledSetting: sessionSettings.resolveCompactEnabledSetting,
      resolveCompactThresholdSetting: sessionSettings.resolveCompactThresholdSetting,
      resolveExtraInfoSetting: sessionSettings.resolveExtraInfoSetting,
      acquireWorkspace: workspaceRuntime.acquireWorkspace,
      formatWorkspaceBusyReport,
      buildWorkspaceBusyPayload: (input) => buildWorkspaceBusyPayload(input),
      slashRef: promptSlashRef,
    },
    channelQueueOptions: {
      ...channelQueueOptions,
      getSession: sessionStore.getSession,
      resolveSecurityContext: securityPolicy.resolveSecurityContext,
      resolveBusyPromptModeSetting: sessionSettings.resolveBusyPromptModeSetting,
      slashRef: promptSlashRef,
    },
    factories: promptRuntimeFactories,
  });

  const commandSurface = createCommandSurfaceFn({
    ...commandSurfaceRest,
    platformCapabilities: resolvedPlatformCapabilities,
    commandRegistryRenderer,
    interactionResponse,
    messageDelivery,
    conversationPresentation,
    onboardingOptions: {
      ...onboardingOptions,
      commandActions,
      getSession: sessionStore.getSession,
      saveDb: sessionStore.saveDb,
      getSessionProvider: identity.getSessionProvider,
      getWorkspaceBinding: sessionStore.getWorkspaceBinding,
      resolveSecurityContext: securityPolicy.resolveSecurityContext,
      getSessionLanguage: sessionSettings.getSessionLanguage,
    },
    settingsPanelOptions: {
      ...settingsPanelOptions,
      commandActions,
      getSession: sessionStore.getSession,
      getSessionLanguage: sessionSettings.getSessionLanguage,
      getSessionProvider: identity.getSessionProvider,
      getWorkspaceBinding: sessionStore.getWorkspaceBinding,
      getProviderDefaults: sessionSettings.getProviderDefaults,
      resolveCodexProfileSetting: sessionSettings.resolveCodexProfileSetting,
      resolveModelSetting: sessionSettings.resolveModelSetting,
      resolveReasoningEffortSetting: sessionSettings.resolveReasoningEffortSetting,
      resolveFastModeSetting: sessionSettings.resolveFastModeSetting,
      resolveRuntimeModeSetting: sessionSettings.resolveRuntimeModeSetting,
      resolveBusyPromptModeSetting: sessionSettings.resolveBusyPromptModeSetting,
      resolveCompactStrategySetting: sessionSettings.resolveCompactStrategySetting,
      resolveCompactThresholdSetting: sessionSettings.resolveCompactThresholdSetting,
      resolveReplyDeliverySetting: sessionSettings.resolveReplyDeliverySetting,
      resolveExtraInfoSetting: sessionSettings.resolveExtraInfoSetting,
      getDefaultCodexProfile: commandActionsOptions.resolveDefaultCodexProfile,
      getReplyDeliveryDefault: commandActionsOptions.resolveReplyDeliveryDefault,
      getChannelState: promptRuntime.getChannelState,
      closeRuntimeSession: promptRuntime.closeRuntimeSession,
    },
    reportOptions: {
      ...reportOptions,
      getSessionLanguage: sessionSettings.getSessionLanguage,
      getSessionProvider: identity.getSessionProvider,
      getSessionId: identity.getSessionId,
      getRuntimeSnapshot: promptRuntime.getRuntimeSnapshot,
      resolveSecurityContext: securityPolicy.resolveSecurityContext,
      resolveModelSetting: sessionSettings.resolveModelSetting,
      resolveCodexProfileSetting: sessionSettings.resolveCodexProfileSetting,
      resolveReasoningEffortSetting: sessionSettings.resolveReasoningEffortSetting,
      resolveTimeoutSetting: sessionSettings.resolveTimeoutSetting,
      resolveFastModeSetting: sessionSettings.resolveFastModeSetting,
      resolveRuntimeModeSetting: sessionSettings.resolveRuntimeModeSetting,
      resolveBusyPromptModeSetting: sessionSettings.resolveBusyPromptModeSetting,
      resolveReplyDeliverySetting: sessionSettings.resolveReplyDeliverySetting,
      resolveExtraInfoSetting: sessionSettings.resolveExtraInfoSetting,
      getEffectiveSecurityProfile: sessionSettings.getEffectiveSecurityProfile,
      resolveCompactStrategySetting: sessionSettings.resolveCompactStrategySetting,
      resolveCompactEnabledSetting: sessionSettings.resolveCompactEnabledSetting,
      resolveCompactThresholdSetting: sessionSettings.resolveCompactThresholdSetting,
      resolveNativeCompactTokenLimitSetting: sessionSettings.resolveNativeCompactTokenLimitSetting,
      getWorkspaceBinding: sessionStore.getWorkspaceBinding,
      readWorkspaceLock: workspaceRuntime.readLock,
      formatPermissionsLabel: promptRuntime.formatPermissionsLabel,
      formatConversationReference: conversationSpawn.formatConversationReference,
      formatSecurityProfileDisplay: securityPolicy.formatSecurityProfileDisplay,
      formatQueueLimit: securityPolicy.formatQueueLimit,
      formatRuntimeLabel: promptRuntime.formatRuntimeLabel,
      formatSessionStatusLabel: promptRuntime.formatSessionStatusLabel,
      formatTimeoutLabel: promptRuntime.formatTimeoutLabel,
      formatConfigCommandStatus: securityPolicy.formatConfigCommandStatus,
      describeConfigPolicy: securityPolicy.describeConfigPolicy,
      formatProgressPlanSummary: promptRuntime.formatProgressPlanSummary,
      formatCompletedStepsSummary: promptRuntime.formatCompletedStepsSummary,
      renderProcessContentLines: promptRuntime.renderProcessContentLines,
      localizeProgressLines: promptRuntime.localizeProgressLines,
      renderProgressPlanLines: promptRuntime.renderProgressPlanLines,
      renderCompletedStepsLines: promptRuntime.renderCompletedStepsLines,
    },
    workspaceBrowserOptions: {
      ...workspaceBrowserOptions,
      commandActions,
      getSession: sessionStore.getSession,
      getSessionLanguage: sessionSettings.getSessionLanguage,
      getSessionProvider: identity.getSessionProvider,
      getWorkspaceBinding: sessionStore.getWorkspaceBinding,
      resolveChildThreadWorkspaceMode: workspaceBrowserOptions.resolveChildThreadWorkspaceMode,
      setChildThreadWorkspaceMode: workspaceBrowserOptions.setChildThreadWorkspaceMode,
      listStoredSessions: sessionStore.listSessions,
      listFavoriteWorkspaces: sessionStore.listFavoriteWorkspaces,
      addFavoriteWorkspace: sessionStore.addFavoriteWorkspace,
      removeFavoriteWorkspace: sessionStore.removeFavoriteWorkspace,
    },
    slashRouterOptions: {
      ...slashRouterOptions,
      getSession: sessionStore.getSession,
      getSessionLanguage: sessionSettings.getSessionLanguage,
      getSessionProvider: identity.getSessionProvider,
      getSessionId: identity.getSessionId,
      getEffectiveSecurityProfile: sessionSettings.getEffectiveSecurityProfile,
      resolveModelSetting: sessionSettings.resolveModelSetting,
      resolveReasoningEffortSetting: sessionSettings.resolveReasoningEffortSetting,
      getRuntimeSnapshot: promptRuntime.getRuntimeSnapshot,
      resolveFastModeSetting: sessionSettings.resolveFastModeSetting,
      resolveRuntimeModeSetting: sessionSettings.resolveRuntimeModeSetting,
      resolveBusyPromptModeSetting: sessionSettings.resolveBusyPromptModeSetting,
      resolveSecurityContext: securityPolicy.resolveSecurityContext,
      resolveTimeoutSetting: sessionSettings.resolveTimeoutSetting,
      resolveExtraInfoSetting: sessionSettings.resolveExtraInfoSetting,
      commandActions,
      enqueuePrompt: promptRuntime.enqueuePrompt,
      cancelChannelWork: promptRuntime.cancelChannelWork,
      closeRuntimeSession: promptRuntime.closeRuntimeSession,
      retryLastPrompt: promptRuntime.retryLastPrompt,
      compactSession: promptRuntime.compactSession,
      startCodexSideConversation: promptRuntime.startCodexSideConversation,
      closeCodexSideConversation: promptRuntime.closeCodexSideConversation,
      conversationSpawn,
      ensureWorkspace: sessionStore.ensureWorkspace,
    },
    textCommandOptions: {
      ...textCommandOptions,
      safeReply: messageDelivery.reply,
      getSession: sessionStore.getSession,
      saveDb: sessionStore.saveDb,
      ensureWorkspace: sessionStore.ensureWorkspace,
      clearSessionId: identity.clearSessionId,
      getSessionId: identity.getSessionId,
      setSessionId: identity.setSessionId,
      getSessionProvider: identity.getSessionProvider,
      getSessionLanguage: sessionSettings.getSessionLanguage,
      commandActions,
      resolveModelSetting: sessionSettings.resolveModelSetting,
      resolveReasoningEffortSetting: sessionSettings.resolveReasoningEffortSetting,
      getEffectiveSecurityProfile: sessionSettings.getEffectiveSecurityProfile,
      resolveFastModeSetting: sessionSettings.resolveFastModeSetting,
      resolveRuntimeModeSetting: sessionSettings.resolveRuntimeModeSetting,
      resolveBusyPromptModeSetting: sessionSettings.resolveBusyPromptModeSetting,
      resolveTimeoutSetting: sessionSettings.resolveTimeoutSetting,
      resolveExtraInfoSetting: sessionSettings.resolveExtraInfoSetting,
      describeConfigPolicy: securityPolicy.describeConfigPolicy,
      isConfigKeyAllowed: securityPolicy.isConfigKeyAllowed,
      enqueuePrompt: promptRuntime.enqueuePrompt,
      dequeuePrompt: promptRuntime.dequeuePrompt,
      retryLastPrompt: promptRuntime.retryLastPrompt,
      resolveSecurityContext: securityPolicy.resolveSecurityContext,
      getRuntimeSnapshot: promptRuntime.getRuntimeSnapshot,
      cancelChannelWork: promptRuntime.cancelChannelWork,
      closeRuntimeSession: promptRuntime.closeRuntimeSession,
      compactSession: promptRuntime.compactSession,
      startCodexSideConversation: promptRuntime.startCodexSideConversation,
      closeCodexSideConversation: promptRuntime.closeCodexSideConversation,
      conversationSpawn,
    },
  });
  if (typeof commandSurface.buildWorkspaceBusyPayload === 'function') {
    buildWorkspaceBusyPayload = commandSurface.buildWorkspaceBusyPayload;
  }

  const platformAdapter = assertPlatformAdapter(resolvedPlatformFoundation.createAdapter({
    capabilities: resolvedPlatformCapabilities,
    commandRegistryRenderer,
    commandViewRenderer,
    interactionResponse,
    messageDelivery,
    notificationDelivery,
    conversationSpawn,
    conversationPresentation,
    conversationSecurity,
    textPresentation,
    accessPolicyOptions,
    entryHandlerOptions: {
      ...entryHandlerOptions,
      commandSpecs: commandSurface.commandSpecs,
      getSession: sessionStore.getSession,
      resolveSecurityContext: securityPolicy.resolveSecurityContext,
      handleCommand: commandSurface.handleCommand,
      enqueuePrompt: promptRuntime.enqueuePrompt,
      isWorkspaceBusyComponentId: commandSurface.isWorkspaceBusyComponentId,
      isWorkspaceBrowserComponentId: commandSurface.isWorkspaceBrowserComponentId,
      isOnboardingButtonId: commandSurface.isOnboardingButtonId,
      isSettingsPanelComponentId: commandSurface.isSettingsPanelComponentId,
      isSettingsPanelModalId: commandSurface.isSettingsPanelModalId,
      isGoalModalId: commandSurface.isGoalModalId,
      handleWorkspaceBusyInteraction: commandSurface.handleWorkspaceBusyInteraction,
      handleWorkspaceBrowserInteraction: commandSurface.handleWorkspaceBrowserInteraction,
      handleOnboardingButtonInteraction: commandSurface.handleOnboardingButtonInteraction,
      handleSettingsPanelInteraction: commandSurface.handleSettingsPanelInteraction,
      handleSettingsPanelModalSubmit: commandSurface.handleSettingsPanelModalSubmit,
      handleGoalModalSubmit: commandSurface.handleGoalModalSubmit,
      routeSlashCommand: commandSurface.routeSlashCommand,
      shouldDeferInteraction: (interaction, commandName) => !commandSurface.shouldHandleSlashCommandBeforeDefer?.({ interaction, commandName }),
      normalizeSlashCommandName: commandSurface.normalizeSlashCommandName,
    },
    lifecycleOptions: {
      ...lifecycleOptions,
      cancelAllChannelWork: promptRuntime.cancelAllChannelWork,
    },
    factories: {
      createAccessPolicy: createDiscordAccessPolicyFn,
      createEntryHandlers: createDiscordEntryHandlersFn,
      createLifecycle: createDiscordLifecycleFn,
      createCommandRegistryPolicy: createCapabilityAwareCommandRegistryRendererFn,
      createCommandViewPolicy: createCapabilityAwareCommandViewRendererFn,
      createInteractionResponsePolicy: createCapabilityAwareInteractionResponseFn,
      createEventNormalizerPolicy: createCapabilityAwareInboundEventNormalizerFn,
      createMessageDeliveryPolicy: createCapabilityAwareMessageDeliveryFn,
    },
  }));
  if (platformAdapter.id !== resolvedPlatformFoundation.id) {
    throw new TypeError(
      `Platform adapter id "${platformAdapter.id}" does not match foundation "${resolvedPlatformFoundation.id}".`,
    );
  }
  const {
    commandRegistryRenderer: adapterCommandRegistryRenderer,
    commandViewRenderer: adapterCommandViewRenderer,
    interactionResponse: adapterInteractionResponse,
    conversationSpawn: adapterConversationSpawn,
    conversationPresentation: adapterConversationPresentation,
    conversationSecurity: adapterConversationSecurity,
    textPresentation: adapterTextPresentation,
    eventNormalizer,
    accessPolicy,
    entryHandlers,
    lifecycle,
  } = platformAdapter;
  const singleInstanceLock = createSingleInstanceLockFn(singleInstanceLockOptions);

  return {
    core: {
      identity,
      sessionSettings,
      securityPolicy,
      sessionStore,
      commandActions,
      workspaceRuntime,
    },
    promptRuntime,
    commandSurface,
    commandRegistryRenderer: adapterCommandRegistryRenderer,
    commandViewRenderer: adapterCommandViewRenderer,
    interactionResponse: adapterInteractionResponse,
    messageDelivery: platformAdapter.messageDelivery,
    notificationDelivery: platformAdapter.notificationDelivery,
    conversationSpawn: adapterConversationSpawn,
    conversationPresentation: adapterConversationPresentation,
    conversationSecurity: adapterConversationSecurity,
    textPresentation: adapterTextPresentation,
    eventNormalizer,
    platformFoundation: resolvedPlatformFoundation,
    platformAdapter,
    accessPolicy,
    entryHandlers,
    lifecycle,
    singleInstanceLock,
  };
}

export async function bootApp({
  lifecycle,
  singleInstanceLock,
  reason = 'startup',
} = {}) {
  singleInstanceLock?.acquire?.();
  singleInstanceLock?.setupCleanupHandlers?.();
  lifecycle?.setupProcessSelfHeal?.();
  if (typeof lifecycle?.bootClient === 'function') {
    return lifecycle.bootClient(reason);
  }
  return undefined;
}
