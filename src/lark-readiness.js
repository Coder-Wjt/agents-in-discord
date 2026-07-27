import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  compareLarkSlashCommands,
  normalizeLarkSlashCommandList,
} from './lark-slash-commands.js';

const execFileAsync = promisify(execFile);

function normalizeText(value) {
  return String(value || '').trim();
}

function parseJson(text) {
  try {
    return JSON.parse(String(text || '').trim());
  } catch {
    return null;
  }
}

function withCliProfile(config, args) {
  const profile = normalizeText(config?.cliProfile);
  return profile ? ['--profile', profile, ...args] : args;
}

function sdkBaseUrl(domain) {
  return domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn';
}

async function fetchJson(fetchFn, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 10_000));
  timer.unref?.();
  try {
    const response = await fetchFn(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(`Lark API returned HTTP ${response.status}.`);
      error.code = 'lark_http_error';
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function assertSuccessfulLarkPayload(payload, operation) {
  const code = Number(payload?.code);
  if (code !== 0) {
    const error = new Error(`Lark ${operation} failed with code ${Number.isFinite(code) ? code : 'unknown'}.`);
    error.code = 'lark_api_error';
    error.larkCode = Number.isFinite(code) ? code : null;
    throw error;
  }
}

function normalizeRequiredValues(values) {
  return [...new Set((values || []).map(normalizeText).filter(Boolean))].sort();
}

function verifyTenantScopeBaseline(payload, requiredTenantScopes) {
  const required = normalizeRequiredValues(requiredTenantScopes);
  if (!required.length) return { checked: false, requiredCount: 0, grantedCount: 0, missing: [] };
  const scopes = payload?.data?.scopes;
  if (!Array.isArray(scopes)) {
    const error = new Error('Lark scope verification returned no scope list.');
    error.code = 'lark_scope_response_invalid';
    throw error;
  }
  const granted = new Set(scopes
    .filter((scope) => (
      normalizeText(scope?.scope_type).toLowerCase() === 'tenant'
      && Number(scope?.grant_status) === 1
    ))
    .map((scope) => normalizeText(scope?.scope_name))
    .filter(Boolean));
  const missing = required.filter((scope) => !granted.has(scope));
  const result = {
    checked: true,
    requiredCount: required.length,
    grantedCount: required.length - missing.length,
    missing,
  };
  return result;
}

function applicationAuditRequested({
  requirePublishedVersion,
  requireBotMenu,
  requiredBotMenuEventKeys,
  requiredEvents,
  requiredCallbacks,
  requiredSlashCommands,
}) {
  return Boolean(
    requirePublishedVersion
    || requireBotMenu
    || normalizeRequiredValues(requiredBotMenuEventKeys).length
    || normalizeRequiredValues(requiredEvents).length
    || normalizeRequiredValues(requiredCallbacks).length
    || (requiredSlashCommands || []).length
  );
}

function expectedSubscriptionType(config) {
  return config?.transport === 'webhook' ? 'webhook' : 'websocket';
}

function extractPublishedEventTypes(app, appVersion) {
  const eventInfoTypes = Array.isArray(appVersion?.event_infos)
    ? appVersion.event_infos.map((event) => normalizeText(event?.event_type)).filter(Boolean)
    : [];
  const appEvents = Array.isArray(app?.event?.subscribed_events)
    ? app.event.subscribed_events.map(normalizeText).filter(Boolean)
    : [];
  const versionEvents = Array.isArray(appVersion?.events)
    ? appVersion.events
      .map(normalizeText)
      .filter((eventType) => eventType.includes('.'))
    : [];
  return [...new Set([...eventInfoTypes, ...appEvents, ...versionEvents])];
}

function extractSubscribedCallbacks(app) {
  const candidates = [
    app?.callback_info?.subscribed_callbacks,
    app?.callback?.subscribed_callbacks,
  ];
  const configured = candidates.find(Array.isArray);
  return Array.isArray(configured)
    ? [...new Set(configured.map(normalizeText).filter(Boolean))]
    : null;
}

function buildApplicationBaseline({
  app,
  appVersion,
  config,
  requiredEvents = [],
  requiredCallbacks = [],
  requiredSlashCommands = [],
  requirePublishedVersion = false,
  requireBotMenu = false,
  requiredBotMenuEventKeys = [],
  slashCommandPayload = null,
}) {
  const requiredEventTypes = normalizeRequiredValues(requiredEvents);
  const requiredCallbackTypes = normalizeRequiredValues(requiredCallbacks);
  const configuredEventTypes = extractPublishedEventTypes(app, appVersion);
  const configuredCallbacks = extractSubscribedCallbacks(app);
  const actualSubscriptionType = normalizeText(
    app?.event?.subscription_type
      || app?.callback_info?.callback_type
      || app?.callback?.callback_type,
  ).toLowerCase() || null;
  const expectedType = expectedSubscriptionType(config);
  const publishedVersionAvailable = Boolean(app?.online_version_id && appVersion);
  const bot = appVersion?.ability?.bot;
  const botMenuItems = Array.isArray(bot?.bot_menus) ? bot.bot_menus : [];
  const botMenuEnabled = bot?.bot_menu_enable === true || Number(bot?.bot_menu_enable) === 1;
  const requiredMenuEventKeys = normalizeRequiredValues(requiredBotMenuEventKeys);
  const configuredMenuEventKeys = normalizeRequiredValues(
    botMenuItems.map((item) => item?.event_key),
  );
  const missingMenuEventKeys = requiredMenuEventKeys
    .filter((eventKey) => !configuredMenuEventKeys.includes(eventKey));
  const eventMissing = requiredEventTypes.filter((eventType) => !configuredEventTypes.includes(eventType));
  const callbackMissing = configuredCallbacks === null
    ? []
    : requiredCallbackTypes.filter((callbackType) => !configuredCallbacks.includes(callbackType));
  let slashCommands = {
    checked: false,
    requiredCount: requiredSlashCommands.length,
    installedCount: null,
    matchedCount: null,
    missing: [],
    outdated: [],
    extraCount: null,
  };
  if (requiredSlashCommands.length && slashCommandPayload) {
    const diff = compareLarkSlashCommands(
      requiredSlashCommands,
      normalizeLarkSlashCommandList(slashCommandPayload),
    );
    slashCommands = {
      checked: true,
      requiredCount: diff.requiredCount,
      installedCount: diff.installedCount,
      matchedCount: diff.matchedCount,
      missing: diff.missing.map((item) => item.command),
      outdated: diff.outdated.map((item) => item.command),
      extraCount: diff.extra.length,
    };
  }

  return {
    checked: true,
    requirePublishedVersion: Boolean(requirePublishedVersion),
    publishedVersionAvailable,
    botAbilityAvailable: Boolean(bot),
    subscription: {
      checked: Boolean(actualSubscriptionType),
      expected: expectedType,
      actual: actualSubscriptionType,
      ok: actualSubscriptionType ? actualSubscriptionType === expectedType : null,
      requestUrlConfigured: expectedType === 'webhook'
        ? Boolean(
          app?.event?.request_url
          || app?.callback_info?.request_url
          || app?.callback?.request_url,
        )
        : null,
    },
    events: {
      checked: publishedVersionAvailable && (
        Array.isArray(appVersion?.event_infos)
        || Array.isArray(appVersion?.events)
        || Array.isArray(app?.event?.subscribed_events)
      ),
      requiredCount: requiredEventTypes.length,
      configuredCount: configuredEventTypes.length,
      matchedCount: requiredEventTypes.length - eventMissing.length,
      missing: eventMissing,
    },
    callbacks: {
      checked: configuredCallbacks !== null,
      requiredCount: requiredCallbackTypes.length,
      configuredCount: configuredCallbacks?.length ?? null,
      matchedCount: configuredCallbacks === null
        ? null
        : requiredCallbackTypes.length - callbackMissing.length,
      missing: callbackMissing,
    },
    botMenu: {
      required: Boolean(requireBotMenu || requiredMenuEventKeys.length),
      checked: Boolean(bot),
      enabled: botMenuEnabled,
      itemCount: botMenuItems.length,
      requiredEventKeyCount: requiredMenuEventKeys.length,
      eventKeyCount: configuredMenuEventKeys.length,
      matchedEventKeyCount: requiredMenuEventKeys.length - missingMenuEventKeys.length,
      missingEventKeys: missingMenuEventKeys,
      ok: requireBotMenu || requiredMenuEventKeys.length
        ? botMenuEnabled && botMenuItems.length > 0 && missingMenuEventKeys.length === 0
        : null,
    },
    slashCommands,
  };
}

function unavailableApplicationBaseline({
  requiredEvents = [],
  requiredCallbacks = [],
  requiredSlashCommands = [],
  requirePublishedVersion = false,
  requireBotMenu = false,
  requiredBotMenuEventKeys = [],
} = {}) {
  return {
    checked: false,
    requirePublishedVersion: Boolean(requirePublishedVersion),
    requiredEventCount: normalizeRequiredValues(requiredEvents).length,
    requiredCallbackCount: normalizeRequiredValues(requiredCallbacks).length,
    requiredSlashCommandCount: requiredSlashCommands.length,
    requireBotMenu: Boolean(requireBotMenu),
    requiredBotMenuEventKeyCount: normalizeRequiredValues(requiredBotMenuEventKeys).length,
  };
}

async function verifySdkApplicationBaseline({
  config,
  tenantAccessToken,
  requiredEvents,
  requiredCallbacks,
  requiredSlashCommands,
  requirePublishedVersion,
  requireBotMenu,
  requiredBotMenuEventKeys,
  fetchFn,
  timeoutMs,
}) {
  const baseUrl = sdkBaseUrl(config?.domain);
  const headers = { authorization: `Bearer ${tenantAccessToken}` };
  const appId = encodeURIComponent(normalizeText(config?.appId));
  const appPayload = await fetchJson(
    fetchFn,
    `${baseUrl}/open-apis/application/v6/applications/${appId}?lang=zh_cn`,
    { method: 'GET', headers },
    timeoutMs,
  );
  assertSuccessfulLarkPayload(appPayload, 'published application verification');
  const app = appPayload?.data?.app;
  if (!app || typeof app !== 'object') throw new Error('Lark application verification returned no app.');

  const onlineVersionId = normalizeText(app.online_version_id);
  let appVersion = null;
  if (onlineVersionId) {
    const versionPayload = await fetchJson(
      fetchFn,
      `${baseUrl}/open-apis/application/v6/applications/${appId}/app_versions/${encodeURIComponent(onlineVersionId)}?lang=zh_cn`,
      { method: 'GET', headers },
      timeoutMs,
    );
    assertSuccessfulLarkPayload(versionPayload, 'published application version verification');
    appVersion = versionPayload?.data?.app_version || null;
  }
  let slashCommandPayload = null;
  if (requiredSlashCommands.length) {
    try {
      slashCommandPayload = await fetchJson(
        fetchFn,
        `${baseUrl}/open-apis/application/v7/app_slash_commands`,
        { method: 'GET', headers },
        timeoutMs,
      );
      assertSuccessfulLarkPayload(slashCommandPayload, 'native slash-command verification');
      normalizeLarkSlashCommandList(slashCommandPayload);
    } catch {
      slashCommandPayload = null;
    }
  }

  return buildApplicationBaseline({
    app,
    appVersion,
    config,
    requiredEvents,
    requiredCallbacks,
    requiredSlashCommands,
    requirePublishedVersion,
    requireBotMenu,
    requiredBotMenuEventKeys,
    slashCommandPayload,
  });
}

async function execCliJson({ config, args, execFileFn, env, cwd }) {
  const result = await execFileFn(
    config?.cliBin || 'lark-cli',
    withCliProfile(config, args),
    {
      cwd,
      env: {
        ...env,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
      },
      maxBuffer: 1024 * 1024,
    },
  );
  const payload = parseJson(result?.stdout);
  if (!payload || typeof payload !== 'object') throw new Error('lark-cli returned invalid JSON.');
  if (payload.code !== undefined) assertSuccessfulLarkPayload(payload, 'read-only API verification');
  return payload;
}

async function verifyCliApplicationBaseline({
  config,
  appId,
  requiredEvents,
  requiredCallbacks,
  requiredSlashCommands,
  requirePublishedVersion,
  requireBotMenu,
  requiredBotMenuEventKeys,
  execFileFn,
  env,
  cwd,
}) {
  if (!normalizeText(appId)) throw new Error('lark-cli auth status returned no app ID.');
  const encodedAppId = encodeURIComponent(normalizeText(appId));
  const appPayload = await execCliJson({
    config,
    args: [
      'api',
      'GET',
      `/open-apis/application/v6/applications/${encodedAppId}`,
      '--as',
      'bot',
      '--params',
      JSON.stringify({ lang: 'zh_cn' }),
      '--json',
    ],
    execFileFn,
    env,
    cwd,
  });
  const app = appPayload?.data?.app;
  if (!app || typeof app !== 'object') throw new Error('lark-cli application verification returned no app.');

  const onlineVersionId = normalizeText(app.online_version_id);
  let appVersion = null;
  if (onlineVersionId) {
    const versionPayload = await execCliJson({
      config,
      args: [
        'api',
        'GET',
        `/open-apis/application/v6/applications/${encodedAppId}/app_versions/${encodeURIComponent(onlineVersionId)}`,
        '--as',
        'bot',
        '--params',
        JSON.stringify({ lang: 'zh_cn' }),
        '--json',
      ],
      execFileFn,
      env,
      cwd,
    });
    appVersion = versionPayload?.data?.app_version || null;
  }
  let slashCommandPayload = null;
  if (requiredSlashCommands.length) {
    try {
      slashCommandPayload = await execCliJson({
        config,
        args: [
          'api',
          'GET',
          '/open-apis/application/v7/app_slash_commands',
          '--as',
          'bot',
          '--json',
        ],
        execFileFn,
        env,
        cwd,
      });
      normalizeLarkSlashCommandList(slashCommandPayload);
    } catch {
      slashCommandPayload = null;
    }
  }

  return buildApplicationBaseline({
    app,
    appVersion,
    config,
    requiredEvents,
    requiredCallbacks,
    requiredSlashCommands,
    requirePublishedVersion,
    requireBotMenu,
    requiredBotMenuEventKeys,
    slashCommandPayload,
  });
}

export async function verifyLarkSdkCredentials({
  config,
  requiredTenantScopes = [],
  requiredEvents = [],
  requiredCallbacks = [],
  requiredSlashCommands = [],
  requirePublishedVersion = false,
  requireBotMenu = false,
  requiredBotMenuEventKeys = [],
  fetchFn = globalThis.fetch,
  timeoutMs = 10_000,
} = {}) {
  if (typeof fetchFn !== 'function') throw new TypeError('Lark credential verification requires fetch().');
  const baseUrl = sdkBaseUrl(config?.domain);
  const tokenPayload = await fetchJson(fetchFn, `${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      app_id: config?.appId,
      app_secret: config?.appSecret,
    }),
  }, timeoutMs);
  assertSuccessfulLarkPayload(tokenPayload, 'tenant token verification');
  const tenantAccessToken = normalizeText(tokenPayload?.tenant_access_token);
  if (!tenantAccessToken) throw new Error('Lark tenant token verification returned no access token.');

  const botPayload = await fetchJson(fetchFn, `${baseUrl}/open-apis/bot/v3/info`, {
    method: 'GET',
    headers: { authorization: `Bearer ${tenantAccessToken}` },
  }, timeoutMs);
  assertSuccessfulLarkPayload(botPayload, 'bot capability verification');
  const bot = botPayload?.bot || botPayload?.data?.bot || botPayload?.data;
  const botOpenId = normalizeText(bot?.open_id || bot?.openId);
  if (!bot || typeof bot !== 'object' || !botOpenId) {
    const error = new Error('Lark bot capability verification returned no bot open ID.');
    error.code = 'lark_bot_identity_unavailable';
    throw error;
  }
  let scopeBaseline = { checked: false, requiredCount: 0, grantedCount: 0, missing: [] };
  if (requiredTenantScopes.length) {
    const scopePayload = await fetchJson(fetchFn, `${baseUrl}/open-apis/application/v6/scopes`, {
      method: 'GET',
      headers: { authorization: `Bearer ${tenantAccessToken}` },
    }, timeoutMs);
    assertSuccessfulLarkPayload(scopePayload, 'tenant scope verification');
    scopeBaseline = verifyTenantScopeBaseline(scopePayload, requiredTenantScopes);
  }
  let applicationBaseline = unavailableApplicationBaseline({
    requiredEvents,
    requiredCallbacks,
    requiredSlashCommands,
    requirePublishedVersion,
    requireBotMenu,
    requiredBotMenuEventKeys,
  });
  if (applicationAuditRequested({
    requiredEvents,
    requiredCallbacks,
    requiredSlashCommands,
    requirePublishedVersion,
    requireBotMenu,
    requiredBotMenuEventKeys,
  })) {
    try {
      applicationBaseline = await verifySdkApplicationBaseline({
        config,
        tenantAccessToken,
        requiredEvents,
        requiredCallbacks,
        requiredSlashCommands,
        requirePublishedVersion,
        requireBotMenu,
        requiredBotMenuEventKeys,
        fetchFn,
        timeoutMs,
      });
    } catch {
      // Keep authentication and scope evidence useful when the application-management
      // endpoint is unavailable; the caller will surface an explicit manual check.
    }
  }
  return {
    authenticated: true,
    botAvailable: true,
    botOpenIdAvailable: true,
    scopeBaseline,
    applicationBaseline,
  };
}

export async function verifyLarkCliCredentials({
  config,
  requiredTenantScopes = [],
  requiredEvents = [],
  requiredCallbacks = [],
  requiredSlashCommands = [],
  requirePublishedVersion = false,
  requireBotMenu = false,
  requiredBotMenuEventKeys = [],
  execFileFn = execFileAsync,
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const result = await execFileFn(
    config?.cliBin || 'lark-cli',
    withCliProfile(config, ['auth', 'status', '--verify', '--json']),
    {
      cwd,
      env: {
        ...env,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
      },
      maxBuffer: 1024 * 1024,
    },
  );
  const payload = parseJson(result?.stdout);
  const bot = payload?.identities?.bot;
  const botOpenId = normalizeText(bot?.openId || bot?.open_id);
  if (!bot?.available || normalizeText(bot?.status).toLowerCase() !== 'ready' || !botOpenId) {
    const error = new Error('lark-cli bot identity is not ready.');
    error.code = 'lark_cli_auth_unavailable';
    throw error;
  }
  let scopeBaseline = { checked: false, requiredCount: 0, grantedCount: 0, missing: [] };
  if (requiredTenantScopes.length) {
    const scopeResult = await execFileFn(
      config?.cliBin || 'lark-cli',
      withCliProfile(config, [
        'api',
        'GET',
        '/open-apis/application/v6/scopes',
        '--as',
        'bot',
        '--json',
      ]),
      {
        cwd,
        env: {
          ...env,
          LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
          LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
        },
        maxBuffer: 1024 * 1024,
      },
    );
    const scopePayload = parseJson(scopeResult?.stdout);
    if (scopePayload?.code !== undefined) {
      assertSuccessfulLarkPayload(scopePayload, 'tenant scope verification');
    }
    scopeBaseline = verifyTenantScopeBaseline(scopePayload, requiredTenantScopes);
  }
  let applicationBaseline = unavailableApplicationBaseline({
    requiredEvents,
    requiredCallbacks,
    requiredSlashCommands,
    requirePublishedVersion,
    requireBotMenu,
    requiredBotMenuEventKeys,
  });
  if (applicationAuditRequested({
    requiredEvents,
    requiredCallbacks,
    requiredSlashCommands,
    requirePublishedVersion,
    requireBotMenu,
    requiredBotMenuEventKeys,
  })) {
    try {
      applicationBaseline = await verifyCliApplicationBaseline({
        config,
        appId: payload?.appId || payload?.app_id,
        requiredEvents,
        requiredCallbacks,
        requiredSlashCommands,
        requirePublishedVersion,
        requireBotMenu,
        requiredBotMenuEventKeys,
        execFileFn,
        env,
        cwd,
      });
    } catch {
      // See SDK path above: an unavailable management endpoint is a manual-check
      // condition, not proof that the bot credentials themselves are invalid.
    }
  }
  return {
    authenticated: true,
    botAvailable: true,
    botOpenIdAvailable: Boolean(normalizeText(bot?.openId || bot?.open_id)),
    scopeBaseline,
    applicationBaseline,
  };
}

function addManualCheck(manualChecks, id, description) {
  if (!manualChecks.some((item) => item.id === id)) manualChecks.push({ id, description });
}

function applyRemoteBaselineFindings({
  result,
  errors,
  warnings,
  manualChecks,
  requiredEvents,
  requiredCallbacks,
  requiredSlashCommands,
  requirePublishedVersion,
  requireBotMenu,
  requiredBotMenuEventKeys,
}) {
  let code = null;
  const scopeBaseline = result.scopeBaseline;
  if (scopeBaseline?.missing?.length) {
    errors.push(`Missing required Lark tenant scopes: ${scopeBaseline.missing.join(', ')}.`);
    code ||= 'lark_scope_missing';
  }

  const auditRequired = applicationAuditRequested({
    requiredEvents,
    requiredCallbacks,
    requiredSlashCommands,
    requirePublishedVersion,
    requireBotMenu,
    requiredBotMenuEventKeys,
  });
  const application = result.applicationBaseline;
  if (auditRequired && !application?.checked) {
    warnings.push('Published Lark application configuration could not be verified through the read-only application API.');
    addManualCheck(
      manualChecks,
      'published_application_configuration',
      'Confirm the published bot version, subscription mode, required events, card callbacks, and bot menu in the Lark developer console.',
    );
    return code;
  }
  if (!application?.checked) return code;

  if (application.requirePublishedVersion && !application.publishedVersionAvailable) {
    errors.push('No published Lark application version is available.');
    code ||= 'lark_published_version_missing';
  }
  if (application.publishedVersionAvailable && !application.botAbilityAvailable) {
    errors.push('The published Lark application version does not enable the bot capability.');
    code ||= 'lark_published_bot_missing';
  }

  if (!application.subscription.checked) {
    addManualCheck(
      manualChecks,
      'subscription_mode',
      `Confirm that event and callback delivery use ${application.subscription.expected} for the selected transport.`,
    );
  } else if (!application.subscription.ok) {
    errors.push(`Lark event/callback delivery uses ${application.subscription.actual}; expected ${application.subscription.expected} for the selected transport.`);
    code ||= 'lark_subscription_mode_mismatch';
  }
  if (application.subscription.expected === 'webhook'
    && application.subscription.checked
    && !application.subscription.requestUrlConfigured) {
    errors.push('The published Lark webhook configuration has no callback request URL.');
    code ||= 'lark_webhook_url_missing';
  }

  if (application.events.requiredCount && !application.events.checked) {
    addManualCheck(
      manualChecks,
      'event_subscriptions',
      'Confirm every required event subscription in the published Lark application version.',
    );
  } else if (application.events.missing.length) {
    errors.push(`Missing required Lark published events: ${application.events.missing.join(', ')}.`);
    code ||= 'lark_event_missing';
  }

  if (application.callbacks.requiredCount && !application.callbacks.checked) {
    addManualCheck(
      manualChecks,
      'card_callback_subscription',
      `Confirm the required card callbacks in the Lark developer console: ${normalizeRequiredValues(requiredCallbacks).join(', ')}.`,
    );
  } else if (application.callbacks.missing.length) {
    errors.push(`Missing required Lark card callbacks: ${application.callbacks.missing.join(', ')}.`);
    code ||= 'lark_callback_missing';
  }

  if (application.botMenu.required
    && (!application.botMenu.enabled || application.botMenu.itemCount === 0)) {
    errors.push('The published Lark bot menu is not enabled or contains no menu items.');
    code ||= 'lark_bot_menu_missing';
  } else if (application.botMenu.missingEventKeys.length) {
    errors.push(`Missing required Lark bot-menu event keys: ${application.botMenu.missingEventKeys.join(', ')}.`);
    code ||= 'lark_bot_menu_event_key_missing';
  }
  if (application.slashCommands.requiredCount && !application.slashCommands.checked) {
    errors.push('The Lark native slash-command registry could not be verified; grant application:app_slash_command:read and run the read-only sync command to inspect drift.');
    code ||= 'lark_slash_commands_unverified';
  } else if (application.slashCommands.missing.length || application.slashCommands.outdated.length) {
    const details = [
      application.slashCommands.missing.length
        ? `${application.slashCommands.missing.length} missing`
        : '',
      application.slashCommands.outdated.length
        ? `${application.slashCommands.outdated.length} outdated`
        : '',
    ].filter(Boolean).join(', ');
    errors.push(`Lark native slash-command registry is out of date (${details}); run npm run sync:lark-commands and review before applying.`);
    code ||= 'lark_slash_commands_outdated';
  }
  return code;
}

export async function collectLarkReadiness({
  inspection,
  verifyCredentials = false,
  requireAccessAllowlist = false,
  requiredTenantScopes = [],
  requiredEvents = [],
  requiredCallbacks = [],
  requiredSlashCommands = [],
  requirePublishedVersion = false,
  requireBotMenu = false,
  requiredBotMenuEventKeys = [],
  importSdkFn = () => import('@larksuiteoapi/node-sdk'),
  execFileFn = execFileAsync,
  fetchFn = globalThis.fetch,
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  if (!inspection?.config) throw new TypeError('Lark readiness requires an inspected runtime config.');
  const config = inspection.config;
  const errors = [...(inspection.errors || [])];
  const warnings = [...(inspection.warnings || [])];
  const manualChecks = [];
  const accessConfigured = [
    config.access?.allowedChatCount,
    config.access?.allowedTenantCount,
    config.access?.allowedUserCount,
  ].some((count) => Number(count) > 0);
  const checks = {
    localDependency: { ok: false, kind: config.transport === 'cli' ? 'cli' : 'sdk' },
    accessPolicy: {
      required: Boolean(requireAccessAllowlist),
      configured: accessConfigured,
    },
    credentials: { checked: false, ok: null },
    application: unavailableApplicationBaseline({
      requiredEvents,
      requiredCallbacks,
      requiredSlashCommands,
      requirePublishedVersion,
      requireBotMenu,
      requiredBotMenuEventKeys,
    }),
  };

  if (!errors.length) {
    try {
      if (config.transport === 'cli') {
        await execFileFn(config.cliBin, ['--version'], {
          cwd,
          env: {
            ...env,
            LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
            LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
          },
          maxBuffer: 1024 * 1024,
        });
      } else {
        const sdk = await importSdkFn();
        if (typeof sdk?.createLarkChannel !== 'function') {
          throw new TypeError('installed SDK does not export createLarkChannel().');
        }
      }
      checks.localDependency.ok = true;
    } catch {
      errors.push(config.transport === 'cli'
        ? 'LARK_CLI_BIN is not executable; install lark-cli or configure its absolute path.'
        : 'The installed @larksuiteoapi/node-sdk cannot be imported with createLarkChannel().');
    }
  }

  if (verifyCredentials && !errors.length) {
    checks.credentials.checked = true;
    try {
      const result = config.transport === 'cli'
        ? await verifyLarkCliCredentials({
          config,
          requiredTenantScopes,
          requiredEvents,
          requiredCallbacks,
          requiredSlashCommands,
          requirePublishedVersion,
          requireBotMenu,
          requiredBotMenuEventKeys,
          execFileFn,
          env,
          cwd,
        })
        : await verifyLarkSdkCredentials({
          config,
          requiredTenantScopes,
          requiredEvents,
          requiredCallbacks,
          requiredSlashCommands,
          requirePublishedVersion,
          requireBotMenu,
          requiredBotMenuEventKeys,
          fetchFn,
        });
      const { applicationBaseline, ...credentialResult } = result;
      checks.application = applicationBaseline;
      const remoteErrorStart = errors.length;
      const code = applyRemoteBaselineFindings({
        result,
        errors,
        warnings,
        manualChecks,
        requiredEvents,
        requiredCallbacks,
        requiredSlashCommands,
        requirePublishedVersion,
        requireBotMenu,
        requiredBotMenuEventKeys,
      });
      checks.credentials = {
        checked: true,
        ok: errors.length === remoteErrorStart,
        ...(code ? { code } : {}),
        ...credentialResult,
      };
    } catch (error) {
      checks.credentials = {
        checked: true,
        ok: false,
        code: normalizeText(error?.code) || 'credential_verification_failed',
      };
      errors.push(config.transport === 'cli'
        ? 'lark-cli credential verification failed; run auth login/status for the selected profile.'
        : 'Lark app credential or bot-capability verification failed.');
    }
  }

  if (requireAccessAllowlist && !accessConfigured) {
    errors.push('No Lark access allowlist is configured; set LARK_ALLOWED_CHAT_IDS, LARK_ALLOWED_TENANT_IDS, or LARK_ALLOWED_USER_IDS before credential-verified deployment checks can pass.');
  }

  addManualCheck(
    manualChecks,
    'isolated_end_to_end_smoke',
    'Before production, start exactly one consumer with restrictive allowlists and complete the isolated-chat smoke checklist.',
  );

  return {
    ok: errors.length === 0,
    provider: normalizeText(inspection.botProvider) || null,
    config: {
      requestedTransport: config.requestedTransport,
      transport: config.transport,
      domain: config.domain,
      credentials: {
        appIdConfigured: Boolean(config.appId),
        appSecretConfigured: Boolean(config.appSecret),
        webhookVerificationTokenConfigured: Boolean(config.webhook.verificationToken),
        webhookEncryptKeyConfigured: Boolean(config.webhook.encryptKey),
        cliProfileConfigured: Boolean(config.cliProfile),
      },
      webhook: config.transport === 'webhook' ? {
        host: config.webhook.host,
        port: config.webhook.port,
        path: config.webhook.path,
        healthPath: config.webhook.healthPath,
        maxBodyBytes: config.webhook.maxBodyBytes,
        headersTimeoutMs: config.webhook.headersTimeoutMs,
        requestTimeoutMs: config.webhook.requestTimeoutMs,
        keepAliveTimeoutMs: config.webhook.keepAliveTimeoutMs,
      } : null,
      safety: { ...config.safety },
      outbound: { ...config.outbound },
      access: { ...config.access },
    },
    checks,
    errors,
    warnings,
    manualChecks,
  };
}
