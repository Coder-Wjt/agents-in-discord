import {
  DEFAULT_CONVERSATION_SECURITY_RESOLVER,
  assertConversationSecurityDescriptor,
  assertConversationSecurityResolver,
} from './platforms/conversation-security.js';

export function parseCsvSet(value) {
  if (!value || !value.trim()) return null;
  return new Set(value.split(',').map((item) => item.trim()).filter(Boolean));
}

export function resolveProjectUpgradeNotifyChannelIds({
  upgradeNotifyChannelIds = '',
  allowedChannelIds = null,
} = {}) {
  const configured = parseCsvSet(upgradeNotifyChannelIds || '');
  if (configured) return configured;
  if (allowedChannelIds === null || allowedChannelIds === undefined) return new Set();
  if (!(allowedChannelIds instanceof Set)) {
    throw new Error('allowedChannelIds must be a Set when configured');
  }
  return new Set(allowedChannelIds);
}

export function normalizeSecurityProfile(value, { logger = console } = {}) {
  const raw = String(value || 'auto').trim().toLowerCase();
  if (['auto', 'solo', 'team', 'public'].includes(raw)) return raw;
  logger?.warn?.(`⚠️ Unknown SECURITY_PROFILE=${value}, fallback to auto`);
  return 'auto';
}

export function parseOptionalBool(value, { logger = console } = {}) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  logger?.warn?.(`⚠️ Invalid boolean value: ${value} (ignored)`);
  return null;
}

export function normalizeQueueLimit(value, { logger = console } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    logger?.warn?.(`⚠️ Invalid MAX_QUEUE_PER_CHANNEL=${value}, using profile default`);
    return null;
  }
  if (n <= 0) return 0;
  return Math.floor(n);
}

export function parseConfigAllowlist(value) {
  const raw = String(value || '').trim();
  if (raw === '*') {
    return { allowAll: true, keys: new Set() };
  }
  return {
    allowAll: false,
    keys: new Set(
      raw.split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  };
}

export function parseConfigKey(input) {
  const text = String(input || '').trim();
  const match = text.match(/^([a-zA-Z0-9_.-]+)\s*=/);
  return match?.[1]?.toLowerCase() || '';
}

export function createSecurityPolicy({
  securityProfile = 'auto',
  securityProfileDefaults = {},
  mentionOnlyOverride = null,
  mentionOnlyEnabledGuildIds = null,
  mentionOnlyDisabledGuildIds = null,
  mentionOnlyChannelIds = null,
  maxQueuePerChannelOverride = null,
  enableConfigCmd = false,
  configPolicy = { allowAll: false, keys: new Set() },
  getEffectiveSecurityProfile = () => ({ profile: securityProfile, source: 'env default' }),
  conversationSecurityResolver = DEFAULT_CONVERSATION_SECURITY_RESOLVER,
} = {}) {
  const securityResolver = assertConversationSecurityResolver(conversationSecurityResolver);

  function isConfigKeyAllowed(key) {
    if (configPolicy.allowAll) return true;
    return configPolicy.keys.has(String(key || '').trim().toLowerCase());
  }

  function describeConfigPolicy() {
    if (configPolicy.allowAll) return '`*` (allow all)';
    if (!configPolicy.keys.size) return '(none)';
    return [...configPolicy.keys].map((key) => `\`${key}\``).join(', ');
  }

  function formatConfigCommandStatus() {
    if (!enableConfigCmd) return 'off';
    return `on (${describeConfigPolicy()})`;
  }

  function formatQueueLimit(limit) {
    const n = Number(limit);
    if (!Number.isFinite(n) || n <= 0) return 'unlimited';
    return `${Math.floor(n)}`;
  }

  function resolveDescriptor(source) {
    return assertConversationSecurityDescriptor(securityResolver.resolve(source));
  }

  function isMentionOnlyConversation(descriptor) {
    if (!mentionOnlyChannelIds?.size || !descriptor?.available) return false;

    if (
      descriptor.conversationId
      && mentionOnlyChannelIds.has(descriptor.conversationId)
    ) return true;

    return Boolean(
      descriptor.parentConversationId
      && mentionOnlyChannelIds.has(descriptor.parentConversationId),
    );
  }

  function resolveMentionOnly(defaults, descriptor) {
    if (isMentionOnlyConversation(descriptor)) return true;
    const tenantId = descriptor?.tenantId;
    if (tenantId && mentionOnlyEnabledGuildIds?.has(tenantId)) return true;
    if (tenantId && mentionOnlyDisabledGuildIds?.has(tenantId)) return false;
    return mentionOnlyOverride === null ? defaults.mentionOnly : mentionOnlyOverride;
  }

  function resolveSecurityContext(source, session = null) {
    const descriptor = resolveDescriptor(source);
    const configured = getEffectiveSecurityProfile(session);
    const resolved = resolveSecurityProfileFromDescriptor(
      descriptor,
      configured.profile,
      configured.source,
    );
    const defaults = securityProfileDefaults[resolved.profile] || securityProfileDefaults.team || {
      mentionOnly: false,
      maxQueuePerChannel: 20,
    };
    return {
      configuredProfile: configured.profile,
      configuredSource: configured.source,
      profile: resolved.profile,
      source: resolved.source,
      reason: resolved.reason,
      mentionOnly: resolveMentionOnly(defaults, descriptor),
      maxQueuePerChannel: maxQueuePerChannelOverride === null ? defaults.maxQueuePerChannel : maxQueuePerChannelOverride,
    };
  }

  function resolveSecurityProfileFromDescriptor(
    descriptor,
    configuredProfile = securityProfile,
    configuredSource = 'env default',
  ) {
    if (configuredProfile !== 'auto') {
      return {
        profile: configuredProfile,
        source: configuredSource === 'session override' ? 'session' : 'manual',
        reason: `${configuredSource}: ${configuredProfile}`,
      };
    }
    if (!descriptor.available) {
      return { profile: 'team', source: 'auto', reason: `${descriptor.reason} (fallback team)` };
    }
    if (descriptor.isDirect) {
      return { profile: 'solo', source: 'auto', reason: 'dm channel' };
    }

    if (descriptor.visibility === 'public') {
      return { profile: 'public', source: 'auto', reason: descriptor.reason };
    }
    if (descriptor.visibility === 'team') {
      return { profile: 'team', source: 'auto', reason: descriptor.reason };
    }
    return { profile: 'team', source: 'auto', reason: `${descriptor.reason} (fallback team)` };
  }

  function resolveSecurityProfileForConversation(
    source,
    configuredProfile = securityProfile,
    configuredSource = 'env default',
  ) {
    return resolveSecurityProfileFromDescriptor(
      resolveDescriptor(source),
      configuredProfile,
      configuredSource,
    );
  }

  function resolveConversationVisibility(source) {
    const descriptor = resolveDescriptor(source);
    return {
      visibility: descriptor.visibility,
      reason: descriptor.reason,
    };
  }

  function formatSecurityProfileDisplay(security, language = 'en') {
    if (!security) return language === 'en' ? '(unknown)' : '（未知）';
    if (security.source === 'session') {
      return language === 'en'
        ? `${security.profile} (session override)`
        : `${security.profile}（频道覆盖）`;
    }
    if (security.source === 'manual') {
      return language === 'en'
        ? `${security.profile} (manual)`
        : `${security.profile}（手动设置）`;
    }
    return language === 'en'
      ? `${security.profile} (auto: ${security.reason})`
      : `${security.profile}（自动：${security.reason}）`;
  }

  return {
    isConfigKeyAllowed,
    describeConfigPolicy,
    formatConfigCommandStatus,
    formatQueueLimit,
    resolveSecurityContext,
    resolveSecurityProfileForConversation,
    resolveConversationVisibility,
    resolveSecurityProfileForChannel: resolveSecurityProfileForConversation,
    resolveGuildChannelVisibility: resolveConversationVisibility,
    formatSecurityProfileDisplay,
  };
}
