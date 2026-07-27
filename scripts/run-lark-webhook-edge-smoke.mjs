#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';

import {
  formatLarkWebhookEdgeSmokeError,
  parseLarkWebhookEdgeSmokeArgs,
  runLarkWebhookEdgeSmoke,
} from '../src/lark-webhook-edge-smoke.js';

const execFileAsync = promisify(execFileCallback);

function usage() {
  return [
    'Usage: npm run smoke:lark-webhook-edge -- [--apply] [--json]',
    '  --apply              open a temporary public TLS tunnel and run synthetic signed/encrypted callbacks',
    '  --tunnel-bin <path>  cloudflared executable (default: cloudflared)',
    '  --timeout-ms <n>     total readiness timeout (default: 120000)',
    '  --poll-ms <n>        public endpoint poll interval (default: 1000)',
    '  --json               print structured output',
    '',
    'This smoke does not change the Lark app configuration and does not replace real Open Platform event acceptance.',
  ].join('\n');
}

function formatHuman(report) {
  const lines = [
    report.ok ? '✅ Lark public webhook edge smoke passed' : '❌ Lark public webhook edge smoke failed',
    `• mode: ${report.applied ? 'apply' : 'preflight (no tunnel opened)'}`,
    `• cloudflared: ${report.tunnelBinaryAvailable ? 'available' : 'unavailable'}`,
  ];
  if (report.applied) {
    lines.push(`• public TLS: ${report.tls ? 'verified' : 'not verified'}`);
    lines.push(`• tunnel provider: ${report.tunnelProvider || 'unknown'}`);
    lines.push(`• DNS: ${report.dnsMode || 'not verified'}`);
    for (const result of report.results || []) {
      const timing = Number.isFinite(result.elapsedMs) ? ` (${result.elapsedMs}ms` : '';
      const attempts = Number.isFinite(result.attempts) ? `${timing ? ', ' : ' ('}${result.attempts} attempts` : '';
      const suffix = timing || attempts ? `${timing}${attempts})` : '';
      lines.push(`• ${result.ok ? 'ok' : 'failed'}: ${result.id}${suffix}`);
    }
  } else {
    lines.push('Run with --apply to create a temporary account-less TLS tunnel and execute the edge smoke.');
  }
  lines.push('Note: real Feishu/Lark callback, menu, slash-command, and card-action acceptance is still required.');
  if (report.error) lines.push(`• error: ${report.error}`);
  return lines.join('\n');
}

async function main() {
  let options;
  try {
    options = parseLarkWebhookEdgeSmokeArgs(process.argv.slice(2));
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

  const report = {
    ok: false,
    applied: options.apply,
    tunnelBinaryAvailable: false,
    tls: false,
    tunnelProvider: null,
    dnsMode: null,
    results: [],
  };
  try {
    await execFileAsync(options.tunnelBin, ['--version'], {
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    });
    report.tunnelBinaryAvailable = true;
    if (options.apply) {
      Object.assign(report, await runLarkWebhookEdgeSmoke(options));
      report.tunnelBinaryAvailable = true;
    } else {
      report.ok = true;
    }
  } catch (error) {
    report.ok = false;
    report.error = formatLarkWebhookEdgeSmokeError(error);
  }

  console.log(options.json ? JSON.stringify(report, null, 2) : formatHuman(report));
  if (!report.ok) process.exitCode = 1;
}

main();
