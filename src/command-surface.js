import { createOnboardingFlow } from './onboarding-flow.js';
import { buildCommandSpecs } from './command-spec.js';
import { createReportFormatters } from './report-formatters.js';
import { assertCommandRegistryRenderer } from './platforms/command-registry.js';
import { createSlashCommandRouter } from './slash-command-router.js';
import { createSettingsPanel } from './settings-panel.js';
import { createTextCommandHandler } from './text-command-handler.js';
import { createWorkspaceBusyActions } from './workspace-busy-actions.js';
import { createWorkspaceBrowser } from './workspace-browser.js';
import {
  DEFAULT_CONVERSATION_PRESENTATION,
  assertConversationPresentation,
} from './platforms/conversation-presentation.js';

export function createCommandSurface({
  interactionResponse,
  messageDelivery = null,
  platformCapabilities = null,
  botProvider = null,
  defaultUiLanguage = 'en',
  enableConfigCmd = false,
  commandRegistryRenderer,
  conversationPresentation = DEFAULT_CONVERSATION_PRESENTATION,
  onboardingOptions = {},
  settingsPanelOptions = {},
  reportOptions = {},
  workspaceBrowserOptions = {},
  slashRouterOptions = {},
  textCommandOptions = {},
} = {}) {
  const registryRenderer = assertCommandRegistryRenderer(commandRegistryRenderer);
  const resolvedConversationPresentation = assertConversationPresentation(conversationPresentation);
  const commandSpecs = buildCommandSpecs({
    botProvider,
    conversationPresentation: resolvedConversationPresentation,
  });
  const normalizeSlashCommandName = (name) => registryRenderer.normalizeCommandName(name);
  const slashRef = (base) => registryRenderer.formatCommandReference(base);

  const reports = createReportFormatters({
    ...reportOptions,
    supportsThreads: platformCapabilities?.threads !== false,
    formatUserMention: messageDelivery?.formatUserMention,
    conversationPresentation: resolvedConversationPresentation,
    slashRef,
  });

  const workspaceBrowser = createWorkspaceBrowser({
    ...workspaceBrowserOptions,
    interactionResponse,
    formatWorkspaceUpdateReport: reports.formatWorkspaceUpdateReport,
    formatDefaultWorkspaceUpdateReport: reports.formatDefaultWorkspaceUpdateReport,
  });

  const workspaceBusyActions = createWorkspaceBusyActions({
    ...workspaceBrowserOptions,
    interactionResponse,
    commandActions: workspaceBrowserOptions.commandActions,
    getSessionLanguage: reportOptions.getSessionLanguage,
    getSessionProvider: reportOptions.getSessionProvider,
    getWorkspaceBinding: reportOptions.getWorkspaceBinding,
    resolveChildThreadWorkspaceMode: workspaceBrowserOptions.resolveChildThreadWorkspaceMode,
    setChildThreadWorkspaceMode: workspaceBrowserOptions.setChildThreadWorkspaceMode,
    formatWorkspaceBusyReport: reports.formatWorkspaceBusyReport,
    formatWorkspaceUpdateReport: reports.formatWorkspaceUpdateReport,
    openWorkspaceBrowser: workspaceBrowser.openWorkspaceBrowser,
    slashRef,
  });

  const onboarding = createOnboardingFlow({
    ...onboardingOptions,
    interactionResponse,
    botProvider,
    openWorkspaceBrowser: workspaceBrowser.openWorkspaceBrowser,
    slashRef,
  });

  const settingsPanel = createSettingsPanel({
    ...settingsPanelOptions,
    interactionResponse,
    messageDelivery,
    botProvider,
    defaultUiLanguage,
    openWorkspaceBrowser: workspaceBrowser.openWorkspaceBrowser,
    slashRef,
  });

  const routeSlashCommand = createSlashCommandRouter({
    botProvider,
    defaultUiLanguage,
    slashRef,
    interactionResponse,
    messageDelivery,
    conversationPresentation: resolvedConversationPresentation,
    getModelCatalog: settingsPanelOptions.getModelCatalog,
    ...slashRouterOptions,
    platformCapabilities,
    isOnboardingEnabled: onboarding.isOnboardingEnabled,
    buildOnboardingActionRows: onboarding.buildOnboardingActionRows,
    buildOnboardingView: onboarding.buildOnboardingView,
    formatOnboardingStepReport: onboarding.formatOnboardingStepReport,
    formatOnboardingDisabledMessage: onboarding.formatOnboardingDisabledMessage,
    formatOnboardingConfigReport: onboarding.formatOnboardingConfigReport,
    formatStatusReport: reports.formatStatusReportWithLiveData,
    formatQueueReport: reports.formatQueueReport,
    formatDoctorReport: reports.formatDoctorReport,
    formatWorkspaceReport: reports.formatWorkspaceReport,
    formatWorkspaceSetHelp: reports.formatWorkspaceSetHelp,
    formatWorkspaceUpdateReport: reports.formatWorkspaceUpdateReport,
    formatDefaultWorkspaceSetHelp: reports.formatDefaultWorkspaceSetHelp,
    formatDefaultWorkspaceUpdateReport: reports.formatDefaultWorkspaceUpdateReport,
    formatLanguageConfigReport: reports.formatLanguageConfigReport,
    formatFastModeConfigHelp: reports.formatFastModeConfigHelp,
    formatFastModeConfigReport: reports.formatFastModeConfigReport,
    formatRuntimeModeConfigHelp: reports.formatRuntimeModeConfigHelp,
    formatRuntimeModeConfigReport: reports.formatRuntimeModeConfigReport,
    formatProfileConfigHelp: reports.formatProfileConfigHelp,
    formatProfileConfigReport: reports.formatProfileConfigReport,
    formatTimeoutConfigHelp: reports.formatTimeoutConfigHelp,
    formatTimeoutConfigReport: reports.formatTimeoutConfigReport,
    formatProgressReport: reports.formatProgressReport,
    formatCancelReport: reports.formatCancelReport,
    formatCompactStrategyConfigHelp: reports.formatCompactStrategyConfigHelp,
    formatCompactConfigReport: reports.formatCompactConfigReport,
    formatExtraInfoConfigHelp: reports.formatExtraInfoConfigHelp,
    formatExtraInfoConfigReport: reports.formatExtraInfoConfigReport,
    openWorkspaceBrowser: workspaceBrowser.openWorkspaceBrowser,
    openSettingsPanel: settingsPanel.openSettingsPanel,
    openModelSettingsPanel: settingsPanel.openModelSettingsPanel,
  });

  const handleCommand = createTextCommandHandler({
    botProvider,
    enableConfigCmd,
    ...textCommandOptions,
    platformCapabilities,
    messageDelivery,
    conversationPresentation: resolvedConversationPresentation,
    isOnboardingEnabled: onboarding.isOnboardingEnabled,
    formatHelpReport: reports.formatHelpReport,
    formatStatusReport: reports.formatStatusReportWithLiveData,
    formatQueueReport: reports.formatQueueReport,
    formatDoctorReport: reports.formatDoctorReport,
    formatWorkspaceReport: reports.formatWorkspaceReport,
    formatWorkspaceSetHelp: reports.formatWorkspaceSetHelp,
    formatWorkspaceUpdateReport: reports.formatWorkspaceUpdateReport,
    formatDefaultWorkspaceSetHelp: reports.formatDefaultWorkspaceSetHelp,
    formatDefaultWorkspaceUpdateReport: reports.formatDefaultWorkspaceUpdateReport,
    formatOnboardingConfigHelp: onboarding.formatOnboardingConfigHelp,
    formatOnboardingConfigReport: onboarding.formatOnboardingConfigReport,
    formatOnboardingDisabledMessage: onboarding.formatOnboardingDisabledMessage,
    formatOnboardingReport: onboarding.formatOnboardingReport,
    formatLanguageConfigHelp: reports.formatLanguageConfigHelp,
    formatLanguageConfigReport: reports.formatLanguageConfigReport,
    formatFastModeConfigHelp: reports.formatFastModeConfigHelp,
    formatFastModeConfigReport: reports.formatFastModeConfigReport,
    formatRuntimeModeConfigHelp: reports.formatRuntimeModeConfigHelp,
    formatRuntimeModeConfigReport: reports.formatRuntimeModeConfigReport,
    formatProfileConfigHelp: reports.formatProfileConfigHelp,
    formatProfileConfigReport: reports.formatProfileConfigReport,
    formatTimeoutConfigHelp: reports.formatTimeoutConfigHelp,
    formatTimeoutConfigReport: reports.formatTimeoutConfigReport,
    formatProgressReport: reports.formatProgressReport,
    formatCancelReport: reports.formatCancelReport,
    formatCompactStrategyConfigHelp: reports.formatCompactStrategyConfigHelp,
    formatCompactConfigReport: reports.formatCompactConfigReport,
    formatExtraInfoConfigHelp: reports.formatExtraInfoConfigHelp,
    formatExtraInfoConfigReport: reports.formatExtraInfoConfigReport,
    formatReasoningEffortHelp: reports.formatReasoningEffortHelp,
    parseOnboardingConfigAction: onboarding.parseOnboardingConfigAction,
    openWorkspaceBrowser: workspaceBrowser.openWorkspaceBrowser,
  });

  return {
    formatWorkspaceBusyReport: reports.formatWorkspaceBusyReport,
    buildWorkspaceBusyPayload: workspaceBusyActions.buildWorkspaceBusyPayload,
    handleCommand,
    handleOnboardingButtonInteraction: onboarding.handleOnboardingButtonInteraction,
    handleSettingsPanelInteraction: settingsPanel.handleSettingsPanelInteraction,
    handleSettingsPanelModalSubmit: settingsPanel.handleSettingsPanelModalSubmit,
    handleGoalModalSubmit: routeSlashCommand.handleGoalModalSubmit,
    handleWorkspaceBusyInteraction: workspaceBusyActions.handleWorkspaceBusyInteraction,
    handleWorkspaceBrowserInteraction: workspaceBrowser.handleWorkspaceBrowserInteraction,
    isOnboardingButtonId: onboarding.isOnboardingButtonId,
    isSettingsPanelComponentId: settingsPanel.isSettingsPanelComponentId,
    isSettingsPanelModalId: settingsPanel.isSettingsPanelModalId,
    isGoalModalId: routeSlashCommand.isGoalModalId,
    isWorkspaceBusyComponentId: workspaceBusyActions.isWorkspaceBusyComponentId,
    isWorkspaceBrowserComponentId: workspaceBrowser.isWorkspaceBrowserComponentId,
    normalizeSlashCommandName,
    routeSlashCommand,
    shouldHandleSlashCommandBeforeDefer: routeSlashCommand.shouldHandleBeforeDefer,
    commandSpecs,
    slashRef,
  };
}
