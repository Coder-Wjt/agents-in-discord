import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  inspectLarkRuntimeConfig,
  resolveLarkRuntimeConfig,
} from '../src/lark-runtime-config.js';

test('Lark runtime config defaults to CLI without SDK credentials', () => {
  const inspection = inspectLarkRuntimeConfig({ env: {} });

  assert.deepEqual(inspection.errors, []);
  assert.equal(inspection.config.requestedTransport, 'auto');
  assert.equal(inspection.config.transport, 'cli');
  assert.equal(inspection.config.domain, 'feishu');
  assert.equal(inspection.config.cliBin, 'lark-cli');
  assert.equal(inspection.config.safety.handshakeTimeoutMs, 30000);
  assert.equal(inspection.config.safety.eventDedupWindowMs, 43200000);
  assert.equal(inspection.config.outbound.textChunkLimit, 4000);
  assert.equal(inspection.warnings.some((item) => item.includes('allowlist')), true);
});

test('Lark runtime config applies provider-scoped SDK settings and bounded values', () => {
  const inspection = inspectLarkRuntimeConfig({
    botProvider: 'codex',
    env: {
      LARK_TRANSPORT: 'cli',
      CODEX__LARK_TRANSPORT: 'sdk',
      CODEX__LARK_APP_ID: 'cli_test_app',
      CODEX__LARK_APP_SECRET: 'real-application-secret',
      CODEX__LARK_DOMAIN: 'lark',
      CODEX__LARK_HANDSHAKE_TIMEOUT_MS: '45000',
      CODEX__LARK_EVENT_DEDUP_MAX_ENTRIES: '8000',
      CODEX__LARK_ALLOWED_CHAT_IDS: 'oc_1,oc_2,oc_1',
    },
  });

  assert.deepEqual(inspection.errors, []);
  assert.equal(inspection.botProvider, 'codex');
  assert.equal(inspection.config.transport, 'sdk');
  assert.equal(inspection.config.domain, 'lark');
  assert.equal(inspection.config.safety.handshakeTimeoutMs, 45000);
  assert.equal(inspection.config.safety.eventDedupMaxEntries, 8000);
  assert.equal(inspection.config.access.allowedChatCount, 2);
  assert.equal(inspection.warnings.some((item) => item.includes('allowlist')), false);
});

test('Lark runtime config reports invalid transports, placeholders, paths, and numbers', () => {
  const inspection = inspectLarkRuntimeConfig({
    env: {
      LARK_TRANSPORT: 'webhook',
      LARK_APP_ID: 'cli_xxx',
      LARK_APP_SECRET: '...',
      LARK_DOMAIN: 'unknown',
      LARK_WEBHOOK_VERIFICATION_TOKEN: 'replace-me',
      LARK_WEBHOOK_ENCRYPT_KEY: 'your_encrypt_key',
      LARK_WEBHOOK_PATH: '/lark/events?token=bad',
      LARK_WEBHOOK_HEALTH_PATH: '/healthz?token=bad',
      LARK_WEBHOOK_PORT: '0',
      LARK_WEBHOOK_MAX_BODY_BYTES: '512',
      LARK_WEBHOOK_HEADERS_TIMEOUT_MS: '20000',
      LARK_WEBHOOK_REQUEST_TIMEOUT_MS: '10000',
      LARK_WEBHOOK_KEEP_ALIVE_TIMEOUT_MS: '500',
    },
  });

  assert.equal(inspection.errors.some((item) => item.includes('LARK_APP_ID')), true);
  assert.equal(inspection.errors.some((item) => item.includes('LARK_APP_SECRET')), true);
  assert.equal(inspection.errors.some((item) => item.includes('LARK_DOMAIN')), true);
  assert.equal(inspection.errors.some((item) => item.includes('VERIFICATION_TOKEN')), true);
  assert.equal(inspection.errors.some((item) => item.includes('ENCRYPT_KEY')), true);
  assert.equal(inspection.errors.some((item) => item.includes('query string')), true);
  assert.equal(inspection.errors.some((item) => item.includes('LARK_WEBHOOK_HEALTH_PATH')), true);
  assert.equal(inspection.errors.some((item) => item.includes('LARK_WEBHOOK_PORT')), true);
  assert.equal(inspection.errors.some((item) => item.includes('LARK_WEBHOOK_MAX_BODY_BYTES')), true);
  assert.equal(inspection.errors.some((item) => item.includes('HEADERS_TIMEOUT_MS must not exceed')), true);
  assert.equal(inspection.errors.some((item) => item.includes('LARK_WEBHOOK_KEEP_ALIVE_TIMEOUT_MS')), true);
  assert.throws(() => resolveLarkRuntimeConfig({ env: {
    LARK_TRANSPORT: 'sdk',
  } }), /LARK_APP_ID/);
});

test('Lark runtime config normalizes webhook paths and warns about public unencrypted listeners', () => {
  const inspection = inspectLarkRuntimeConfig({
    env: {
      LARK_TRANSPORT: 'webhook',
      LARK_APP_ID: 'cli_test_app',
      LARK_APP_SECRET: 'real-application-secret',
      LARK_WEBHOOK_VERIFICATION_TOKEN: 'verification-token-value',
      LARK_WEBHOOK_HOST: '0.0.0.0',
      LARK_WEBHOOK_PATH: 'lark/events',
      LARK_WEBHOOK_HEALTH_PATH: 'readyz',
      LARK_WEBHOOK_HEADERS_TIMEOUT_MS: '9000',
      LARK_WEBHOOK_REQUEST_TIMEOUT_MS: '12000',
      LARK_WEBHOOK_KEEP_ALIVE_TIMEOUT_MS: '3000',
      LARK_ALLOWED_USER_IDS: 'ou_tester',
    },
  });

  assert.deepEqual(inspection.errors, []);
  assert.equal(inspection.config.webhook.path, '/lark/events');
  assert.equal(inspection.config.webhook.healthPath, '/readyz');
  assert.equal(inspection.config.webhook.headersTimeoutMs, 9000);
  assert.equal(inspection.config.webhook.requestTimeoutMs, 12000);
  assert.equal(inspection.config.webhook.keepAliveTimeoutMs, 3000);
  assert.equal(inspection.warnings.some((item) => item.includes('encryption is disabled')), true);
  assert.equal(inspection.warnings.some((item) => item.includes('not loopback')), true);
});

test('Lark webhook callback and health paths must be distinct', () => {
  const inspection = inspectLarkRuntimeConfig({
    env: {
      LARK_TRANSPORT: 'webhook',
      LARK_APP_ID: 'cli_test_app',
      LARK_APP_SECRET: 'real-application-secret',
      LARK_WEBHOOK_VERIFICATION_TOKEN: 'verification-token-value',
      LARK_WEBHOOK_PATH: '/lark/events',
      LARK_WEBHOOK_HEALTH_PATH: '/lark/events',
      LARK_ALLOWED_USER_IDS: 'ou_tester',
    },
  });

  assert.equal(inspection.errors.some((item) => item.includes('must differ')), true);
});

test('unused webhook and domain values do not block CLI transport', () => {
  const inspection = inspectLarkRuntimeConfig({
    env: {
      LARK_TRANSPORT: 'cli',
      LARK_DOMAIN: 'unused-domain',
      LARK_WEBHOOK_PORT: 'invalid',
      LARK_WEBHOOK_PATH: '/unused?query=yes',
      LARK_WEBHOOK_HEALTH_PATH: '/unused?health=yes',
      LARK_WEBHOOK_ENCRYPT_KEY: 'replace-me',
      LARK_ALLOWED_USER_IDS: 'ou_tester',
    },
  });

  assert.deepEqual(inspection.errors, []);
  assert.equal(inspection.config.transport, 'cli');
});

test('the production composition root consumes the shared Lark runtime config', () => {
  const source = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

  assert.match(source, /inspectLarkRuntimeConfig/);
  assert.match(source, /textChunkLimit: LARK_RUNTIME_CONFIG\.outbound\.textChunkLimit/);
  assert.match(source, /healthPath: LARK_WEBHOOK_HEALTH_PATH/);
  assert.match(source, /headersTimeoutMs: LARK_WEBHOOK_HEADERS_TIMEOUT_MS/);
  assert.match(source, /requestTimeoutMs: LARK_WEBHOOK_REQUEST_TIMEOUT_MS/);
  assert.match(source, /keepAliveTimeoutMs: LARK_WEBHOOK_KEEP_ALIVE_TIMEOUT_MS/);
  assert.doesNotMatch(source, /process\.env\.LARK_/);
});
