import test from 'node:test';
import assert from 'node:assert/strict';

import { collectLarkReadiness } from '../src/lark-readiness.js';
import { inspectLarkRuntimeConfig } from '../src/lark-runtime-config.js';

function sdkInspection() {
  return inspectLarkRuntimeConfig({
    botProvider: 'codex',
    env: {
      LARK_TRANSPORT: 'sdk',
      LARK_APP_ID: 'cli_test_app',
      LARK_APP_SECRET: 'super-secret-value',
      LARK_ALLOWED_USER_IDS: 'ou_tester',
    },
  });
}

test('Lark readiness validates the local SDK without exposing credentials', async () => {
  const report = await collectLarkReadiness({
    inspection: sdkInspection(),
    importSdkFn: async () => ({ createLarkChannel() {} }),
  });

  assert.equal(report.ok, true);
  assert.equal(report.provider, 'codex');
  assert.deepEqual(report.checks.localDependency, { ok: true, kind: 'sdk' });
  assert.equal(report.checks.credentials.checked, false);
  assert.equal(report.config.credentials.appIdConfigured, true);
  assert.equal(JSON.stringify(report).includes('super-secret-value'), false);
  assert.equal(JSON.stringify(report).includes('cli_test_app'), false);
});

test('Lark readiness reports a distinct webhook health endpoint without exposing secrets', async () => {
  const inspection = inspectLarkRuntimeConfig({
    env: {
      LARK_TRANSPORT: 'webhook',
      LARK_APP_ID: 'cli_test_app',
      LARK_APP_SECRET: 'super-secret-value',
      LARK_WEBHOOK_VERIFICATION_TOKEN: 'verification-token-secret',
      LARK_WEBHOOK_HEALTH_PATH: '/readyz',
      LARK_WEBHOOK_HEADERS_TIMEOUT_MS: '8000',
      LARK_WEBHOOK_REQUEST_TIMEOUT_MS: '11000',
      LARK_WEBHOOK_KEEP_ALIVE_TIMEOUT_MS: '2500',
      LARK_ALLOWED_USER_IDS: 'ou_tester',
    },
  });
  const report = await collectLarkReadiness({
    inspection,
    importSdkFn: async () => ({ createLarkChannel() {} }),
  });

  assert.equal(report.ok, true);
  assert.equal(report.config.webhook.path, '/lark/events');
  assert.equal(report.config.webhook.healthPath, '/readyz');
  assert.equal(report.config.webhook.headersTimeoutMs, 8000);
  assert.equal(report.config.webhook.requestTimeoutMs, 11000);
  assert.equal(report.config.webhook.keepAliveTimeoutMs, 2500);
  assert.equal(JSON.stringify(report).includes('verification-token-secret'), false);
  assert.equal(JSON.stringify(report).includes('super-secret-value'), false);
});

test('credential-verified Lark readiness requires an allowlist without skipping remote verification', async () => {
  const requests = [];
  const responses = [
    { code: 0, tenant_access_token: 'tenant-token-secret' },
    { code: 0, bot: { open_id: 'ou_bot' } },
  ];
  const inspection = inspectLarkRuntimeConfig({
    env: {
      LARK_TRANSPORT: 'sdk',
      LARK_APP_ID: 'cli_test_app',
      LARK_APP_SECRET: 'super-secret-value',
    },
  });
  const report = await collectLarkReadiness({
    inspection,
    verifyCredentials: true,
    requireAccessAllowlist: true,
    importSdkFn: async () => ({ createLarkChannel() {} }),
    async fetchFn(url) {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        async json() { return responses.shift(); },
      };
    },
  });

  assert.equal(requests.length, 2);
  assert.equal(report.checks.credentials.ok, true);
  assert.deepEqual(report.checks.accessPolicy, { required: true, configured: false });
  assert.equal(report.ok, false);
  assert.equal(report.errors.some((error) => error.includes('LARK_ALLOWED_CHAT_IDS')), true);
  assert.equal(JSON.stringify(report).includes('tenant-token-secret'), false);
});

test('Lark readiness can verify SDK credentials and bot capability read-only', async () => {
  const requests = [];
  const responses = [
    { code: 0, tenant_access_token: 'tenant-token-secret' },
    { code: 0, bot: { open_id: 'ou_bot' } },
    {
      code: 0,
      data: {
        scopes: [
          { scope_type: 'tenant', scope_name: 'im:message:send_as_bot', grant_status: 1 },
          { scope_type: 'tenant', scope_name: 'im:message:update', grant_status: 1 },
        ],
      },
    },
  ];
  const report = await collectLarkReadiness({
    inspection: sdkInspection(),
    verifyCredentials: true,
    requiredTenantScopes: ['im:message:send_as_bot', 'im:message:update'],
    importSdkFn: async () => ({ createLarkChannel() {} }),
    async fetchFn(url, options) {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() { return responses.shift(); },
      };
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.checks.credentials.ok, true);
  assert.equal(report.checks.credentials.botAvailable, true);
  assert.equal(requests[0].url.endsWith('/auth/v3/tenant_access_token/internal'), true);
  assert.equal(requests[1].url.endsWith('/bot/v3/info'), true);
  assert.equal(requests[1].options.headers.authorization, 'Bearer tenant-token-secret');
  assert.equal(requests[2].url.endsWith('/application/v6/scopes'), true);
  assert.deepEqual(report.checks.credentials.scopeBaseline, {
    checked: true,
    requiredCount: 2,
    grantedCount: 2,
    missing: [],
  });
  assert.equal(JSON.stringify(report).includes('tenant-token-secret'), false);
});

test('Lark readiness verifies the selected CLI profile without starting consumers', async () => {
  const calls = [];
  const inspection = inspectLarkRuntimeConfig({
    env: {
      LARK_TRANSPORT: 'cli',
      LARK_CLI_BIN: '/opt/bin/lark-cli',
      LARK_CLI_PROFILE: 'smoke',
      LARK_ALLOWED_CHAT_IDS: 'oc_test',
    },
  });
  const report = await collectLarkReadiness({
    inspection,
    verifyCredentials: true,
    async execFileFn(bin, args) {
      calls.push({ bin, args });
      if (args.includes('auth')) {
        return {
          stdout: JSON.stringify({
            identities: { bot: { available: true, status: 'ready', openId: 'ou_bot' } },
          }),
        };
      }
      if (args.includes('/open-apis/application/v6/scopes')) {
        return {
          stdout: JSON.stringify({
            data: {
              scopes: [
                { scope_type: 'tenant', scope_name: 'im:message:send_as_bot', grant_status: 1 },
              ],
            },
          }),
        };
      }
      return { stdout: 'lark-cli version 1.0.77' };
    },
    requiredTenantScopes: ['im:message:send_as_bot'],
  });

  assert.equal(report.ok, true);
  assert.deepEqual(calls[0], { bin: '/opt/bin/lark-cli', args: ['--version'] });
  assert.deepEqual(calls[1], {
    bin: '/opt/bin/lark-cli',
    args: ['--profile', 'smoke', 'auth', 'status', '--verify', '--json'],
  });
  assert.deepEqual(calls[2], {
    bin: '/opt/bin/lark-cli',
    args: [
      '--profile',
      'smoke',
      'api',
      'GET',
      '/open-apis/application/v6/scopes',
      '--as',
      'bot',
      '--json',
    ],
  });
  assert.equal(report.checks.credentials.botOpenIdAvailable, true);
});

test('Lark readiness keeps credential failures generic and secret-free', async () => {
  const report = await collectLarkReadiness({
    inspection: sdkInspection(),
    verifyCredentials: true,
    importSdkFn: async () => ({ createLarkChannel() {} }),
    async fetchFn() {
      return {
        ok: true,
        status: 200,
        async json() { return { code: 10003, msg: 'invalid app secret super-secret-value' }; },
      };
    },
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks.credentials.ok, false);
  assert.equal(report.errors.includes('Lark app credential or bot-capability verification failed.'), true);
  assert.equal(JSON.stringify(report).includes('super-secret-value'), false);
});

test('Lark readiness rejects credential checks without a usable bot open ID', async () => {
  const responses = [
    { code: 0, tenant_access_token: 'tenant-token-secret' },
    { code: 0, bot: { app_name: 'Missing ID' } },
  ];
  const report = await collectLarkReadiness({
    inspection: sdkInspection(),
    verifyCredentials: true,
    importSdkFn: async () => ({ createLarkChannel() {} }),
    async fetchFn() {
      return {
        ok: true,
        status: 200,
        async json() { return responses.shift(); },
      };
    },
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks.credentials.code, 'lark_bot_identity_unavailable');
});

test('Lark readiness reports missing required tenant scopes without exposing credentials', async () => {
  const responses = [
    { code: 0, tenant_access_token: 'tenant-token-secret' },
    { code: 0, bot: { open_id: 'ou_bot' } },
    {
      code: 0,
      data: {
        scopes: [
          { scope_type: 'tenant', scope_name: 'im:message:send_as_bot', grant_status: 1 },
          { scope_type: 'user', scope_name: 'im:message:recall', grant_status: 1 },
        ],
      },
    },
  ];
  const report = await collectLarkReadiness({
    inspection: sdkInspection(),
    verifyCredentials: true,
    requiredTenantScopes: ['im:message:send_as_bot', 'im:message:recall'],
    importSdkFn: async () => ({ createLarkChannel() {} }),
    async fetchFn() {
      return {
        ok: true,
        status: 200,
        async json() { return responses.shift(); },
      };
    },
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks.credentials.code, 'lark_scope_missing');
  assert.deepEqual(report.checks.credentials.scopeBaseline.missing, ['im:message:recall']);
  assert.equal(report.errors.includes('Missing required Lark tenant scopes: im:message:recall.'), true);
  assert.equal(JSON.stringify(report).includes('tenant-token-secret'), false);
});

test('Lark readiness audits the published SDK application without exposing app or version ids', async () => {
  const requests = [];
  const responses = [
    { code: 0, tenant_access_token: 'tenant-token-secret' },
    { code: 0, bot: { open_id: 'ou_bot' } },
    {
      code: 0,
      data: {
        scopes: [
          { scope_type: 'tenant', scope_name: 'im:message:send_as_bot', grant_status: 1 },
        ],
      },
    },
    {
      code: 0,
      data: {
        app: {
          app_id: 'cli_test_app',
          online_version_id: 'ver_private_1',
          callback_info: {
            callback_type: 'websocket',
            subscribed_callbacks: ['card.action.trigger'],
          },
        },
      },
    },
    {
      code: 0,
      data: {
        app_version: {
          version_id: 'ver_private_1',
          event_infos: [
            { event_type: 'im.message.receive_v1' },
            { event_type: 'application.bot.menu_v6' },
          ],
          ability: {
            bot: {
              bot_menu_enable: true,
              bot_menus: [{ menu_id: 'menu_private_1', event_key: 'status' }],
            },
          },
        },
      },
    },
    {
      code: 0,
      data: {
        items: [
          {
            command_id: 'cmd_private_1',
            command: 'cx_status',
            description: { default_value: '查看状态' },
          },
        ],
      },
    },
  ];
  const report = await collectLarkReadiness({
    inspection: sdkInspection(),
    verifyCredentials: true,
    requiredTenantScopes: ['im:message:send_as_bot'],
    requiredEvents: ['im.message.receive_v1', 'application.bot.menu_v6'],
    requiredCallbacks: ['card.action.trigger'],
    requiredSlashCommands: [{ command: 'cx_status', description: '查看状态' }],
    requirePublishedVersion: true,
    requireBotMenu: true,
    requiredBotMenuEventKeys: ['status'],
    importSdkFn: async () => ({ createLarkChannel() {} }),
    async fetchFn(url, options) {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() { return responses.shift(); },
      };
    },
  });

  assert.equal(report.ok, true);
  assert.equal(requests[3].url.endsWith('/applications/cli_test_app?lang=zh_cn'), true);
  assert.equal(requests[4].url.endsWith('/applications/cli_test_app/app_versions/ver_private_1?lang=zh_cn'), true);
  assert.equal(requests[5].url.endsWith('/application/v7/app_slash_commands'), true);
  assert.equal(report.checks.application.publishedVersionAvailable, true);
  assert.deepEqual(report.checks.application.subscription, {
    checked: true,
    expected: 'websocket',
    actual: 'websocket',
    ok: true,
    requestUrlConfigured: null,
  });
  assert.deepEqual(report.checks.application.events, {
    checked: true,
    requiredCount: 2,
    configuredCount: 2,
    matchedCount: 2,
    missing: [],
  });
  assert.deepEqual(report.checks.application.callbacks, {
    checked: true,
    requiredCount: 1,
    configuredCount: 1,
    matchedCount: 1,
    missing: [],
  });
  assert.deepEqual(report.checks.application.botMenu, {
    required: true,
    checked: true,
    enabled: true,
    itemCount: 1,
    requiredEventKeyCount: 1,
    eventKeyCount: 1,
    matchedEventKeyCount: 1,
    missingEventKeys: [],
    ok: true,
  });
  assert.deepEqual(report.checks.application.slashCommands, {
    checked: true,
    requiredCount: 1,
    installedCount: 1,
    matchedCount: 1,
    missing: [],
    outdated: [],
    extraCount: 0,
  });
  assert.equal(report.manualChecks.some((item) => item.id === 'isolated_end_to_end_smoke'), true);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('cli_test_app'), false);
  assert.equal(serialized.includes('ver_private_1'), false);
  assert.equal(serialized.includes('menu_private_1'), false);
  assert.equal(serialized.includes('cmd_private_1'), false);
  assert.equal(serialized.includes('tenant-token-secret'), false);
});

test('Lark readiness reports missing published menu configuration and keeps unobservable callbacks manual', async () => {
  const responses = [
    { code: 0, tenant_access_token: 'tenant-token-secret' },
    { code: 0, bot: { open_id: 'ou_bot' } },
    {
      code: 0,
      data: {
        app: {
          online_version_id: 'ver_private_2',
          callback_info: { callback_type: 'websocket' },
        },
      },
    },
    {
      code: 0,
      data: {
        app_version: {
          event_infos: [{ event_type: 'im.message.receive_v1' }],
          ability: { bot: {} },
        },
      },
    },
  ];
  const report = await collectLarkReadiness({
    inspection: sdkInspection(),
    verifyCredentials: true,
    requiredEvents: ['im.message.receive_v1', 'application.bot.menu_v6'],
    requiredCallbacks: ['card.action.trigger'],
    requirePublishedVersion: true,
    requireBotMenu: true,
    importSdkFn: async () => ({ createLarkChannel() {} }),
    async fetchFn() {
      return {
        ok: true,
        status: 200,
        async json() { return responses.shift(); },
      };
    },
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks.credentials.code, 'lark_event_missing');
  assert.deepEqual(report.checks.application.events.missing, ['application.bot.menu_v6']);
  assert.equal(report.checks.application.callbacks.checked, false);
  assert.equal(report.errors.includes('Missing required Lark published events: application.bot.menu_v6.'), true);
  assert.equal(report.errors.includes('The published Lark bot menu is not enabled or contains no menu items.'), true);
  assert.equal(report.manualChecks.some((item) => item.id === 'card_callback_subscription'), true);
});

test('Lark readiness rejects an enabled bot menu with missing required event keys', async () => {
  const responses = [
    { code: 0, tenant_access_token: 'tenant-token-secret' },
    { code: 0, bot: { open_id: 'ou_bot' } },
    {
      code: 0,
      data: {
        app: {
          online_version_id: 'ver_private_menu_keys',
          callback_info: { callback_type: 'websocket' },
        },
      },
    },
    {
      code: 0,
      data: {
        app_version: {
          event_infos: [{ event_type: 'application.bot.menu_v6' }],
          ability: {
            bot: {
              bot_menu_enable: true,
              bot_menus: [{ menu_id: 'menu_private_wrong', event_key: 'unknown_command' }],
            },
          },
        },
      },
    },
  ];
  const report = await collectLarkReadiness({
    inspection: sdkInspection(),
    verifyCredentials: true,
    requiredEvents: ['application.bot.menu_v6'],
    requirePublishedVersion: true,
    requireBotMenu: true,
    requiredBotMenuEventKeys: ['status', 'settings'],
    importSdkFn: async () => ({ createLarkChannel() {} }),
    async fetchFn() {
      return {
        ok: true,
        status: 200,
        async json() { return responses.shift(); },
      };
    },
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks.credentials.code, 'lark_bot_menu_event_key_missing');
  assert.deepEqual(report.checks.application.botMenu, {
    required: true,
    checked: true,
    enabled: true,
    itemCount: 1,
    requiredEventKeyCount: 2,
    eventKeyCount: 1,
    matchedEventKeyCount: 0,
    missingEventKeys: ['settings', 'status'],
    ok: false,
  });
  assert.equal(report.errors.includes('Missing required Lark bot-menu event keys: settings, status.'), true);
  assert.equal(JSON.stringify(report).includes('menu_private_wrong'), false);
});

test('Lark readiness audits the CLI profile published application with read-only GET requests', async () => {
  const calls = [];
  const inspection = inspectLarkRuntimeConfig({
    env: {
      LARK_TRANSPORT: 'cli',
      LARK_CLI_BIN: '/opt/bin/lark-cli',
      LARK_CLI_PROFILE: 'smoke',
      LARK_ALLOWED_CHAT_IDS: 'oc_test',
    },
  });
  const report = await collectLarkReadiness({
    inspection,
    verifyCredentials: true,
    requiredEvents: ['im.message.receive_v1'],
    requiredCallbacks: ['card.action.trigger'],
    requiredSlashCommands: [{ command: 'cx_status', description: 'Status' }],
    requirePublishedVersion: true,
    async execFileFn(bin, args) {
      calls.push({ bin, args });
      if (args.includes('--version')) return { stdout: 'lark-cli version 1.0.77' };
      if (args.includes('auth')) {
        return {
          stdout: JSON.stringify({
            appId: 'cli_profile_private',
            identities: { bot: { available: true, status: 'ready', openId: 'ou_bot' } },
          }),
        };
      }
      if (args.some((arg) => arg.endsWith('/app_versions/ver_profile_private'))) {
        return {
          stdout: JSON.stringify({
            data: {
              app_version: {
                event_infos: [{ event_type: 'im.message.receive_v1' }],
                ability: { bot: {} },
              },
            },
          }),
        };
      }
      if (args.includes('/open-apis/application/v7/app_slash_commands')) {
        return {
          stdout: JSON.stringify({
            data: {
              items: [{
                command_id: 'cmd_profile_private',
                command: 'cx_status',
                description: { default_value: 'Status' },
              }],
            },
          }),
        };
      }
      if (args.some((arg) => arg.endsWith('/applications/cli_profile_private'))) {
        return {
          stdout: JSON.stringify({
            data: {
              app: {
                online_version_id: 'ver_profile_private',
                callback_info: {
                  callback_type: 'websocket',
                  subscribed_callbacks: ['card.action.trigger'],
                },
              },
            },
          }),
        };
      }
      throw new Error('unexpected lark-cli call');
    },
  });

  assert.equal(report.ok, true);
  assert.equal(calls.length, 5);
  assert.deepEqual(calls[2].args.slice(0, 7), [
    '--profile',
    'smoke',
    'api',
    'GET',
    '/open-apis/application/v6/applications/cli_profile_private',
    '--as',
    'bot',
  ]);
  assert.equal(calls[2].args.includes(JSON.stringify({ lang: 'zh_cn' })), true);
  assert.equal(calls[3].args.some((arg) => arg.endsWith('/app_versions/ver_profile_private')), true);
  assert.equal(calls[4].args.includes('/open-apis/application/v7/app_slash_commands'), true);
  assert.equal(report.checks.application.events.matchedCount, 1);
  assert.equal(report.checks.application.callbacks.matchedCount, 1);
  assert.equal(report.checks.application.slashCommands.matchedCount, 1);
  assert.equal(JSON.stringify(report).includes('cli_profile_private'), false);
  assert.equal(JSON.stringify(report).includes('ver_profile_private'), false);
  assert.equal(JSON.stringify(report).includes('cmd_profile_private'), false);
});

test('Lark readiness reports native slash-command drift without exposing command ids', async () => {
  const responses = [
    { code: 0, tenant_access_token: 'tenant-token-secret' },
    { code: 0, bot: { open_id: 'ou_bot' } },
    {
      code: 0,
      data: {
        app: {
          online_version_id: 'ver_private_3',
          callback_info: { callback_type: 'websocket' },
        },
      },
    },
    {
      code: 0,
      data: {
        app_version: {
          event_infos: [{ event_type: 'im.message.receive_v1' }],
          ability: { bot: {} },
        },
      },
    },
    {
      code: 0,
      data: {
        items: [{
          command_id: 'cmd_private_drift',
          command: 'cx_status',
          description: { default_value: 'Old status' },
        }],
      },
    },
  ];
  const report = await collectLarkReadiness({
    inspection: sdkInspection(),
    verifyCredentials: true,
    requiredEvents: ['im.message.receive_v1'],
    requiredSlashCommands: [
      { command: 'cx_status', description: 'Status' },
      { command: 'cx_settings', description: 'Settings' },
    ],
    requirePublishedVersion: true,
    importSdkFn: async () => ({ createLarkChannel() {} }),
    async fetchFn() {
      return {
        ok: true,
        status: 200,
        async json() { return responses.shift(); },
      };
    },
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks.credentials.code, 'lark_slash_commands_outdated');
  assert.deepEqual(report.checks.application.slashCommands.missing, ['cx_settings']);
  assert.deepEqual(report.checks.application.slashCommands.outdated, ['cx_status']);
  assert.equal(report.errors.some((error) => error.includes('1 missing, 1 outdated')), true);
  assert.equal(JSON.stringify(report).includes('cmd_private_drift'), false);
});

test('Lark readiness fails when a required native slash-command registry cannot be verified', async () => {
  const responses = [
    { code: 0, tenant_access_token: 'tenant-token-secret' },
    { code: 0, bot: { open_id: 'ou_bot' } },
    {
      code: 0,
      data: {
        app: {
          online_version_id: 'ver_private_unverified',
          callback_info: { callback_type: 'websocket' },
        },
      },
    },
    {
      code: 0,
      data: {
        app_version: {
          event_infos: [{ event_type: 'im.message.receive_v1' }],
          ability: { bot: {} },
        },
      },
    },
    { code: 99991672, msg: 'permission denied' },
  ];
  const report = await collectLarkReadiness({
    inspection: sdkInspection(),
    verifyCredentials: true,
    requiredEvents: ['im.message.receive_v1'],
    requiredSlashCommands: [{ command: 'cx_status', description: 'Status' }],
    requirePublishedVersion: true,
    importSdkFn: async () => ({ createLarkChannel() {} }),
    async fetchFn() {
      return {
        ok: true,
        status: 200,
        async json() { return responses.shift(); },
      };
    },
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks.credentials.code, 'lark_slash_commands_unverified');
  assert.equal(report.checks.application.slashCommands.checked, false);
  assert.equal(report.errors.some((error) => error.includes('application:app_slash_command:read')), true);
  assert.equal(report.manualChecks.some((item) => item.id === 'native_slash_commands'), false);
  assert.equal(JSON.stringify(report).includes('ver_private_unverified'), false);
});

test('Lark readiness makes unavailable application-management evidence an explicit manual check', async () => {
  const responses = [
    { code: 0, tenant_access_token: 'tenant-token-secret' },
    { code: 0, bot: { open_id: 'ou_bot' } },
    { code: 99992402, msg: 'invalid parameters' },
  ];
  const report = await collectLarkReadiness({
    inspection: sdkInspection(),
    verifyCredentials: true,
    requiredEvents: ['im.message.receive_v1'],
    requirePublishedVersion: true,
    importSdkFn: async () => ({ createLarkChannel() {} }),
    async fetchFn() {
      return {
        ok: true,
        status: 200,
        async json() { return responses.shift(); },
      };
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.checks.credentials.ok, true);
  assert.equal(report.checks.application.checked, false);
  assert.equal(report.warnings.includes('Published Lark application configuration could not be verified through the read-only application API.'), true);
  assert.equal(report.manualChecks.some((item) => item.id === 'published_application_configuration'), true);
});
