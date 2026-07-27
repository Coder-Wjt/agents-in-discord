#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { getDefaultSlashPrefix, parseOptionalProvider } from '../src/bot-instance-utils.js';
import { loadRuntimeEnv } from '../src/env-loader.js';
import {
  LARK_USER_SEND_SCOPE,
  buildLarkDmSmokeCases,
  formatLarkDmSmokeError,
  inspectLarkDmSmokeAuth,
  parseLarkDmSmokeArgs,
  runLarkDmSmoke,
} from '../src/lark-dm-smoke.js';
import { inspectLarkRuntimeConfig } from '../src/lark-runtime-config.js';
import { buildLarkSlashCommandManifest } from '../src/lark-slash-commands.js';

const execFileAsync = promisify(execFileCallback);
const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '..');

function usage() {
  return [
    'Usage: npm run smoke:lark-dm -- [--apply] [--json] [--provider <name>] [--timeout-ms <ms>] [--poll-ms <ms>]',
    '',
    'Checks whether the selected lark-cli profile can drive a private-chat smoke.',
    'The default is a no-write preflight. --apply explicitly sends three private messages as the user identity:',
    'ordinary prompt, native command with an argument, and unknown slash-path fallback.',
    'Output never includes app/chat/user/message IDs, credentials, or message bodies.',
  ].join('\n');
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

function formatHuman(report, { profileConfigured = false } = {}) {
  const lines = [
    `${report.ok ? '✅' : '❌'} Lark DM smoke ${report.applied ? 'completed' : 'preflight'}`,
    `• provider: ${report.provider || 'shared'}`,
    `• transport profile: ${report.cliAvailable ? 'available' : 'unavailable'}`,
    `• bot identity: ${report.botReady ? 'ready' : 'unavailable'}`,
    `• user identity: ${report.userReady ? 'ready' : 'unavailable'}`,
    `• user send scope: ${report.userSendScope ? 'ready' : 'missing'}`,
    `• mode: ${report.applied ? 'apply' : 'preflight only'}`,
  ];
  if (report.results?.length) {
    lines.push('', 'Cases:');
    for (const result of report.results) {
      lines.push(`- [${result.ok ? 'pass' : 'fail'}] ${result.id} (${result.elapsedMs}ms, polls=${result.attempts})`);
    }
  }
  if (!report.userSendScope) {
    lines.push('', `Required user scope: ${LARK_USER_SEND_SCOPE}`);
    lines.push('Grant it interactively on the same lark-cli profile before apply:');
    lines.push(profileConfigured
      ? `lark-cli auth login --profile "<configured-profile>" --scope "${LARK_USER_SEND_SCOPE}"`
      : `lark-cli auth login --scope "${LARK_USER_SEND_SCOPE}"`);
  } else if (!report.applied) {
    lines.push('', 'Preflight passed. Run again with --apply to send and verify the three DM cases.');
  }
  if (report.error) lines.push('', `Error: ${report.error}`);
  return lines.join('\n');
}

async function main() {
  let options;
  try {
    options = parseLarkDmSmokeArgs(process.argv.slice(2));
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
  const withProfile = (args) => String(config.cliProfile || '').trim()
    ? ['--profile', String(config.cliProfile).trim(), ...args]
    : args;
  const cliEnv = {
    ...process.env,
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
    LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
  };
  const executeCli = async (args) => {
    try {
      const { stdout } = await execFileAsync(config.cliBin, withProfile(args), {
        cwd: rootDir,
        env: cliEnv,
        maxBuffer: 20 * 1024 * 1024,
      });
      return JSON.parse(stdout);
    } catch (error) {
      const wrapped = new Error('lark-cli operation failed.');
      wrapped.code = 'lark_dm_smoke_cli_error';
      throw wrapped;
    }
  };

  const report = {
    ok: false,
    applied: options.apply,
    provider: botProvider,
    cliAvailable: false,
    botReady: false,
    userReady: false,
    userSendScope: false,
    results: [],
  };

  try {
    try {
      await execFileAsync(config.cliBin, ['--version'], { cwd: rootDir, env: cliEnv });
    } catch {
      const error = new Error('lark-cli is unavailable.');
      error.code = 'lark_dm_smoke_cli_unavailable';
      throw error;
    }
    report.cliAvailable = true;
    const authPayload = await executeCli(['auth', 'status', '--verify', '--json']);
    const auth = inspectLarkDmSmokeAuth(authPayload);
    report.botReady = auth.botReady;
    report.userReady = auth.userReady;
    report.userSendScope = auth.userSendScope;
    report.ok = auth.ok;
    if (options.apply && auth.ok) {
      const slashPrefix = process.env.SLASH_PREFIX || getDefaultSlashPrefix(botProvider);
      const manifest = buildLarkSlashCommandManifest({ botProvider, slashPrefix });
      const profileCommand = manifest.find((item) => item.command.endsWith('_profile'))?.command;
      if (!profileCommand) {
        const error = new Error('Native profile command is unavailable.');
        error.code = 'lark_dm_smoke_native_command_unavailable';
        throw error;
      }
      const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const cases = buildLarkDmSmokeCases({ nativeProfileCommand: profileCommand, nonce });
      report.results = await runLarkDmSmoke({
        executeCli,
        botOpenId: auth.botOpenId,
        cases,
        timeoutMs: options.timeoutMs,
        pollMs: options.pollMs,
      });
      report.ok = report.results.every((result) => result.ok);
    }
  } catch (error) {
    report.ok = false;
    report.error = formatLarkDmSmokeError(error);
    if (Array.isArray(error?.results)) report.results = error.results;
  }

  console.log(options.json
    ? JSON.stringify(report, null, 2)
    : formatHuman(report, { profileConfigured: Boolean(String(config.cliProfile || '').trim()) }));
  if (!report.ok) process.exitCode = 1;
}

main();
