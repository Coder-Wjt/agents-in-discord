#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runLarkWebhookLiveSmoke } from '../src/lark-webhook-live-runner.js';
import { parseLarkWebhookLiveSmokeArgs } from '../src/lark-webhook-live-smoke.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  return [
    'Usage: npm run smoke:lark-webhook-live -- [--prepare | --verify] --public-url <https-url> [--wait-ms <ms>] [--json]',
    '',
    'Default: read-only preflight for the single active production webhook runtime and public health path.',
    '--prepare: create a local boolean-only receipt window without sending a message or starting a consumer.',
    '--verify: verify already observed real Open Platform requests, entry events, and restart recovery.',
    '--wait-ms: with --prepare or --verify, observe for up to 1200000ms while the real checks are performed.',
    '',
    'During observation, re-verify the callback URL, send an ordinary message and a native slash command, use a bot menu and card control, then restart the app and reverse proxy separately.',
    'The tool never prints the public URL, app/user/chat/message IDs, credentials, signatures, decrypted bodies, or event contents.',
  ].join('\n');
}
function formatHuman(report) {
  const labels = { preflight: 'preflight', prepare: 'preparation', verify: 'verification' };
  const lines = [
    `${report.ok ? '✅' : '❌'} Lark live webhook ${labels[report.mode] || report.mode}`,
    `• active runtime: ${report.activeRuntime ? 'ready' : 'unavailable'}`,
    `• webhook transport: ${report.webhookTransport ? 'ready' : 'required'}`,
    `• production credentials: ${report.credentialsReady ? 'ready' : 'incomplete'}`,
    `• encrypted events: ${report.encryptionReady ? 'required and configured' : 'required'}`,
    `• public callback URL: ${report.publicEndpointConfigured ? 'validated' : 'required'}`,
    `• local health: ${report.localHealthReady ? 'ready' : 'unavailable'}`,
    `• public health: ${report.publicHealthReady ? 'ready' : 'unavailable'}`,
  ];
  if (report.prepared) {
    lines.push('• boolean-only acceptance receipt: prepared');
    lines.push('Perform only real Open Platform actions while the acceptance window is active.');
  }
  if (report.result) {
    const evidence = [
      ['verified signed request', 'signedRequestVerified'],
      ['verified encrypted request', 'encryptedRequestVerified'],
      ['URL challenge', 'challengeVerified'],
      ['ordinary message event', 'messageEventHandled'],
      ['native slash command', 'nativeSlashCommandHandled'],
      ['bot menu event', 'botMenuHandled'],
      ['card action', 'cardActionHandled'],
      ['application restart recovery', 'applicationRestartObserved'],
      ['reverse-proxy restart recovery', 'proxyRestartObserved'],
    ];
    for (const [label, key] of evidence) {
      lines.push(`• ${label}: ${report.result[key] ? 'observed' : 'required'}`);
    }
    lines.push(`• complete: ${report.result.complete ? 'yes' : 'no'}`);
  }
  if (report.error) lines.push(`• error: ${report.error}`);
  return lines.join('\n');
}

async function main() {
  let options;
  try {
    options = parseLarkWebhookLiveSmokeArgs(process.argv.slice(2));
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
  const report = await runLarkWebhookLiveSmoke({ options, rootDir });
  console.log(options.json ? JSON.stringify(report, null, 2) : formatHuman(report));
  if (!report.ok) process.exitCode = 1;
}

main();
