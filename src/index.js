import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { safeChannelSend, safeReply, withDiscordNetworkRetry } from './discord-reply-utils.js';
import { splitForDiscord } from './discord-message-splitter.js';
import { bootApp, createAppContext } from './app-context.js';
import {
  appendProviderSuffix,
  describeBotMode,
  getDefaultSlashPrefix,
  parseOptionalProvider,
  resolveDiscordToken,
  resolveProviderScopedEnv,
} from './bot-instance-utils.js';
import {
  formatCompactConfigUnsupported,
  formatReasoningEffortUnsupported,
  formatWorkspaceSessionPolicy,
  formatWorkspaceSessionResetReason,
  getProviderBinEnvName,
  getProviderCompactCapabilities,
  getProviderDefaultBin,
  getProviderDisplayName,
  getProviderShortName,
  getSupportedReasoningEffortLevels,
  getSupportedCompactStrategies,
  isReasoningEffortSupported,
  normalizeProvider,
  parseProviderInput,
  providerSupportsCompactConfigAction,
  providerSupportsRawConfigOverrides,
} from './provider-metadata.js';
import {
  formatProviderNativeCompactSurface,
  formatProviderRawConfigSurface,
  formatProviderReasoningSurface,
  formatProviderResumeSurface,
  formatProviderSessionTerm,
  formatProviderRuntimeSummary,
  formatProviderSessionLabel,
  formatProviderSessionStoreSurface,
  formatRecentSessionsLookup,
  formatRecentSessionsTitle,
} from './provider-runtime-surface.js';
import {
  buildSpawnEnv,
  createCachedProviderRateLimitReader,
  formatCliHealth,
  getCodexAccountRateLimits,
  getCliHealth as getCliHealthBase,
  getProviderBin as getProviderBinBase,
  isCliNotFound,
} from './provider-runtime.js';
import {
  findLatestClaudeSessionFileBySessionId,
  findLatestRolloutFileBySessionId,
  listRecentSessions as listRecentProviderSessions,
  readAntigravitySessionState,
  readClaudeSessionMetaBySessionId,
  readCodexSessionMetaBySessionId,
  readPiFamilySessionMetaBySessionId,
  resolveAntigravityProjectRootBySessionId,
} from './provider-sessions.js';
import { stopChildProcess } from './channel-runtime.js';
import { loadRuntimeEnv } from './env-loader.js';
import {
  extractRawProgressTextFromEvent as extractRawProgressTextFromEventBase,
} from './progress-utils.js';
import {
  buildProgressEventDedupeKey,
  composeFinalAnswerText,
  createProgressEventDeduper,
  extractAgentMessageText,
  isFinalAnswerLikeAgentMessage,
} from './codex-event-utils.js';
import { ensureDir } from './session-store.js';
import {
  normalizeQueueLimit,
  normalizeSecurityProfile,
  parseConfigAllowlist,
  parseConfigKey,
  parseCsvSet,
  parseOptionalBool,
  resolveProjectUpgradeNotifyChannelIds,
} from './security-policy.js';
import {
  createChildThreadWorkspaceModeStore,
} from './child-thread-workspace-mode.js';
import {
  createProviderDefaultWorkspaceStore,
  resolveConfiguredWorkspaceDir,
  resolvePath,
} from './provider-default-workspace.js';
import {
  createCodexProfileStore,
} from './codex-profile-store.js';
import {
  createReplyDeliveryModeStore,
} from './reply-delivery-mode.js';
import {
  describeCompactStrategy,
  formatLanguageLabel,
  formatReplyDeliveryModeLabel,
  formatSecurityProfileLabel,
  normalizeCompactStrategy,
  normalizeReplyDeliveryMode,
  normalizeSessionCompactEnabled,
  normalizeSessionCompactStrategy,
  normalizeSessionCompactTokenLimit,
  normalizeSessionFastMode,
  normalizeSessionRuntimeMode,
  normalizeSessionSecurityProfile,
  normalizeSessionTimeoutMs,
  normalizeTimeoutMs,
  normalizeUiLanguage,
  parseCompactConfigAction,
  parseCompactConfigFromText,
  parseExtraInfoConfigAction,
  parseExtraInfoConfigFromText,
  parseFastModeAction,
  parseRuntimeModeAction,
  parseReasoningEffortInput,
  parseSecurityProfileInput,
  parseTimeoutConfigAction,
  parseUiLanguageInput,
  parseWorkspaceCommandAction,
} from './session-settings.js';
import {
  normalizeExtraInfoEnabled,
  normalizeExtraInfoTemplate,
} from './extra-info.js';
import { DISCORD_DEFAULT_EXTRA_INFO_TEMPLATE } from './platforms/discord/extra-info.js';
import { createDiscordPlatformFoundation } from './platforms/discord/foundation.js';
import { createLarkPlatformFoundation } from './platforms/lark/foundation.js';
import { createLarkCliChannel } from './lark-cli-channel.js';
import {
  createLarkDenialAcceptanceRecorder,
  resolveLarkDenialAcceptanceStateFile,
} from './lark-denial-acceptance.js';
import {
  createLarkWebhookAcceptanceRecorder,
  resolveLarkWebhookAcceptanceStateFile,
} from './lark-webhook-acceptance.js';
import { installLarkWebhookServer } from './lark-webhook-channel.js';
import { inspectLarkRuntimeConfig } from './lark-runtime-config.js';
import { installLarkSdkBotMenuSupport } from './platforms/lark/bot-menu.js';
import { DEFAULT_EXTRA_INFO_TEMPLATE } from './extra-info.js';
import { buildPromptFromMessage } from './message-input.js';
import {
  appendPlatformInstanceSuffix,
  normalizeBotPlatform,
  normalizePlatformInstanceId,
} from './platform-instance-utils.js';
import {
  parseCommandActionButtonId,
} from './slash-command-router.js';
import * as discordMessageInput from './discord-message-input.js';
import {
  configureRuntimeProxy,
  createDiscordClient,
  ensureDiscordWsProxyPatch,
  normalizeSlashPrefix,
  readAntigravityDefaults,
  readAntigravityModelCatalog,
  readPiFamilyModelCatalog,
  readClaudeDefaults,
  readCodexDefaults,
  readCodexModelCatalog,
  readCodexProfileCatalog,
  readClaudeModelCatalog,
  renderMissingDiscordTokenHint,
  writeAntigravityModelSetting,
  writeCodexDefaults,
} from './runtime-bootstrap.js';
import {
  normalizeDisabledMcpServers,
} from './codex-app-server-args.js';
import {
  clearCodexThreadGoal,
  forkCodexThread,
  getCodexThreadGoal,
  setCodexThreadGoal,
  unsubscribeCodexThread,
} from './codex-app-server.js';
import {
  extractInputTokensFromUsage,
  formatTokenValue,
  humanAge,
  humanElapsed,
  normalizeIntervalMs,
  safeError,
  toInt,
  toOptionalInt,
  truncate,
} from './runtime-utils.js';
import {
  isIgnorableDiscordRuntimeError,
  isRecoverableGatewayCloseCode,
} from './discord-lifecycle.js';
import { createProjectUpgradeManager } from './project-upgrade.js';
import { createProjectUpgradeScheduler } from './project-upgrade-scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const envState = loadRuntimeEnv({ rootDir: ROOT, env: process.env });
const ENV_FILE = envState.writableEnvFile;
const BOT_PROVIDER = parseOptionalProvider(process.env.BOT_PROVIDER);
const BOT_PLATFORM = normalizeBotPlatform(process.env.BOT_PLATFORM || 'discord');
const PLATFORM_INSTANCE_ID = normalizePlatformInstanceId(process.env.BOT_INSTANCE_ID || 'default');
const BOT_MODE = describeBotMode(BOT_PROVIDER);
const DATA_FILE = path.join(DATA_DIR, appendPlatformInstanceSuffix(
  appendProviderSuffix('sessions.json', BOT_PROVIDER),
  { platformId: BOT_PLATFORM, instanceId: PLATFORM_INSTANCE_ID },
));
const LOCK_FILE = path.join(DATA_DIR, appendPlatformInstanceSuffix(
  appendProviderSuffix('bot.lock', BOT_PROVIDER),
  { platformId: BOT_PLATFORM, instanceId: PLATFORM_INSTANCE_ID },
));
const larkDenialAcceptanceRecorder = BOT_PLATFORM === 'lark'
  ? createLarkDenialAcceptanceRecorder({
    stateFile: resolveLarkDenialAcceptanceStateFile({
      dataDir: DATA_DIR,
      instanceId: PLATFORM_INSTANCE_ID,
      botProvider: BOT_PROVIDER,
    }),
  })
  : null;

if (envState.loadedFiles.length) {
  const rendered = envState.loadedFiles
    .map((filePath) => path.relative(ROOT, filePath) || path.basename(filePath))
    .join(' -> ');
  const scoped = envState.appliedProviderScope
    ? ` (applied ${envState.appliedProviderScope.toUpperCase()}__* overrides)`
    : '';
  console.log(`🔧 Loaded env files: ${rendered}${scoped}`);
}

const { logs: proxyLogs, restProxyAgent } = configureRuntimeProxy({
  env: process.env,
  envFilePath: ENV_FILE,
});
if (proxyLogs.length) {
  for (const line of proxyLogs) {
    console.log(line);
  }
}

if (BOT_PLATFORM === 'discord' && globalThis.__discordWsAgent) {
  const wsPatch = ensureDiscordWsProxyPatch({ rootDir: ROOT });
  if (wsPatch.status === 'patched') {
    console.log('🩹 Patched @discordjs/ws for proxy-aware gateway connections');
  } else if (wsPatch.status === 'pattern_missing') {
    console.warn(`⚠️ Could not patch @discordjs/ws automatically: ${wsPatch.targetPath}`);
  }
}

let activeLifecycle = null;
const getActiveDiscordClient = () => activeLifecycle?.getClient?.() ?? null;
const getActiveLarkChannel = () => activeLifecycle?.getClient?.() ?? null;
const safeReplyWithLiveClient = (message, payload, options = {}) => safeReply(message, payload, {
  ...options,
  getActiveClient: getActiveDiscordClient,
});
const safeChannelSendWithLiveClient = (target, payload, options = {}) => safeChannelSend(target, payload, {
  ...options,
  getActiveClient: getActiveDiscordClient,
});

const discord = BOT_PLATFORM === 'discord' ? await import('discord.js') : {};
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  GatewayIntentBits,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  REST,
  Routes,
} = discord;

const DISCORD_TOKEN = BOT_PLATFORM === 'discord'
  ? resolveDiscordToken({ botProvider: BOT_PROVIDER, env: process.env })
  : '';
if (BOT_PLATFORM === 'discord' && !DISCORD_TOKEN) {
  console.error(renderMissingDiscordTokenHint({ botProvider: BOT_PROVIDER, env: process.env }));
  process.exit(1);
}

const LARK_CONFIG_INSPECTION = BOT_PLATFORM === 'lark'
  ? inspectLarkRuntimeConfig({ botProvider: BOT_PROVIDER, env: process.env })
  : null;
if (LARK_CONFIG_INSPECTION?.errors.length) {
  for (const issue of LARK_CONFIG_INSPECTION.errors) console.error(`❌ ${issue}`);
  process.exit(1);
}
if (LARK_CONFIG_INSPECTION?.warnings.length) {
  for (const issue of LARK_CONFIG_INSPECTION.warnings) console.warn(`⚠️ ${issue}`);
}
const LARK_RUNTIME_CONFIG = LARK_CONFIG_INSPECTION?.config || null;
const LARK_APP_ID = LARK_RUNTIME_CONFIG?.appId || '';
const LARK_APP_SECRET = LARK_RUNTIME_CONFIG?.appSecret || '';
const LARK_TRANSPORT = LARK_RUNTIME_CONFIG?.transport || '';
const LARK_WEBHOOK_VERIFICATION_TOKEN = LARK_RUNTIME_CONFIG?.webhook.verificationToken || '';
const LARK_WEBHOOK_ENCRYPT_KEY = LARK_RUNTIME_CONFIG?.webhook.encryptKey || '';
const LARK_WEBHOOK_HOST = LARK_RUNTIME_CONFIG?.webhook.host || '127.0.0.1';
const LARK_WEBHOOK_PORT = LARK_RUNTIME_CONFIG?.webhook.port || 3000;
const LARK_WEBHOOK_PATH = LARK_RUNTIME_CONFIG?.webhook.path || '/lark/events';
const LARK_WEBHOOK_HEALTH_PATH = LARK_RUNTIME_CONFIG?.webhook.healthPath || '/healthz';
const LARK_WEBHOOK_MAX_BODY_BYTES = LARK_RUNTIME_CONFIG?.webhook.maxBodyBytes || 1024 * 1024;
const LARK_WEBHOOK_HEADERS_TIMEOUT_MS = LARK_RUNTIME_CONFIG?.webhook.headersTimeoutMs || 10_000;
const LARK_WEBHOOK_REQUEST_TIMEOUT_MS = LARK_RUNTIME_CONFIG?.webhook.requestTimeoutMs || 15_000;
const LARK_WEBHOOK_KEEP_ALIVE_TIMEOUT_MS = LARK_RUNTIME_CONFIG?.webhook.keepAliveTimeoutMs || 5000;
const LARK_EVENT_DEDUP_WINDOW_MS = LARK_RUNTIME_CONFIG?.safety.eventDedupWindowMs || 12 * 60 * 60_000;
const LARK_EVENT_DEDUP_MAX_ENTRIES = LARK_RUNTIME_CONFIG?.safety.eventDedupMaxEntries || 5000;
const LARK_DOMAIN = LARK_RUNTIME_CONFIG?.domain || 'feishu';
const LARK_CLI_BIN = LARK_RUNTIME_CONFIG?.cliBin || 'lark-cli';
const LARK_CLI_PROFILE = LARK_RUNTIME_CONFIG?.cliProfile || '';
const larkWebhookAcceptanceRecorder = BOT_PLATFORM === 'lark' && LARK_TRANSPORT === 'webhook'
  ? createLarkWebhookAcceptanceRecorder({
    stateFile: resolveLarkWebhookAcceptanceStateFile({
      dataDir: DATA_DIR,
      instanceId: PLATFORM_INSTANCE_ID,
      botProvider: BOT_PROVIDER,
    }),
  })
  : null;

const resolvePlatformScopedEnv = (platformKey, legacyKey = platformKey) => (
  resolveProviderScopedEnv(platformKey, BOT_PROVIDER, process.env)
  || resolveProviderScopedEnv(legacyKey, BOT_PROVIDER, process.env)
);
const ALLOWED_CHANNEL_IDS = parseCsvSet(resolvePlatformScopedEnv(
  BOT_PLATFORM === 'lark' ? 'LARK_ALLOWED_CHAT_IDS' : 'ALLOWED_CHANNEL_IDS',
  'ALLOWED_CHANNEL_IDS',
));
const ALLOWED_GUILD_IDS = parseCsvSet(resolvePlatformScopedEnv(
  BOT_PLATFORM === 'lark' ? 'LARK_ALLOWED_TENANT_IDS' : 'ALLOWED_GUILD_IDS',
  'ALLOWED_GUILD_IDS',
));
const ALLOWED_USER_IDS = parseCsvSet(resolvePlatformScopedEnv(
  BOT_PLATFORM === 'lark' ? 'LARK_ALLOWED_USER_IDS' : 'ALLOWED_USER_IDS',
  'ALLOWED_USER_IDS',
));
const MENTION_ONLY_CHANNEL_IDS = parseCsvSet(resolvePlatformScopedEnv(
  BOT_PLATFORM === 'lark' ? 'LARK_MENTION_ONLY_CHAT_IDS' : 'MENTION_ONLY_CHANNEL_IDS',
  'MENTION_ONLY_CHANNEL_IDS',
));
const SECURITY_PROFILE = normalizeSecurityProfile(process.env.SECURITY_PROFILE || 'auto');
const SECURITY_PROFILE_DEFAULTS = Object.freeze({
  solo: { mentionOnly: false, maxQueuePerChannel: 0 },
  team: { mentionOnly: false, maxQueuePerChannel: 20 },
  public: { mentionOnly: true, maxQueuePerChannel: 20 },
});
const MENTION_ONLY_OVERRIDE = parseOptionalBool(process.env.MENTION_ONLY);
const MENTION_ONLY_ENABLED_GUILD_IDS = parseCsvSet(
  resolveProviderScopedEnv('MENTION_ONLY_ENABLED_GUILD_IDS', BOT_PROVIDER, process.env),
);
const MENTION_ONLY_DISABLED_GUILD_IDS = parseCsvSet(
  resolveProviderScopedEnv('MENTION_ONLY_DISABLED_GUILD_IDS', BOT_PROVIDER, process.env),
);
const MAX_QUEUE_PER_CHANNEL_OVERRIDE = normalizeQueueLimit(process.env.MAX_QUEUE_PER_CHANNEL);
const ENABLE_CONFIG_CMD = String(process.env.ENABLE_CONFIG_CMD || 'false').toLowerCase() === 'true';
const CONFIG_POLICY = parseConfigAllowlist(
  process.env.CONFIG_ALLOWLIST || 'personality,model_reasoning_effort,model_auto_compact_token_limit',
);
const EXTRA_INFO_ENABLED = normalizeExtraInfoEnabled(resolveProviderScopedEnv('EXTRA_INFO_ENABLED', BOT_PROVIDER, process.env));
const EXTRA_INFO_TEXT = normalizeExtraInfoTemplate(resolveProviderScopedEnv('EXTRA_INFO_TEXT', BOT_PROVIDER, process.env))
  || (BOT_PLATFORM === 'discord' ? DISCORD_DEFAULT_EXTRA_INFO_TEMPLATE : DEFAULT_EXTRA_INFO_TEMPLATE);
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.join(ROOT, 'workspaces');
const WORKSPACE_LOCK_ROOT = path.join(DATA_DIR, appendPlatformInstanceSuffix('workspace-locks', {
  platformId: BOT_PLATFORM,
  instanceId: PLATFORM_INSTANCE_ID,
}));
const SHARED_CHILD_THREAD_WORKSPACE_MODE = process.env.CHILD_THREAD_WORKSPACE_MODE;
const PROVIDER_CHILD_THREAD_WORKSPACE_MODE_OVERRIDES = {
  codex: process.env.CODEX__CHILD_THREAD_WORKSPACE_MODE,
  claude: process.env.CLAUDE__CHILD_THREAD_WORKSPACE_MODE,
  antigravity: process.env.ANTIGRAVITY__CHILD_THREAD_WORKSPACE_MODE,
  zcode: process.env.ZCODE__CHILD_THREAD_WORKSPACE_MODE,
};
const {
  resolve: resolveChildThreadWorkspaceMode,
  set: setChildThreadWorkspaceMode,
} = createChildThreadWorkspaceModeStore({
  env: process.env,
  envFilePath: ENV_FILE,
  sharedMode: SHARED_CHILD_THREAD_WORKSPACE_MODE,
  providerModeOverrides: PROVIDER_CHILD_THREAD_WORKSPACE_MODE_OVERRIDES,
});
const SHARED_DEFAULT_WORKSPACE_DIR = resolveConfiguredWorkspaceDir(process.env.DEFAULT_WORKSPACE_DIR);
const PROVIDER_DEFAULT_WORKSPACE_OVERRIDES = {
  codex: resolveConfiguredWorkspaceDir(process.env.CODEX__DEFAULT_WORKSPACE_DIR),
  claude: resolveConfiguredWorkspaceDir(process.env.CLAUDE__DEFAULT_WORKSPACE_DIR),
  antigravity: resolveConfiguredWorkspaceDir(process.env.ANTIGRAVITY__DEFAULT_WORKSPACE_DIR),
  zcode: resolveConfiguredWorkspaceDir(process.env.ZCODE__DEFAULT_WORKSPACE_DIR),
};
const {
  resolve: resolveProviderDefaultWorkspace,
  set: setProviderDefaultWorkspace,
} = createProviderDefaultWorkspaceStore({
  env: process.env,
  envFilePath: ENV_FILE,
  sharedDefaultWorkspaceDir: SHARED_DEFAULT_WORKSPACE_DIR,
  providerDefaultWorkspaceOverrides: PROVIDER_DEFAULT_WORKSPACE_OVERRIDES,
});
const {
  resolve: resolveReplyDeliveryDefault,
  set: setReplyDeliveryDefault,
} = createReplyDeliveryModeStore({
  env: process.env,
  envFilePath: ENV_FILE,
  defaultMode: normalizeReplyDeliveryMode(process.env.DEFAULT_REPLY_DELIVERY_MODE, 'card_mention'),
});
const {
  resolve: resolveDefaultCodexProfile,
  set: setDefaultCodexProfile,
} = createCodexProfileStore({
  env: process.env,
  envFilePath: ENV_FILE,
  defaultProfile: process.env.CODEX__DEFAULT_PROFILE || null,
  readCodexProfileCatalog,
});
const DEFAULT_PROVIDER = BOT_PROVIDER || normalizeProvider(process.env.DEFAULT_PROVIDER || process.env.CLI_PROVIDER || 'codex');
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || null;
const DEFAULT_MODE = (process.env.DEFAULT_MODE || 'safe').toLowerCase() === 'dangerous' ? 'dangerous' : 'safe';
const DEFAULT_UI_LANGUAGE = normalizeUiLanguage(process.env.DEFAULT_UI_LANGUAGE || 'zh');
const ONBOARDING_ENABLED_DEFAULT = parseOptionalBool(process.env.ONBOARDING_ENABLED_DEFAULT);
const ONBOARDING_ENABLED_BY_DEFAULT = ONBOARDING_ENABLED_DEFAULT === null ? true : ONBOARDING_ENABLED_DEFAULT;
const CODEX_TIMEOUT_MS = normalizeTimeoutMs(process.env.CODEX_TIMEOUT_MS, 0);
const TASK_MAX_ATTEMPTS = Math.max(1, toInt(process.env.TASK_MAX_ATTEMPTS, 3));
const TASK_RETRY_BASE_DELAY_MS = Math.max(0, toInt(process.env.TASK_RETRY_BASE_DELAY_MS, 1000));
const TASK_RETRY_MAX_DELAY_MS = Math.max(
  TASK_RETRY_BASE_DELAY_MS,
  toInt(process.env.TASK_RETRY_MAX_DELAY_MS, 8000),
);
const CODEX_BIN = (process.env.CODEX_BIN || 'codex').trim() || 'codex';
const CLAUDE_BIN = (process.env.CLAUDE_BIN || 'claude').trim() || 'claude';
const ANTIGRAVITY_BIN = (process.env.ANTIGRAVITY_BIN || 'agy').trim() || 'agy';
const ZCODE_BIN = (process.env.ZCODE_BIN || 'zcode').trim() || 'zcode';
const PI_BIN = (process.env.PI_BIN || 'pi').trim() || 'pi';
const OMP_BIN = (process.env.OMP_BIN || 'omp').trim() || 'omp';
const SHOW_REASONING = String(process.env.SHOW_REASONING || 'false').toLowerCase() === 'true';
const DEBUG_EVENTS = String(process.env.DEBUG_EVENTS || 'false').toLowerCase() === 'true';
const PROGRESS_UPDATES_ENABLED = String(process.env.PROGRESS_UPDATES_ENABLED || 'true').toLowerCase() !== 'false';
const PROGRESS_UPDATE_INTERVAL_MS = normalizeIntervalMs(process.env.PROGRESS_UPDATE_INTERVAL_MS, 15000, 3000);
const PROGRESS_EVENT_FLUSH_MS = normalizeIntervalMs(process.env.PROGRESS_EVENT_FLUSH_MS, 5000, 1000);
const PROGRESS_TEXT_PREVIEW_CHARS = Math.max(60, toInt(process.env.PROGRESS_TEXT_PREVIEW_CHARS, 140));
const PROGRESS_INCLUDE_STDOUT = String(process.env.PROGRESS_INCLUDE_STDOUT || 'true').toLowerCase() !== 'false';
const PROGRESS_INCLUDE_STDERR = String(process.env.PROGRESS_INCLUDE_STDERR || 'false').toLowerCase() === 'true';
const PROGRESS_PLAN_MAX_LINES = Math.min(8, Math.max(1, toInt(process.env.PROGRESS_PLAN_MAX_LINES, 4)));
const PROGRESS_DONE_STEPS_MAX = Math.min(12, Math.max(1, toInt(process.env.PROGRESS_DONE_STEPS_MAX, 4)));
const PROGRESS_ACTIVITY_MAX_LINES = Math.min(12, Math.max(1, toInt(process.env.PROGRESS_ACTIVITY_MAX_LINES, 4)));
const PROGRESS_EVENT_DEDUPE_WINDOW_MS = normalizeIntervalMs(
  process.env.PROGRESS_EVENT_DEDUPE_WINDOW_MS,
  2500,
  200,
);
const PROGRESS_PROCESS_LINES = 2;
const PROGRESS_PROCESS_PUSH_INTERVAL_MS = normalizeIntervalMs(
  process.env.PROGRESS_PROCESS_PUSH_INTERVAL_MS,
  1100,
  300,
);
const PROGRESS_MESSAGE_MAX_CHARS = Math.max(600, toInt(process.env.PROGRESS_MESSAGE_MAX_CHARS, 1800));
const SELF_HEAL_ENABLED = String(process.env.SELF_HEAL_ENABLED || 'true').toLowerCase() !== 'false';
const SELF_HEAL_RESTART_DELAY_MS = toInt(process.env.SELF_HEAL_RESTART_DELAY_MS, 5000);
const SELF_HEAL_MAX_LOGIN_BACKOFF_MS = toInt(process.env.SELF_HEAL_MAX_LOGIN_BACKOFF_MS, 60000);
const LEGACY_MAX_INPUT_TOKENS_BEFORE_RESET = toOptionalInt(process.env.MAX_INPUT_TOKENS_BEFORE_RESET);
const MAX_INPUT_TOKENS_BEFORE_COMPACT = toInt(
  process.env.MAX_INPUT_TOKENS_BEFORE_COMPACT,
  Number.isFinite(LEGACY_MAX_INPUT_TOKENS_BEFORE_RESET) ? LEGACY_MAX_INPUT_TOKENS_BEFORE_RESET : 250000,
);
const COMPACT_STRATEGY = normalizeCompactStrategy(process.env.COMPACT_STRATEGY || 'native');
const COMPACT_ON_THRESHOLD = String(process.env.COMPACT_ON_THRESHOLD || 'true').toLowerCase() !== 'false';
const MODEL_AUTO_COMPACT_TOKEN_LIMIT = toInt(
  process.env.MODEL_AUTO_COMPACT_TOKEN_LIMIT,
  MAX_INPUT_TOKENS_BEFORE_COMPACT,
);
const CLAUDE_RUNTIME_MODE = normalizeSessionRuntimeMode(
  process.env.CLAUDE__RUNTIME_MODE || process.env.CLAUDE_RUNTIME_MODE || 'normal',
) || 'normal';
const CODEX_RUNTIME_MODE = normalizeSessionRuntimeMode(
  process.env.CODEX__RUNTIME_MODE || process.env.CODEX_RUNTIME_MODE || 'normal',
) || 'normal';
const CLAUDE_LONG_IDLE_MS = normalizeIntervalMs(
  process.env.CLAUDE__LONG_IDLE_MS || process.env.CLAUDE_LONG_IDLE_MS,
  15 * 60_000,
  1000,
);
const CLAUDE_LONG_MAX_SESSIONS = Math.max(
  1,
  toInt(process.env.CLAUDE__LONG_MAX_SESSIONS || process.env.CLAUDE_LONG_MAX_SESSIONS, 8),
);
const CODEX_APP_SERVER_IDLE_MS = normalizeIntervalMs(
  process.env.CODEX__APP_SERVER_IDLE_MS || process.env.CODEX_APP_SERVER_IDLE_MS,
  15 * 60_000,
  1000,
);
const CODEX_APP_SERVER_MAX_SESSIONS = Math.max(
  1,
  toInt(process.env.CODEX__APP_SERVER_MAX_SESSIONS || process.env.CODEX_APP_SERVER_MAX_SESSIONS, 8),
);
const CODEX_APP_SERVER_DISABLED_MCP_SERVERS = normalizeDisabledMcpServers(
  process.env.CODEX__APP_SERVER_DISABLED_MCP_SERVERS
    || process.env.CODEX_APP_SERVER_DISABLED_MCP_SERVERS
    || '',
);
const PROJECT_UPGRADE_CHECK_INTERVAL_MS = normalizeIntervalMs(
  process.env.AGENTS_IN_DISCORD_UPGRADE_CHECK_INTERVAL_MS,
  6 * 60 * 60_000,
  60_000,
);
const PROJECT_UPGRADE_INITIAL_DELAY_MS = normalizeIntervalMs(
  process.env.AGENTS_IN_DISCORD_UPGRADE_INITIAL_DELAY_MS,
  30_000,
  1000,
);
const PROJECT_UPGRADE_NOTIFY_CHANNEL_IDS = resolveProjectUpgradeNotifyChannelIds({
  upgradeNotifyChannelIds: process.env.AGENTS_IN_DISCORD_UPGRADE_NOTIFY_CHANNEL_IDS,
  allowedChannelIds: ALLOWED_CHANNEL_IDS,
});
const PROJECT_UPGRADE_ADMIN_USER_IDS = parseCsvSet(
  process.env.AGENTS_IN_DISCORD_UPGRADE_ADMIN_USER_IDS || '',
);
const PROJECT_UPGRADE_RESTART_TARGET = String(
  process.env.AGENTS_IN_DISCORD_UPGRADE_RESTART_TARGET || 'all',
).trim() || 'all';
const PROJECT_UPGRADE_RESTART_COMMAND = process.env.AGENTS_IN_DISCORD_UPGRADE_RESTART_COMMAND
  || (BOT_PLATFORM !== 'discord'
    ? ''
    : process.platform === 'win32'
    ? ''
    : `scripts/restart-discord-bot-service.sh ${PROJECT_UPGRADE_RESTART_TARGET}`);
const SLASH_PREFIX = normalizeSlashPrefix(process.env.SLASH_PREFIX || getDefaultSlashPrefix(BOT_PROVIDER));
const SPAWN_ENV = buildSpawnEnv(process.env);
const getProviderBin = (provider) => getProviderBinBase(provider, {
  codexBin: CODEX_BIN,
  claudeBin: CLAUDE_BIN,
  antigravityBin: ANTIGRAVITY_BIN,
  zcodeBin: ZCODE_BIN,
  piBin: PI_BIN,
  ompBin: OMP_BIN,
});
const getCliHealth = (provider = DEFAULT_PROVIDER) => getCliHealthBase(provider, {
  codexBin: CODEX_BIN,
  claudeBin: CLAUDE_BIN,
  antigravityBin: ANTIGRAVITY_BIN,
  zcodeBin: ZCODE_BIN,
  piBin: PI_BIN,
  ompBin: OMP_BIN,
  spawnEnv: SPAWN_ENV,
  safeError,
});
const getProviderRateLimits = createCachedProviderRateLimitReader({
  readRateLimits: (provider = DEFAULT_PROVIDER) => getCodexAccountRateLimits(provider, {
    codexBin: CODEX_BIN,
    spawnEnv: SPAWN_ENV,
    safeError,
  }),
});
const projectUpgradeManager = createProjectUpgradeManager({
  projectRoot: ROOT,
  env: process.env,
  envFilePath: ENV_FILE,
  restartCommand: PROJECT_UPGRADE_RESTART_COMMAND,
});
const canManageProjectUpgrade = (userId) => (
  PROJECT_UPGRADE_ADMIN_USER_IDS.size > 0
  && PROJECT_UPGRADE_ADMIN_USER_IDS.has(String(userId || '').trim())
);
const getProjectUpgradeStatus = (options = {}) => (
  projectUpgradeManager.getCachedStatus({
    refresh: Boolean(options.refresh),
    maxAgeMs: PROJECT_UPGRADE_CHECK_INTERVAL_MS,
  })
);

ensureDir(DATA_DIR);
ensureDir(WORKSPACE_ROOT);

const bootCliHealth = getCliHealth(DEFAULT_PROVIDER);
if (bootCliHealth.ok) {
  console.log(`🧩 ${getProviderDisplayName(DEFAULT_PROVIDER)} CLI: ${bootCliHealth.version} via ${bootCliHealth.bin}`);
} else {
  console.warn([
    `⚠️ ${getProviderDisplayName(DEFAULT_PROVIDER)} CLI 不可用，后续请求会失败。`,
    `• provider: ${DEFAULT_PROVIDER}`,
    `• bin: ${bootCliHealth.bin}`,
    `• reason: ${bootCliHealth.error}`,
    `• 处理: 安装 ${getProviderDisplayName(DEFAULT_PROVIDER)} CLI，或在 .env 里设置 ${getProviderBinEnvName(DEFAULT_PROVIDER)}=/绝对路径/${getProviderDefaultBin(DEFAULT_PROVIDER)}，然后重启 bot。`,
  ].join('\n'));
}

const larkSdk = BOT_PLATFORM === 'lark' && ['sdk', 'webhook'].includes(LARK_TRANSPORT)
  ? await import('@larksuiteoapi/node-sdk')
  : null;
const createDiscordClientInstance = () => createDiscordClient({
  Client,
  GatewayIntentBits,
  Partials,
  restProxyAgent,
});
const createLarkClientInstance = () => {
  if (LARK_TRANSPORT === 'cli') {
    return createLarkCliChannel({
      cliBin: LARK_CLI_BIN,
      profile: LARK_CLI_PROFILE,
      cwd: ROOT,
      env: process.env,
      logger: console,
      handshakeTimeoutMs: LARK_RUNTIME_CONFIG.safety.handshakeTimeoutMs,
    });
  }
  let channel = installLarkSdkBotMenuSupport(larkSdk.createLarkChannel({
    appId: LARK_APP_ID,
    appSecret: LARK_APP_SECRET,
    transport: LARK_TRANSPORT === 'webhook' ? 'webhook' : 'websocket',
    webhook: LARK_TRANSPORT === 'webhook' ? {
      verificationToken: LARK_WEBHOOK_VERIFICATION_TOKEN,
      encryptKey: LARK_WEBHOOK_ENCRYPT_KEY || undefined,
    } : undefined,
    domain: LARK_DOMAIN === 'lark' ? larkSdk.Domain.Lark : larkSdk.Domain.Feishu,
    loggerLevel: larkSdk.LoggerLevel.info,
    logger: console,
    source: 'agents-in-discord',
    includeRawEvent: true,
    handshakeTimeoutMs: LARK_RUNTIME_CONFIG.safety.handshakeTimeoutMs,
    policy: {
      dmMode: 'open',
      requireMention: false,
      respondToMentionAll: false,
    },
    safety: {
      chatQueue: { enabled: true },
      staleMessageWindowMs: LARK_RUNTIME_CONFIG.safety.staleMessageWindowMs,
      dedup: {
        ttl: LARK_EVENT_DEDUP_WINDOW_MS,
        maxEntries: LARK_EVENT_DEDUP_MAX_ENTRIES,
      },
    },
    outbound: {
      textChunkLimit: LARK_RUNTIME_CONFIG.outbound.textChunkLimit,
      retry: {
        maxAttempts: LARK_RUNTIME_CONFIG.outbound.sendMaxAttempts,
        baseDelayMs: LARK_RUNTIME_CONFIG.outbound.sendRetryBaseDelayMs,
      },
    },
  }));
  if (LARK_TRANSPORT === 'webhook') {
    channel = installLarkWebhookServer(channel, {
      host: LARK_WEBHOOK_HOST,
      port: LARK_WEBHOOK_PORT,
      path: LARK_WEBHOOK_PATH,
      healthPath: LARK_WEBHOOK_HEALTH_PATH,
      maxBodyBytes: LARK_WEBHOOK_MAX_BODY_BYTES,
      headersTimeoutMs: LARK_WEBHOOK_HEADERS_TIMEOUT_MS,
      requestTimeoutMs: LARK_WEBHOOK_REQUEST_TIMEOUT_MS,
      keepAliveTimeoutMs: LARK_WEBHOOK_KEEP_ALIVE_TIMEOUT_MS,
      generateChallenge: larkSdk.generateChallenge,
      onVerifiedRequest: larkWebhookAcceptanceRecorder?.recordVerifiedRequest,
      logger: console,
    });
  }
  return channel;
};
const createClient = BOT_PLATFORM === 'lark'
  ? createLarkClientInstance
  : createDiscordClientInstance;

let platformFoundation;
if (BOT_PLATFORM === 'lark') {
  platformFoundation = createLarkPlatformFoundation({
    commandRegistryRendererOptions: { slashPrefix: SLASH_PREFIX },
    eventNormalizerOptions: { getChannel: getActiveLarkChannel },
    messageDeliveryOptions: {
      getChannel: getActiveLarkChannel,
      textChunkLimit: LARK_RUNTIME_CONFIG.outbound.textChunkLimit,
    },
    notificationDeliveryOptions: { getChannel: getActiveLarkChannel },
    conversationSpawnOptions: { getChannel: getActiveLarkChannel },
  });
} else {
  platformFoundation = createDiscordPlatformFoundation({
    commandRegistryRendererOptions: {
      SlashCommandBuilder,
      slashPrefix: SLASH_PREFIX,
    },
    commandViewRendererOptions: {
      ActionRowBuilder,
      ButtonBuilder,
      ButtonStyle,
      StringSelectMenuBuilder,
      ModalBuilder,
      TextInputBuilder,
      TextInputStyle,
    },
    messageDeliveryOptions: {
      reply: safeReplyWithLiveClient,
      send: safeChannelSendWithLiveClient,
      splitText: splitForDiscord,
    },
    notificationDeliveryOptions: {
      getClient: getActiveDiscordClient,
    },
    interactionResponseOptions: {
      logger: console,
      withDiscordNetworkRetry,
    },
    conversationSecurityOptions: {
      permissionFlagsBits: PermissionFlagsBits,
    },
  });
}
const safeReplyForActivePlatform = (target, payload) => platformFoundation.messageDelivery.reply(target, payload);
const safeSendForActivePlatform = (target, payload) => platformFoundation.messageDelivery.send(target, payload);
const appContext = createAppContext({
  platformFoundation,
  identityOptions: {
    defaultProvider: DEFAULT_PROVIDER,
  },
  sessionSettingsOptions: {
    defaultUiLanguage: DEFAULT_UI_LANGUAGE,
    securityProfile: SECURITY_PROFILE,
    codexTimeoutMs: CODEX_TIMEOUT_MS,
    taskMaxAttempts: TASK_MAX_ATTEMPTS,
    taskRetryBaseDelayMs: TASK_RETRY_BASE_DELAY_MS,
    taskRetryMaxDelayMs: TASK_RETRY_MAX_DELAY_MS,
    compactStrategy: COMPACT_STRATEGY,
    claudeRuntimeMode: CLAUDE_RUNTIME_MODE,
    codexRuntimeMode: CODEX_RUNTIME_MODE,
    compactOnThreshold: COMPACT_ON_THRESHOLD,
    maxInputTokensBeforeCompact: MAX_INPUT_TOKENS_BEFORE_COMPACT,
    modelAutoCompactTokenLimit: MODEL_AUTO_COMPACT_TOKEN_LIMIT,
    defaultReplyDeliveryMode: resolveReplyDeliveryDefault().mode,
    readDefaultReplyDeliveryMode: () => resolveReplyDeliveryDefault().mode,
    defaultExtraInfoEnabled: EXTRA_INFO_ENABLED === null ? true : EXTRA_INFO_ENABLED,
    defaultExtraInfoText: EXTRA_INFO_TEXT,
    defaultCodexProfile: resolveDefaultCodexProfile().profile,
    readDefaultCodexProfile: resolveDefaultCodexProfile,
    defaultModel: DEFAULT_MODEL,
    readCodexDefaults,
    readClaudeDefaults: () => readClaudeDefaults({ env: SPAWN_ENV }),
    readAntigravityDefaults: () => readAntigravityDefaults({ env: SPAWN_ENV }),
    readCodexProfileCatalog,
    normalizeProvider,
    getSupportedCompactStrategies,
  },
  securityPolicyOptions: {
    securityProfile: SECURITY_PROFILE,
    securityProfileDefaults: SECURITY_PROFILE_DEFAULTS,
    mentionOnlyOverride: MENTION_ONLY_OVERRIDE,
    mentionOnlyEnabledGuildIds: MENTION_ONLY_ENABLED_GUILD_IDS,
    mentionOnlyDisabledGuildIds: MENTION_ONLY_DISABLED_GUILD_IDS,
    mentionOnlyChannelIds: MENTION_ONLY_CHANNEL_IDS,
    maxQueuePerChannelOverride: MAX_QUEUE_PER_CHANNEL_OVERRIDE,
    enableConfigCmd: ENABLE_CONFIG_CMD,
    configPolicy: CONFIG_POLICY,
    permissionFlagsBits: PermissionFlagsBits,
  },
  sessionStoreOptions: {
    dataFile: DATA_FILE,
    workspaceRoot: WORKSPACE_ROOT,
    resolveChildThreadWorkspaceMode: (provider) => resolveChildThreadWorkspaceMode(provider).mode,
    botProvider: BOT_PROVIDER,
    defaults: {
      provider: DEFAULT_PROVIDER,
      mode: DEFAULT_MODE,
      language: DEFAULT_UI_LANGUAGE,
      onboardingEnabled: ONBOARDING_ENABLED_BY_DEFAULT,
    },
    normalizeProvider,
    normalizeUiLanguage,
    normalizeSessionSecurityProfile,
    normalizeSessionFastMode,
    normalizeSessionTimeoutMs,
    normalizeSessionCompactStrategy,
    normalizeSessionCompactEnabled,
    normalizeSessionCompactTokenLimit,
    normalizeExtraInfoEnabled,
    normalizeExtraInfoText: normalizeExtraInfoTemplate,
    normalizeReplyDeliveryMode,
    resolveDefaultWorkspace: resolveProviderDefaultWorkspace,
    resolveSessionWorkspace: (provider, sessionId) => {
      if (provider === 'codex') return readCodexSessionMetaBySessionId(sessionId)?.cwd || null;
      if (provider === 'claude') return readClaudeSessionMetaBySessionId(sessionId)?.cwd || null;
      if (provider === 'antigravity') return resolveAntigravityProjectRootBySessionId(sessionId) || null;
      if (provider === 'pi' || provider === 'omp') {
        return readPiFamilySessionMetaBySessionId(provider, sessionId)?.cwd || null;
      }
      return null;
    },
  },
  commandActionsOptions: {
    normalizeProvider,
    normalizeUiLanguage,
    readCodexDefaults,
    writeCodexDefaults,
    readCodexSessionMetaBySessionId,
    readClaudeSessionMetaBySessionId,
    readPiFamilySessionMetaBySessionId,
    resolveAntigravityProjectRootBySessionId,
    formatProviderSessionLabel,
    formatRecentSessionsTitle,
    formatRecentSessionsLookup,
    resolveProviderDefaultWorkspace,
    setProviderDefaultWorkspace,
    resolveDefaultCodexProfile,
    setDefaultCodexProfile,
    resolveReplyDeliveryDefault,
    setReplyDeliveryDefault,
    readCodexProfileCatalog,
    getProviderShortName,
    listRecentSessions: ({ provider = DEFAULT_PROVIDER, workspaceDir = '', limit = 10 } = {}) => listRecentProviderSessions({
      provider,
      workspaceDir,
      limit,
    }),
    humanAge,
  },
  workspaceRuntimeOptions: {
    lockRoot: WORKSPACE_LOCK_ROOT,
    ensureDir,
  },
  promptRuntimeOptions: {
    runtimePresentationOptions: {
      showReasoning: SHOW_REASONING,
      progressTextPreviewChars: PROGRESS_TEXT_PREVIEW_CHARS,
      progressDoneStepsMax: PROGRESS_DONE_STEPS_MAX,
      progressActivityMaxLines: PROGRESS_ACTIVITY_MAX_LINES,
      progressProcessLines: PROGRESS_PROCESS_LINES,
      humanAge,
    },
    channelRuntimeStoreOptions: {
      truncate,
    },
    sessionProgressBridgeOptions: {
      normalizeProvider,
      extractRawProgressTextFromEvent: extractRawProgressTextFromEventBase,
      findLatestRolloutFileBySessionId,
      findLatestClaudeSessionFileBySessionId,
    },
    runnerExecutorOptions: {
      debugEvents: DEBUG_EVENTS,
      spawnEnv: SPAWN_ENV,
      defaultTimeoutMs: CODEX_TIMEOUT_MS,
      defaultModel: DEFAULT_MODEL,
      claudeLongIdleMs: CLAUDE_LONG_IDLE_MS,
      claudeLongMaxSessions: CLAUDE_LONG_MAX_SESSIONS,
      codexAppServerIdleMs: CODEX_APP_SERVER_IDLE_MS,
      codexAppServerMaxSessions: CODEX_APP_SERVER_MAX_SESSIONS,
      codexAppServerDisabledMcpServers: CODEX_APP_SERVER_DISABLED_MCP_SERVERS,
      ensureDir,
      normalizeProvider,
      getProviderBin,
      getProviderDefaultWorkspace: resolveProviderDefaultWorkspace,
      normalizeTimeoutMs,
      safeError,
      stopChildProcess,
      extractAgentMessageText,
      isFinalAnswerLikeAgentMessage,
      readAntigravitySessionState,
      applyProviderModelSetting: ({ provider, modelSetting }) => {
        if (normalizeProvider(provider) !== 'antigravity') return null;
        return writeAntigravityModelSetting({
          env: SPAWN_ENV,
          model: modelSetting?.value,
        });
      },
      getCodexThreadGoal: (options) => getCodexThreadGoal({
        ...options,
        codexBin: CODEX_BIN,
        env: SPAWN_ENV,
        disabledMcpServers: CODEX_APP_SERVER_DISABLED_MCP_SERVERS,
      }),
      unsubscribeCodexThread: (options) => unsubscribeCodexThread({
        ...options,
        codexBin: CODEX_BIN,
        env: SPAWN_ENV,
        disabledMcpServers: CODEX_APP_SERVER_DISABLED_MCP_SERVERS,
      }),
    },
    promptOrchestratorOptions: {
      defaultUiLanguage: DEFAULT_UI_LANGUAGE,
      progressUpdatesEnabled: PROGRESS_UPDATES_ENABLED,
      progressProcessLines: PROGRESS_PROCESS_LINES,
      progressUpdateIntervalMs: PROGRESS_UPDATE_INTERVAL_MS,
      progressEventFlushMs: PROGRESS_EVENT_FLUSH_MS,
      progressEventDedupeWindowMs: PROGRESS_EVENT_DEDUPE_WINDOW_MS,
      progressIncludeStdout: PROGRESS_INCLUDE_STDOUT,
      progressIncludeStderr: PROGRESS_INCLUDE_STDERR,
      progressTextPreviewChars: PROGRESS_TEXT_PREVIEW_CHARS,
      progressProcessPushIntervalMs: PROGRESS_PROCESS_PUSH_INTERVAL_MS,
      progressMessageMaxChars: PROGRESS_MESSAGE_MAX_CHARS,
      progressPlanMaxLines: PROGRESS_PLAN_MAX_LINES,
      progressDoneStepsMax: PROGRESS_DONE_STEPS_MAX,
      showReasoning: SHOW_REASONING,
      resultChunkChars: BOT_PLATFORM === 'lark' ? 4000 : 1900,
      safeReply: safeReplyForActivePlatform,
      safeChannelSend: safeSendForActivePlatform,
      withDiscordNetworkRetry,
      splitForDiscord,
      normalizeUiLanguage,
      getProviderDisplayName,
      getProviderShortName,
      formatProviderSessionTerm,
      getProviderDefaultBin,
      getProviderBinEnvName,
      stopChildProcess,
      isCliNotFound,
      safeError,
      truncate,
      toOptionalInt,
      humanElapsed,
      createProgressEventDeduper,
      buildProgressEventDedupeKey,
      extractInputTokensFromUsage,
      composeFinalAnswerText,
    },
    channelQueueOptions: {
      safeReply: safeReplyForActivePlatform,
      safeError,
    },
  },
  commandSurfaceOptions: {
    botProvider: BOT_PROVIDER,
    defaultUiLanguage: DEFAULT_UI_LANGUAGE,
    enableConfigCmd: ENABLE_CONFIG_CMD,
    onboardingOptions: {
      onboardingEnabledByDefault: ONBOARDING_ENABLED_BY_DEFAULT,
      defaultUiLanguage: DEFAULT_UI_LANGUAGE,
      onboardingTotalSteps: 4,
      workspaceRoot: WORKSPACE_ROOT,
      allowedChannelIds: ALLOWED_CHANNEL_IDS,
      allowedGuildIds: ALLOWED_GUILD_IDS,
      allowedUserIds: ALLOWED_USER_IDS,
      getCliHealth,
      normalizeUiLanguage,
      getProviderDisplayName,
      formatCliHealth,
      formatLanguageLabel,
      formatSecurityProfileLabel,
      parseUiLanguageInput,
      parseSecurityProfileInput,
      parseTimeoutConfigAction,
    },
    settingsPanelOptions: {
      getProviderDisplayName,
      getSupportedReasoningEffortLevels,
      getModelCatalog: (provider) => {
        if (provider === 'codex') return readCodexModelCatalog({ codexBin: CODEX_BIN, env: SPAWN_ENV });
        if (provider === 'claude') return readClaudeModelCatalog({ claudeBin: CLAUDE_BIN, env: SPAWN_ENV });
        if (normalizeProvider(provider) === 'antigravity') return readAntigravityModelCatalog({ env: SPAWN_ENV });
        const normalizedProvider = normalizeProvider(provider);
        if (normalizedProvider === 'pi' || normalizedProvider === 'omp') {
          return readPiFamilyModelCatalog({
            provider: normalizedProvider,
            bin: normalizedProvider === 'pi' ? PI_BIN : OMP_BIN,
            env: SPAWN_ENV,
          });
        }
        return { models: [], error: null };
      },
      getProviderCompactCapabilities,
      normalizeUiLanguage,
    },
    reportOptions: {
      botProvider: BOT_PROVIDER,
      allowedChannelIds: ALLOWED_CHANNEL_IDS,
      allowedGuildIds: ALLOWED_GUILD_IDS,
      allowedUserIds: ALLOWED_USER_IDS,
      ...(BOT_PLATFORM === 'lark' ? {
        allowedChannelIdsLabel: 'LARK_ALLOWED_CHAT_IDS',
        allowedGuildIdsLabel: 'LARK_ALLOWED_TENANT_IDS',
        allowedUserIdsLabel: 'LARK_ALLOWED_USER_IDS',
        allChannelsLabel: '(all chats)',
        allGuildsLabel: '(all tenants)',
      } : {}),
      progressProcessLines: PROGRESS_PROCESS_LINES,
      progressPlanMaxLines: PROGRESS_PLAN_MAX_LINES,
      progressDoneStepsMax: PROGRESS_DONE_STEPS_MAX,
      normalizeUiLanguage,
      getProviderDisplayName,
      getProviderShortName,
      getProviderCompactCapabilities,
      providerSupportsRawConfigOverrides,
      formatProviderSessionTerm,
      formatProviderRuntimeSummary,
      formatProviderSessionStoreSurface,
      formatProviderResumeSurface,
      formatProviderNativeCompactSurface,
      formatProviderRawConfigSurface,
      formatProviderReasoningSurface,
      getSupportedReasoningEffortLevels,
      getCliHealth,
      getProviderRateLimits,
      getProjectUpgradeStatus,
      getCodexThreadGoal: (options) => getCodexThreadGoal({ ...options, codexBin: CODEX_BIN, env: SPAWN_ENV }),
      formatCliHealth,
      formatLanguageLabel,
      formatSecurityProfileLabel,
      describeCompactStrategy,
      formatWorkspaceSessionPolicy,
      formatWorkspaceSessionResetReason,
      humanAge,
      formatTokenValue,
      truncate,
    },
    workspaceBrowserOptions: {
      ensureDir,
      workspaceRoot: WORKSPACE_ROOT,
      resolveProviderDefaultWorkspace,
      resolveChildThreadWorkspaceMode,
      setChildThreadWorkspaceMode,
      logger: console,
    },
    slashRouterOptions: {
      getProviderDisplayName,
      formatProviderSessionLabel,
      isReasoningEffortSupported,
      providerSupportsCompactConfigAction,
      formatCompactConfigUnsupported,
      formatReasoningEffortUnsupported,
      normalizeProvider,
      parseWorkspaceCommandAction,
      parseUiLanguageInput,
      parseFastModeAction,
      parseRuntimeModeAction,
      parseSecurityProfileInput,
      parseTimeoutConfigAction,
      parseCompactConfigAction,
      parseExtraInfoConfigAction,
      getProjectUpgradeStatus: (options = {}) => projectUpgradeManager.getCachedStatus({ refresh: options.fetch !== false }),
      setProjectUpgradeMode: projectUpgradeManager.setMode,
      canManageProjectUpgrade,
      applyProjectUpgrade: () => projectUpgradeManager.apply({
        restart: false,
        requireIdle: () => {
          const busy = appContext.promptRuntime.getAllRuntimeSnapshots()
            .find((item) => item.running || Number(item.queued || 0) > 0);
          return busy
            ? { ok: false, error: `bot has running or queued work in ${busy.key}` }
            : { ok: true };
        },
      }),
      requestProjectUpgradeRestart: () => projectUpgradeManager.requestRestart(),
      resolvePath,
      forkCodexThread: (options) => forkCodexThread({
        ...options,
        codexBin: CODEX_BIN,
        env: SPAWN_ENV,
        disabledMcpServers: CODEX_APP_SERVER_DISABLED_MCP_SERVERS,
      }),
      resolveForkWorkspace: ({ provider, parentSessionId } = {}) => (
        normalizeProvider(provider) === 'claude'
          ? readClaudeSessionMetaBySessionId(parentSessionId)?.cwd
          : null
      ),
      getCodexThreadGoal: (options) => getCodexThreadGoal({
        ...options,
        codexBin: CODEX_BIN,
        env: SPAWN_ENV,
        disabledMcpServers: CODEX_APP_SERVER_DISABLED_MCP_SERVERS,
      }),
      setCodexThreadGoal: (options) => setCodexThreadGoal({
        ...options,
        codexBin: CODEX_BIN,
        env: SPAWN_ENV,
        disabledMcpServers: CODEX_APP_SERVER_DISABLED_MCP_SERVERS,
      }),
      clearCodexThreadGoal: (options) => clearCodexThreadGoal({
        ...options,
        codexBin: CODEX_BIN,
        env: SPAWN_ENV,
        disabledMcpServers: CODEX_APP_SERVER_DISABLED_MCP_SERVERS,
      }),
      safeError,
    },
    textCommandOptions: {
      getProviderDisplayName,
      getProviderShortName,
      safeReply: safeReplyForActivePlatform,
      formatProviderSessionLabel,
      providerSupportsRawConfigOverrides,
      formatProviderRawConfigSurface,
      providerSupportsCompactConfigAction,
      formatCompactConfigUnsupported,
      formatReasoningEffortUnsupported,
      parseProviderInput,
      parseUiLanguageInput,
      parseFastModeAction,
      parseRuntimeModeAction,
      parseSecurityProfileInput,
      parseTimeoutConfigAction,
      parseCompactConfigFromText,
      parseExtraInfoConfigFromText,
      getProjectUpgradeStatus: (options = {}) => projectUpgradeManager.getCachedStatus({ refresh: options.fetch !== false }),
      setProjectUpgradeMode: projectUpgradeManager.setMode,
      canManageProjectUpgrade,
      applyProjectUpgrade: () => projectUpgradeManager.apply({
        restart: false,
        requireIdle: () => {
          const busy = appContext.promptRuntime.getAllRuntimeSnapshots()
            .find((item) => item.running || Number(item.queued || 0) > 0);
          return busy
            ? { ok: false, error: `bot has running or queued work in ${busy.key}` }
            : { ok: true };
        },
      }),
      requestProjectUpgradeRestart: () => projectUpgradeManager.requestRestart(),
      parseConfigKey,
      parseReasoningEffortInput,
      parseWorkspaceCommandAction,
      isReasoningEffortSupported,
      resolvePath,
      forkCodexThread: (options) => forkCodexThread({
        ...options,
        codexBin: CODEX_BIN,
        env: SPAWN_ENV,
        disabledMcpServers: CODEX_APP_SERVER_DISABLED_MCP_SERVERS,
      }),
      resolveForkWorkspace: ({ provider, parentSessionId } = {}) => (
        normalizeProvider(provider) === 'claude'
          ? readClaudeSessionMetaBySessionId(parentSessionId)?.cwd
          : null
      ),
      getCodexThreadGoal: (options) => getCodexThreadGoal({
        ...options,
        codexBin: CODEX_BIN,
        env: SPAWN_ENV,
        disabledMcpServers: CODEX_APP_SERVER_DISABLED_MCP_SERVERS,
      }),
      setCodexThreadGoal: (options) => setCodexThreadGoal({
        ...options,
        codexBin: CODEX_BIN,
        env: SPAWN_ENV,
        disabledMcpServers: CODEX_APP_SERVER_DISABLED_MCP_SERVERS,
      }),
      clearCodexThreadGoal: (options) => clearCodexThreadGoal({
        ...options,
        codexBin: CODEX_BIN,
        env: SPAWN_ENV,
        disabledMcpServers: CODEX_APP_SERVER_DISABLED_MCP_SERVERS,
      }),
      safeError,
    },
  },
  accessPolicyOptions: {
    allowedChannelIds: ALLOWED_CHANNEL_IDS,
    allowedGuildIds: ALLOWED_GUILD_IDS,
    allowedChatIds: ALLOWED_CHANNEL_IDS,
    allowedTenantIds: ALLOWED_GUILD_IDS,
    allowedUserIds: ALLOWED_USER_IDS,
  },
  entryHandlerOptions: {
    logger: console,
    parseCommandActionButtonId,
    ...(BOT_PLATFORM === 'discord' ? {
      REST,
      Routes,
      discordToken: DISCORD_TOKEN,
      restProxyAgent,
      withDiscordNetworkRetry,
      safeReply: safeReplyWithLiveClient,
      isIgnorableDiscordRuntimeError,
      isRecoverableGatewayCloseCode,
      messageInput: discordMessageInput,
    } : {
      messageInput: { buildPromptFromMessage },
      eventDedupWindowMs: LARK_EVENT_DEDUP_WINDOW_MS,
      eventDedupMaxEntries: LARK_EVENT_DEDUP_MAX_ENTRIES,
      onPermissionDenied: larkDenialAcceptanceRecorder?.recordPermissionDenied,
      onAcceptedEvent: larkWebhookAcceptanceRecorder?.recordAcceptedEvent,
    }),
    safeError,
  },
  lifecycleOptions: {
    selfHealEnabled: SELF_HEAL_ENABLED,
    restartDelayMs: SELF_HEAL_RESTART_DELAY_MS,
    maxLoginBackoffMs: SELF_HEAL_MAX_LOGIN_BACKOFF_MS,
    ...(BOT_PLATFORM === 'discord'
      ? { discordToken: DISCORD_TOKEN }
      : { transport: LARK_TRANSPORT }),
    createClient,
    safeError,
    logger: console,
  },
  singleInstanceLockOptions: {
    dataDir: DATA_DIR,
    lockFile: LOCK_FILE,
    rootDir: ROOT,
    ensureDir,
    safeError,
    logger: console,
  },
});
activeLifecycle = appContext.lifecycle;

const projectUpgradeScheduler = createProjectUpgradeScheduler({
  manager: projectUpgradeManager,
  intervalMs: PROJECT_UPGRADE_CHECK_INTERVAL_MS,
  initialDelayMs: PROJECT_UPGRADE_INITIAL_DELAY_MS,
  notifyConversationIds: [...PROJECT_UPGRADE_NOTIFY_CHANNEL_IDS],
  notificationDelivery: appContext.notificationDelivery,
  getRuntimeSnapshots: () => appContext.promptRuntime.getAllRuntimeSnapshots(),
  requestRestart: () => projectUpgradeManager.requestRestart(),
  stateFile: path.join(DATA_DIR, appendPlatformInstanceSuffix('project-upgrade-notices.json', {
    platformId: BOT_PLATFORM,
    instanceId: PLATFORM_INSTANCE_ID,
  })),
  heartbeatDir: path.join(DATA_DIR, appendPlatformInstanceSuffix('project-upgrade-heartbeats', {
    platformId: BOT_PLATFORM,
    instanceId: PLATFORM_INSTANCE_ID,
  })),
  heartbeatId: `${BOT_PLATFORM}-${PLATFORM_INSTANCE_ID}-${BOT_PROVIDER || 'shared'}-${process.pid}`,
  logger: console,
});

console.log([
  '🔐 Security defaults:',
  `• BOT_PLATFORM=${BOT_PLATFORM}`,
  ...(BOT_PLATFORM === 'lark' ? [`• LARK_TRANSPORT=${LARK_TRANSPORT}`] : []),
  `• BOT_INSTANCE_ID=${PLATFORM_INSTANCE_ID}`,
  `• BOT_MODE=${BOT_MODE}`,
  `• DEFAULT_PROVIDER=${DEFAULT_PROVIDER}`,
  `• DEFAULT_MODE=${DEFAULT_MODE}`,
  `• CODEX_RUNTIME_MODE=${CODEX_RUNTIME_MODE}`,
  `• CODEX_APP_SERVER_IDLE_MS=${CODEX_APP_SERVER_IDLE_MS}`,
  `• CODEX_APP_SERVER_MAX_SESSIONS=${CODEX_APP_SERVER_MAX_SESSIONS}`,
  `• CODEX_APP_SERVER_DISABLED_MCP_SERVERS=${CODEX_APP_SERVER_DISABLED_MCP_SERVERS.length ? CODEX_APP_SERVER_DISABLED_MCP_SERVERS.join(',') : '(none)'}`,
  `• CLAUDE_RUNTIME_MODE=${CLAUDE_RUNTIME_MODE}`,
  `• CLAUDE_LONG_IDLE_MS=${CLAUDE_LONG_IDLE_MS}`,
  `• CLAUDE_LONG_MAX_SESSIONS=${CLAUDE_LONG_MAX_SESSIONS}`,
  `• SLASH_PREFIX=${SLASH_PREFIX || '(none)'}`,
  `• SECURITY_PROFILE=${SECURITY_PROFILE}`,
  `• MENTION_ONLY=${MENTION_ONLY_OVERRIDE === null ? 'profile-default' : MENTION_ONLY_OVERRIDE}`,
  `• MENTION_ONLY_ENABLED_GUILD_IDS=${MENTION_ONLY_ENABLED_GUILD_IDS?.size ? [...MENTION_ONLY_ENABLED_GUILD_IDS].join(',') : '(none)'}`,
  `• MENTION_ONLY_DISABLED_GUILD_IDS=${MENTION_ONLY_DISABLED_GUILD_IDS?.size ? [...MENTION_ONLY_DISABLED_GUILD_IDS].join(',') : '(none)'}`,
  `• MENTION_ONLY_CHANNEL_IDS=${MENTION_ONLY_CHANNEL_IDS?.size ? [...MENTION_ONLY_CHANNEL_IDS].join(',') : '(none)'}`,
  `• CHILD_THREAD_WORKSPACE_MODE=${resolveChildThreadWorkspaceMode(BOT_PROVIDER || DEFAULT_PROVIDER).mode}`,
  `• MAX_QUEUE_PER_CHANNEL=${MAX_QUEUE_PER_CHANNEL_OVERRIDE === null ? 'profile-default' : MAX_QUEUE_PER_CHANNEL_OVERRIDE}`,
  `• ENABLE_CONFIG_CMD=${ENABLE_CONFIG_CMD}`,
  `• CONFIG_ALLOWLIST=${appContext.core.securityPolicy.describeConfigPolicy()}`,
  `• DEFAULT_UI_LANGUAGE=${DEFAULT_UI_LANGUAGE}`,
  `• DEFAULT_REPLY_DELIVERY_MODE=${formatReplyDeliveryModeLabel(resolveReplyDeliveryDefault().mode, DEFAULT_UI_LANGUAGE)}`,
  `• PROJECT_UPGRADE_MODE=${projectUpgradeManager.resolveConfig().mode}`,
  `• ONBOARDING_ENABLED_DEFAULT=${ONBOARDING_ENABLED_BY_DEFAULT}`,
].join('\n'));

try {
  await bootApp({
    lifecycle: appContext.lifecycle,
    singleInstanceLock: appContext.singleInstanceLock,
    reason: 'startup',
  });
  projectUpgradeScheduler.start();
} catch (err) {
  console.error(`❌ Failed to boot ${BOT_PLATFORM} client: ${safeError(err)}`);
  process.exit(1);
}
