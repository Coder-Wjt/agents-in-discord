#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { loadRuntimeEnv } from '../src/env-loader.js';
import { createLarkCliChannel } from '../src/lark-cli-channel.js';
import {
  formatLarkDenialSmokeError,
  inspectLarkDenialSmokeAuth,
  parseLarkDenialSmokeArgs,
  runLarkDenialSmoke,
  verifyLarkDenialMessage,
} from '../src/lark-denial-smoke.js';
import { inspectLarkRuntimeConfig } from '../src/lark-runtime-config.js';

const execFileAsync = promisify(execFileCallback);
const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '..');

function usage() {
  return [
    'Usage: npm run smoke:lark-denial -- [--apply] [--json]',
    '',
    'Checks the credentialed private-denial path without starting event consumers.',
    'The default is a no-message preflight. --apply sends one real bot DM to the current lark-cli user',
    'from a synthetic unauthorized group-card callback and verifies that no shared-card update was attempted.',
    'This rehearsal does not replace a second user clicking a real shared card.',
  ].join('\n');
}

function formatHuman(report) {
  const lines = [
    `${report.ok ? '✅' : '❌'} Lark private-denial smoke ${report.applied ? 'completed' : 'preflight'}`,
    `• lark-cli: ${report.cliAvailable ? 'available' : 'unavailable'}`,
    `• bot identity: ${report.botReady ? 'ready' : 'unavailable'}`,
    `• user identity: ${report.userReady ? 'ready' : 'unavailable'}`,
    `• mode: ${report.applied ? 'apply' : 'preflight only'}`,
  ];
  if (report.applied && report.result) {
    lines.push(`• real private bot message: ${report.result.realBotDm ? 'verified' : 'failed'}`);
    lines.push(`• shared card updates: ${report.result.sharedUpdateAttempts}`);
    lines.push(`• extra event consumers: ${report.result.consumerFree ? 'none' : 'detected'}`);
    lines.push('• callback source: synthetic unauthorized group-card action');
  } else if (report.ok) {
    lines.push('Run again with --apply to send and verify one real private denial message.');
  }
  lines.push('Note: final acceptance still requires a second user clicking a real shared group card.');
  if (report.error) lines.push(`• error: ${report.error}`);
  return lines.join('\n');
}

async function main() {
  let options;
  try {
    options = parseLarkDenialSmokeArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }

  loadRuntimeEnv({ rootDir, env: process.env });
  const config = inspectLarkRuntimeConfig({ env: process.env }).config;
  const cliEnv = {
    ...process.env,
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
    LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
  };
  const withProfile = (args) => normalizeProfile(config.cliProfile)
    ? ['--profile', normalizeProfile(config.cliProfile), ...args]
    : args;
  const executeCli = async (args) => {
    try {
      const { stdout } = await execFileAsync(config.cliBin, withProfile(args), {
        cwd: rootDir,
        env: cliEnv,
        maxBuffer: 20 * 1024 * 1024,
      });
      return JSON.parse(stdout);
    } catch {
      const error = new Error('lark-cli operation failed.');
      error.code = 'lark_denial_smoke_cli_error';
      throw error;
    }
  };
  const report = {
    ok: false,
    applied: options.apply,
    cliAvailable: false,
    botReady: false,
    userReady: false,
    result: null,
  };

  try {
    try {
      await execFileAsync(config.cliBin, ['--version'], { cwd: rootDir, env: cliEnv });
    } catch {
      const error = new Error('lark-cli is unavailable.');
      error.code = 'lark_denial_smoke_cli_unavailable';
      throw error;
    }
    report.cliAvailable = true;
    const [authPayload, userPayload] = await Promise.all([
      executeCli(['auth', 'status', '--verify', '--json']),
      executeCli(['whoami', '--as', 'user']),
    ]);
    const auth = inspectLarkDenialSmokeAuth(authPayload, userPayload);
    report.botReady = auth.botReady;
    report.userReady = auth.userReady;
    report.ok = auth.ok;
    if (!auth.ok) {
      const error = new Error('Lark identities unavailable.');
      error.code = 'lark_denial_smoke_identity_unavailable';
      throw error;
    }
    if (options.apply) {
      const channel = createLarkCliChannel({
        cliBin: config.cliBin,
        profile: config.cliProfile,
        cwd: rootDir,
        env: cliEnv,
        logger: { log() {}, warn() {}, error() {} },
      });
      report.result = await runLarkDenialSmoke({
        channel,
        actorOpenId: auth.actorOpenId,
        verifySentMessage: async ({ messageId }) => {
          const payload = await executeCli([
            'api',
            'GET',
            `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`,
            '--as',
            'bot',
          ]);
          return verifyLarkDenialMessage(payload, { messageId });
        },
      });
      report.ok = report.result.ok;
    }
  } catch (error) {
    report.ok = false;
    report.error = formatLarkDenialSmokeError(error);
  }

  console.log(options.json ? JSON.stringify(report, null, 2) : formatHuman(report));
  if (!report.ok) process.exitCode = 1;
}

function normalizeProfile(value) {
  return String(value || '').trim();
}

main();
