import { resolveProviderScopedEnv } from './bot-instance-utils.js';

const VALID_TRANSPORTS = Object.freeze(['auto', 'sdk', 'cli', 'webhook']);
const VALID_DOMAINS = Object.freeze(['feishu', 'lark']);
const PLACEHOLDER_VALUES = new Set([
  '...',
  'changeme',
  'change-me',
  'replace-me',
  'your-app-id',
  'your-app-secret',
  'your-verification-token',
  'your-encrypt-key',
  'cli_xxx',
]);

function normalizeText(value) {
  return String(value || '').trim();
}

function isPlaceholder(value) {
  const normalized = normalizeText(value).toLowerCase();
  return PLACEHOLDER_VALUES.has(normalized)
    || normalized.startsWith('your_')
    || normalized.startsWith('replace_');
}

function isConfiguredSecret(value) {
  return Boolean(normalizeText(value) && !isPlaceholder(value));
}

function parseCsvCount(value) {
  return new Set(
    normalizeText(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  ).size;
}

function isLoopbackHost(value) {
  const host = normalizeText(value).toLowerCase().replace(/^\[|\]$/g, '');
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function createIntegerReader(read, errors) {
  return function readInteger(name, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
    const raw = read(name);
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
      errors.push(`${name} must be an integer between ${min} and ${max}.`);
      return fallback;
    }
    return parsed;
  };
}

export function inspectLarkRuntimeConfig({ botProvider = null, env = process.env } = {}) {
  const errors = [];
  const warnings = [];
  const read = (key) => resolveProviderScopedEnv(key, botProvider, env);
  const readInteger = createIntegerReader(read, errors);

  const appId = read('LARK_APP_ID');
  const appSecret = read('LARK_APP_SECRET');
  const requestedTransport = normalizeText(read('LARK_TRANSPORT') || 'auto').toLowerCase();
  const validRequestedTransport = VALID_TRANSPORTS.includes(requestedTransport);
  if (!validRequestedTransport) {
    errors.push('LARK_TRANSPORT must be auto, sdk, cli, or webhook.');
  }
  const transportConfig = validRequestedTransport ? requestedTransport : 'auto';
  const transport = transportConfig === 'auto'
    ? (appId && appSecret ? 'sdk' : 'cli')
    : transportConfig;

  if (transportConfig === 'auto' && Boolean(appId) !== Boolean(appSecret)) {
    warnings.push('LARK_TRANSPORT=auto found only one of LARK_APP_ID/LARK_APP_SECRET and will use CLI.');
  }
  if (['sdk', 'webhook'].includes(transport)) {
    if (!isConfiguredSecret(appId)) {
      errors.push(`LARK_TRANSPORT=${transport} requires a non-placeholder LARK_APP_ID.`);
    }
    if (!isConfiguredSecret(appSecret)) {
      errors.push(`LARK_TRANSPORT=${transport} requires a non-placeholder LARK_APP_SECRET.`);
    }
    if (isConfiguredSecret(appId) && !appId.startsWith('cli_')) {
      warnings.push('LARK_APP_ID does not use the usual cli_ prefix; confirm the selected application ID.');
    }
  }

  const rawDomain = normalizeText(read('LARK_DOMAIN') || 'feishu').toLowerCase();
  if (transport !== 'cli' && !VALID_DOMAINS.includes(rawDomain)) {
    errors.push('LARK_DOMAIN must be feishu or lark.');
  }
  const domain = VALID_DOMAINS.includes(rawDomain) ? rawDomain : 'feishu';

  const verificationToken = read('LARK_WEBHOOK_VERIFICATION_TOKEN');
  const encryptKey = read('LARK_WEBHOOK_ENCRYPT_KEY');
  if (transport === 'webhook' && !isConfiguredSecret(verificationToken)) {
    errors.push('LARK_TRANSPORT=webhook requires a non-placeholder LARK_WEBHOOK_VERIFICATION_TOKEN.');
  }
  if (transport === 'webhook' && encryptKey && !isConfiguredSecret(encryptKey)) {
    errors.push('LARK_WEBHOOK_ENCRYPT_KEY must not use a placeholder value.');
  }

  const webhookHost = normalizeText(read('LARK_WEBHOOK_HOST') || '127.0.0.1') || '127.0.0.1';
  const rawWebhookPath = normalizeText(read('LARK_WEBHOOK_PATH') || '/lark/events') || '/lark/events';
  const rawWebhookHealthPath = normalizeText(read('LARK_WEBHOOK_HEALTH_PATH') || '/healthz') || '/healthz';
  if (transport === 'webhook' && (rawWebhookPath.includes('?') || rawWebhookPath.includes('#'))) {
    errors.push('LARK_WEBHOOK_PATH must be a path without a query string or fragment.');
  }
  if (transport === 'webhook' && (rawWebhookHealthPath.includes('?') || rawWebhookHealthPath.includes('#'))) {
    errors.push('LARK_WEBHOOK_HEALTH_PATH must be a path without a query string or fragment.');
  }
  const webhookPath = rawWebhookPath.startsWith('/') ? rawWebhookPath : `/${rawWebhookPath}`;
  const webhookHealthPath = rawWebhookHealthPath.startsWith('/')
    ? rawWebhookHealthPath
    : `/${rawWebhookHealthPath}`;
  if (transport === 'webhook' && webhookHealthPath === webhookPath) {
    errors.push('LARK_WEBHOOK_HEALTH_PATH must differ from LARK_WEBHOOK_PATH.');
  }
  const readWebhookInteger = createIntegerReader(read, transport === 'webhook' ? errors : []);
  const webhookPort = readWebhookInteger('LARK_WEBHOOK_PORT', 3000, { min: 1, max: 65535 });
  const webhookMaxBodyBytes = readWebhookInteger('LARK_WEBHOOK_MAX_BODY_BYTES', 1024 * 1024, {
    min: 1024,
  });
  const webhookHeadersTimeoutMs = readWebhookInteger('LARK_WEBHOOK_HEADERS_TIMEOUT_MS', 10_000, {
    min: 1000,
    max: 300_000,
  });
  const webhookRequestTimeoutMs = readWebhookInteger('LARK_WEBHOOK_REQUEST_TIMEOUT_MS', 15_000, {
    min: 1000,
    max: 300_000,
  });
  const webhookKeepAliveTimeoutMs = readWebhookInteger('LARK_WEBHOOK_KEEP_ALIVE_TIMEOUT_MS', 5000, {
    min: 1000,
    max: 60_000,
  });
  if (transport === 'webhook' && webhookHeadersTimeoutMs > webhookRequestTimeoutMs) {
    errors.push('LARK_WEBHOOK_HEADERS_TIMEOUT_MS must not exceed LARK_WEBHOOK_REQUEST_TIMEOUT_MS.');
  }
  if (transport === 'webhook' && !encryptKey) {
    warnings.push('Webhook encryption is disabled; configure LARK_WEBHOOK_ENCRYPT_KEY when the app enables encrypted events.');
  }
  if (transport === 'webhook' && !isLoopbackHost(webhookHost)) {
    warnings.push('LARK_WEBHOOK_HOST is not loopback; ensure the container or network boundary is explicitly trusted.');
  }

  const handshakeTimeoutMs = readInteger('LARK_HANDSHAKE_TIMEOUT_MS', 30_000, {
    min: 1000,
  });
  const staleMessageWindowMs = readInteger('LARK_STALE_MESSAGE_WINDOW_MS', 5 * 60_000, {
    min: 0,
  });
  const eventDedupWindowMs = readInteger('LARK_EVENT_DEDUP_WINDOW_MS', 12 * 60 * 60_000, {
    min: 1000,
  });
  const eventDedupMaxEntries = readInteger('LARK_EVENT_DEDUP_MAX_ENTRIES', 5000, {
    min: 100,
  });
  const textChunkLimit = readInteger('LARK_TEXT_CHUNK_LIMIT', 4000, {
    min: 1000,
  });
  const sendMaxAttempts = readInteger('LARK_SEND_MAX_ATTEMPTS', 3, { min: 1 });
  const sendRetryBaseDelayMs = readInteger('LARK_SEND_RETRY_BASE_DELAY_MS', 500, {
    min: 100,
  });

  const allowedChatIds = read('LARK_ALLOWED_CHAT_IDS') || read('ALLOWED_CHANNEL_IDS');
  const allowedTenantIds = read('LARK_ALLOWED_TENANT_IDS') || read('ALLOWED_GUILD_IDS');
  const allowedUserIds = read('LARK_ALLOWED_USER_IDS') || read('ALLOWED_USER_IDS');
  const mentionOnlyChatIds = read('LARK_MENTION_ONLY_CHAT_IDS') || read('MENTION_ONLY_CHANNEL_IDS');
  const access = {
    allowedChatCount: parseCsvCount(allowedChatIds),
    allowedTenantCount: parseCsvCount(allowedTenantIds),
    allowedUserCount: parseCsvCount(allowedUserIds),
    mentionOnlyChatCount: parseCsvCount(mentionOnlyChatIds),
  };
  if (!access.allowedChatCount && !access.allowedTenantCount && !access.allowedUserCount) {
    warnings.push('No Lark chat, tenant, or user allowlist is configured; the bot is open to every reachable conversation.');
  }

  return {
    botProvider: normalizeText(botProvider) || null,
    config: {
      requestedTransport: transportConfig,
      transport,
      appId,
      appSecret,
      domain,
      cliBin: normalizeText(read('LARK_CLI_BIN') || 'lark-cli') || 'lark-cli',
      cliProfile: read('LARK_CLI_PROFILE'),
      webhook: {
        verificationToken,
        encryptKey,
        host: webhookHost,
        port: webhookPort,
        path: webhookPath,
        healthPath: webhookHealthPath,
        maxBodyBytes: webhookMaxBodyBytes,
        headersTimeoutMs: webhookHeadersTimeoutMs,
        requestTimeoutMs: webhookRequestTimeoutMs,
        keepAliveTimeoutMs: webhookKeepAliveTimeoutMs,
      },
      safety: {
        handshakeTimeoutMs,
        staleMessageWindowMs,
        eventDedupWindowMs,
        eventDedupMaxEntries,
      },
      outbound: {
        textChunkLimit,
        sendMaxAttempts,
        sendRetryBaseDelayMs,
      },
      access,
    },
    errors,
    warnings,
  };
}

export function resolveLarkRuntimeConfig(options = {}) {
  const inspection = inspectLarkRuntimeConfig(options);
  if (inspection.errors.length) {
    const error = new TypeError(inspection.errors.join('\n'));
    error.code = 'lark_config_invalid';
    error.issues = [...inspection.errors];
    throw error;
  }
  return inspection.config;
}

export { VALID_TRANSPORTS as LARK_TRANSPORTS, VALID_DOMAINS as LARK_DOMAINS };
