#!/usr/bin/env node

import { execFile } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  getDefaultSlashPrefix,
  parseOptionalProvider,
} from '../src/bot-instance-utils.js';
import { loadRuntimeEnv } from '../src/env-loader.js';
import { inspectLarkRuntimeConfig } from '../src/lark-runtime-config.js';
import {
  buildLarkSlashCommandManifest,
  buildLarkSlashCommandCliArgs,
  compareLarkSlashCommands,
  LARK_SLASH_COMMAND_PROVISIONING_SCOPES,
  normalizeLarkSlashCommandList,
  planLarkSlashCommandSync,
  verifyLarkSlashCommandProvisioningScopes,
} from '../src/lark-slash-commands.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '..');

function usage() {
  return [
    'Usage: npm run sync:lark-commands -- [--dry-run | --apply] [--json] [--provider <name>]',
    '',
    'Default mode is read-only and reports native slash-command drift.',
    '--dry-run validates every planned create/update request without writing.',
    '--apply validates the complete plan first, then creates missing commands and updates changed descriptions.',
    'Extra commands are never deleted.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    apply: false,
    dryRun: false,
    json: false,
    provider: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--json') options.json = true;
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
  if (options.apply && options.dryRun) {
    throw new TypeError('--apply and --dry-run are mutually exclusive.');
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

function withProfile(config, args) {
  const profile = String(config?.cliProfile || '').trim();
  return profile ? ['--profile', profile, ...args] : args;
}

async function runCli(config, args) {
  return execFileAsync(config?.cliBin || 'lark-cli', withProfile(config, args), {
    cwd: rootDir,
    env: {
      ...process.env,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
    },
    maxBuffer: 1024 * 1024,
  });
}

async function listCommands(config) {
  const result = await runCli(config, [
    'application',
    '+slash-command-list',
    '--as',
    'bot',
    '--json',
  ]);
  const payload = JSON.parse(String(result?.stdout || '').trim());
  return normalizeLarkSlashCommandList(payload);
}

async function verifyProvisioningScopes(config) {
  const result = await runCli(config, [
    'api',
    'GET',
    '/open-apis/application/v6/scopes',
    '--as',
    'bot',
    '--json',
  ]);
  const payload = JSON.parse(String(result?.stdout || '').trim());
  return verifyLarkSlashCommandProvisioningScopes(payload);
}

function publicDiff(diff) {
  return {
    ok: diff.ok,
    requiredCount: diff.requiredCount,
    installedCount: diff.installedCount,
    matchedCount: diff.matchedCount,
    missing: diff.missing.map((item) => item.command),
    outdated: diff.outdated.map((item) => item.command),
    extraCount: diff.extra.length,
  };
}

async function applyCommands(config, operations) {
  for (const item of operations) {
    await runCli(config, buildLarkSlashCommandCliArgs(item));
  }
}

async function validateCommands(config, operations) {
  for (const item of operations) {
    await runCli(config, buildLarkSlashCommandCliArgs(item, { dryRun: true }));
  }
}

function formatHuman(report) {
  const dryRun = report.mode === 'dry-run';
  const lines = [
    dryRun
      ? `${report.ok ? '✅' : '❌'} Lark native slash-command dry run ${report.ok ? 'passed' : 'failed'}`
      : `${report.registryOk ? '✅' : '❌'} Lark native slash-command registry ${report.registryOk ? 'matches' : 'has drift'}`,
    `• desired: ${report.requiredCount}`,
    `• installed: ${report.installedCount}`,
    `• matched: ${report.matchedCount}`,
    `• missing: ${report.missing.length}`,
    `• outdated: ${report.outdated.length}`,
    `• extra (preserved): ${report.extraCount}`,
    `• provisioning scopes: ${report.provisioningScopes.grantedCount}/${report.provisioningScopes.requiredCount}`,
  ];
  if (!report.provisioningScopes.readAvailable) {
    lines.push('', `Missing required read scope: ${LARK_SLASH_COMMAND_PROVISIONING_SCOPES[0]}.`);
  } else if (report.requiresWriteScope && !report.provisioningScopes.writeAvailable) {
    lines.push(
      '',
      `Cannot ${dryRun ? 'validate' : 'apply'} the pending plan without ${LARK_SLASH_COMMAND_PROVISIONING_SCOPES[1]}.`,
      'The read-only registry inspection remains available.',
    );
  } else if (!report.capacityOk) {
    lines.push(
      '',
      `Cannot create ${report.requiredCreateCount} missing command(s): only ${report.availableSlots} of ${report.maxCommands} registry slots are available.`,
      'Remove unneeded extra commands manually, then run the read-only check again.',
    );
  } else if (dryRun) {
    lines.push(
      '',
      `Validated ${report.validatedCount} planned create/update request(s); no changes were written.`,
      report.registryOk
        ? 'The registry already matches the desired command manifest.'
        : 'The registry still has drift; use --apply only after reviewing this plan.',
    );
  } else if (!report.registryOk) {
    lines.push('', report.applied
      ? 'The apply pass completed, but verification still found drift.'
      : 'Review the drift, then run with --dry-run or --apply. Extra commands are never deleted.');
  } else if (report.applied) {
    lines.push('', `Validated and applied ${report.appliedCount} create/update operation(s), then verified the registry.`);
  }
  if (report.mode === 'inspect' && !report.provisioningScopes.writeAvailable) {
    lines.push(
      '',
      `Read-only inspection is available, but pending changes cannot be validated or applied without ${LARK_SLASH_COMMAND_PROVISIONING_SCOPES[1]}.`,
    );
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
  const botProvider = parseOptionalProvider(process.env.BOT_PROVIDER);
  const inspection = inspectLarkRuntimeConfig({ botProvider, env: process.env });
  const config = inspection.config;
  const desired = buildLarkSlashCommandManifest({
    botProvider,
    slashPrefix: process.env.SLASH_PREFIX || getDefaultSlashPrefix(botProvider),
  });

  const provisioningScopes = await verifyProvisioningScopes(config);
  const readAvailable = !provisioningScopes.missing
    .includes(LARK_SLASH_COMMAND_PROVISIONING_SCOPES[0]);
  const writeAvailable = !provisioningScopes.missing
    .includes(LARK_SLASH_COMMAND_PROVISIONING_SCOPES[1]);
  if (!readAvailable) {
    const error = new Error('Lark native slash-command read scope is unavailable.');
    error.code = 'lark_slash_command_read_scope_missing';
    throw error;
  }
  let diff = compareLarkSlashCommands(desired, await listCommands(config));
  let plan = planLarkSlashCommandSync(diff);
  const plannedOperationCount = plan.operationCount;
  const requiresWriteScope = (options.dryRun || options.apply) && plannedOperationCount > 0;
  const scopeReady = !requiresWriteScope || writeAvailable;
  const shouldValidate = (options.dryRun || options.apply) && plan.capacityOk && scopeReady;
  if (shouldValidate && plannedOperationCount) {
    try {
      await validateCommands(config, plan.operations);
    } catch {
      const error = new Error('Lark native slash-command plan validation failed before any writes.');
      error.code = 'lark_slash_command_validation_failed';
      throw error;
    }
  }
  const applyAttempted = options.apply && plan.capacityOk && scopeReady;
  if (applyAttempted && plannedOperationCount) {
    await applyCommands(config, plan.operations);
    diff = compareLarkSlashCommands(desired, await listCommands(config));
    plan = planLarkSlashCommandSync(diff);
  }
  const mode = options.apply ? 'apply' : options.dryRun ? 'dry-run' : 'inspect';
  const registryOk = diff.ok;
  const report = {
    ...publicDiff(diff),
    ok: mode === 'dry-run' ? plan.capacityOk && scopeReady : registryOk,
    registryOk,
    mode,
    provisioningScopes: {
      ...provisioningScopes,
      readAvailable,
      writeAvailable,
    },
    requiresWriteScope,
    capacityOk: plan.capacityOk,
    maxCommands: plan.maxCommands,
    availableSlots: plan.availableSlots,
    requiredCreateCount: plan.requiredCreateCount,
    validatedCount: shouldValidate ? plannedOperationCount : 0,
    applied: applyAttempted,
    appliedCount: applyAttempted ? plannedOperationCount : 0,
  };
  console.log(options.json ? JSON.stringify(report, null, 2) : formatHuman(report));
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  if (error?.code === 'lark_slash_command_validation_failed') {
    console.error('Lark native slash-command plan validation failed before any writes; inspect the manifest and local lark-cli version.');
  } else if (error?.code === 'lark_slash_command_read_scope_missing') {
    console.error(`Lark native slash-command registry cannot be inspected without ${LARK_SLASH_COMMAND_PROVISIONING_SCOPES[0]}.`);
  } else {
    console.error('Lark native slash-command sync failed; verify the selected lark-cli profile and application slash-command permissions.');
  }
  process.exitCode = 1;
});
