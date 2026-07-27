#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { getDefaultSlashPrefix, parseOptionalProvider } from '../src/bot-instance-utils.js';
import { loadRuntimeEnv } from '../src/env-loader.js';
import { collectLarkReadiness } from '../src/lark-readiness.js';
import { inspectLarkRuntimeConfig } from '../src/lark-runtime-config.js';
import { buildLarkSlashCommandManifest } from '../src/lark-slash-commands.js';
import { configureRuntimeProxy } from '../src/runtime-bootstrap.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const appConfigPath = path.join(rootDir, 'docs', 'lark-app-config.v1.json');

function usage() {
  return [
    'Usage: npm run check:lark -- [--verify-credentials] [--json] [--provider <name>]',
    '',
    'Runs a read-only Lark deployment preflight without starting event consumers or sending messages.',
    'By default it validates effective configuration and the local SDK/CLI dependency.',
    '--verify-credentials additionally verifies credentials, tenant scopes, the published bot version, subscription mode, published events, bot-menu event keys, and requires at least one access allowlist.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { json: false, verifyCredentials: false, provider: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--verify-credentials' || arg === '--verify') options.verifyCredentials = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--provider') {
      index += 1;
      if (!argv[index]) throw new TypeError('--provider requires a value.');
      options.provider = argv[index];
    } else if (arg.startsWith('--provider=')) {
      options.provider = arg.slice('--provider='.length);
    } else {
      throw new TypeError(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function configureProvider(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return;
  if (normalized === 'shared') {
    delete process.env.BOT_PROVIDER;
    return;
  }
  const provider = parseOptionalProvider(normalized);
  if (!provider) throw new TypeError(`Unsupported provider: ${value}`);
  process.env.BOT_PROVIDER = provider;
}

function formatHuman(report) {
  const lines = [
    `${report.ok ? '✅' : '❌'} Lark automated readiness ${report.ok ? 'passed' : 'failed'}`,
    `• provider: ${report.provider || 'shared'}`,
    `• transport: ${report.config.requestedTransport} -> ${report.config.transport}`,
    `• domain: ${report.config.domain}`,
    `• local dependency: ${report.checks.localDependency.ok ? 'ok' : 'failed'} (${report.checks.localDependency.kind})`,
  ];
  if (report.config.transport === 'webhook') {
    lines.push(`• webhook: http://${report.config.webhook.host}:${report.config.webhook.port}${report.config.webhook.path}`);
    lines.push(`• webhook health: http://${report.config.webhook.host}:${report.config.webhook.port}${report.config.webhook.healthPath}`);
    lines.push(`• webhook encryption: ${report.config.credentials.webhookEncryptKeyConfigured ? 'configured' : 'off'}`);
    lines.push(`• webhook limits: body=${report.config.webhook.maxBodyBytes} bytes, headers=${report.config.webhook.headersTimeoutMs}ms, request=${report.config.webhook.requestTimeoutMs}ms, keep-alive=${report.config.webhook.keepAliveTimeoutMs}ms`);
  }
  lines.push(`• allowlists: chats=${report.config.access.allowedChatCount}, tenants=${report.config.access.allowedTenantCount}, users=${report.config.access.allowedUserCount}`);
  lines.push(report.checks.credentials.checked
    ? `• remote verification: ${report.checks.credentials.ok ? 'ok' : 'failed'}`
    : '• remote verification: skipped (add --verify-credentials for a read-only network check)');
  const scopeBaseline = report.checks.credentials.scopeBaseline;
  if (scopeBaseline?.checked) {
    lines.push(`• tenant scopes: ${scopeBaseline.grantedCount}/${scopeBaseline.requiredCount}`);
  }
  const application = report.checks.application;
  if (application?.checked) {
    lines.push(`• published bot version: ${application.publishedVersionAvailable ? 'available' : 'missing'}`);
    lines.push(application.subscription.checked
      ? `• delivery mode: ${application.subscription.actual} (expected ${application.subscription.expected})`
      : `• delivery mode: unverified (expected ${application.subscription.expected})`);
    if (application.events.requiredCount) {
      lines.push(`• published events: ${application.events.matchedCount}/${application.events.requiredCount}`);
    }
    if (application.callbacks.requiredCount) {
      lines.push(application.callbacks.checked
        ? `• card callbacks: ${application.callbacks.matchedCount}/${application.callbacks.requiredCount}`
        : '• card callbacks: not returned by the read-only application API');
    }
    if (application.botMenu.required) {
      if (application.botMenu.requiredEventKeyCount) {
        lines.push(`• bot menu: ${application.botMenu.ok ? 'enabled' : 'missing or incomplete'} (${application.botMenu.matchedEventKeyCount}/${application.botMenu.requiredEventKeyCount} event keys)`);
      } else {
        lines.push(`• bot menu: ${application.botMenu.ok ? `enabled (${application.botMenu.itemCount} items)` : 'missing or empty'}`);
      }
    }
    if (application.slashCommands.requiredCount) {
      lines.push(application.slashCommands.checked
        ? `• native slash commands: ${application.slashCommands.matchedCount}/${application.slashCommands.requiredCount}`
        : '• native slash commands: unverified');
    }
  } else if (report.checks.credentials.checked) {
    lines.push('• published application configuration: unverified');
  }
  if (report.warnings.length) {
    lines.push('', 'Warnings:');
    report.warnings.forEach((warning) => lines.push(`- ${warning}`));
  }
  if (report.errors.length) {
    lines.push('', 'Errors:');
    report.errors.forEach((error) => lines.push(`- ${error}`));
  }
  if (report.manualChecks.length) {
    lines.push('', 'Manual checks still required:');
    report.manualChecks.forEach((check) => lines.push(`- [${check.id}] ${check.description}`));
  }
  return lines.join('\n');
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    configureProvider(options.provider);
  } catch (error) {
    console.error(error.message);
    console.error('');
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  loadRuntimeEnv({ rootDir, env: process.env });
  configureRuntimeProxy({
    env: process.env,
    envFilePath: null,
    autoRepairProxyEnvFn: () => ({ logs: [] }),
    globalTarget: {},
  });
  const botProvider = parseOptionalProvider(process.env.BOT_PROVIDER);
  const inspection = inspectLarkRuntimeConfig({ botProvider, env: process.env });
  const appConfig = JSON.parse(fs.readFileSync(appConfigPath, 'utf8'));
  const requiredSlashCommands = appConfig.features?.nativeSlashCommands
    ? buildLarkSlashCommandManifest({
      botProvider,
      slashPrefix: process.env.SLASH_PREFIX || getDefaultSlashPrefix(botProvider),
    })
    : [];
  const report = await collectLarkReadiness({
    inspection,
    verifyCredentials: options.verifyCredentials,
    requireAccessAllowlist: options.verifyCredentials,
    requiredTenantScopes: appConfig.tenantScopes,
    requiredEvents: appConfig.events,
    requiredCallbacks: appConfig.callbacks,
    requiredSlashCommands,
    requirePublishedVersion: true,
    requireBotMenu: Boolean(appConfig.features?.botMenu),
    requiredBotMenuEventKeys: appConfig.botMenuEventKeys,
    env: process.env,
    cwd: rootDir,
  });
  console.log(options.json ? JSON.stringify(report, null, 2) : formatHuman(report));
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Lark readiness check failed: ${error?.message || error}`);
  process.exitCode = 1;
});
