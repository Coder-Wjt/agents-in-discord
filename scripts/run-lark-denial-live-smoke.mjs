#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runLarkDenialLiveSmoke } from '../src/lark-denial-live-runner.js';
import { parseLarkDenialLiveSmokeArgs } from '../src/lark-denial-live-smoke.js';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '..');

function usage() {
  return [
    'Usage: npm run smoke:lark-denial-live -- [--prepare | --verify] [--wait-ms <ms>] [--json]',
    '',
    'Default: read-only preflight for the active Lark runtime and its single known group.',
    '--prepare: send one shared acceptance card only when the group has at least two users.',
    '--verify: prove a real unauthorized click produced a separate private delivery and left the shared card unchanged.',
    '--wait-ms: after --prepare, wait up to 600000ms for the production consumer to observe the click, then verify.',
    '',
    'The tool never starts an event consumer and never prints app/chat/user/message IDs, credentials, card bodies, or profile names.',
  ].join('\n');
}

function formatHuman(report) {
  const labels = { preflight: 'preflight', prepare: 'preparation', verify: 'verification' };
  const lines = [
    `${report.ok ? '✅' : '❌'} Lark live private-denial ${labels[report.mode] || report.mode}`,
    `• active runtime: ${report.activeRuntime ? 'ready' : 'unavailable'}`,
    `• production consumers reused: ${report.productionConsumerReused ? 'yes' : 'no'}`,
    `• bot identity: ${report.botReady ? 'ready' : 'unavailable'}`,
    `• user identity: ${report.userReady ? 'ready' : 'unavailable'}`,
    `• accessible groups: ${report.groupCount}`,
    `• group users: ${report.groupUserCount}`,
    `• second user: ${report.secondUserReady ? 'ready' : 'required'}`,
    `• owner-only allowlist: ${report.ownerAllowlistReady ? 'ready' : 'invalid'}`,
  ];
  if (report.prepared) {
    lines.push('• shared acceptance card: prepared');
    lines.push('Ask only the second, non-allowlisted user to click the card button.');
    lines.push('Then run --verify, or use --wait-ms together with --prepare.');
  }
  if (report.result) {
    lines.push(`• real callback observed: ${report.result.callbackObserved ? 'yes' : 'no'}`);
    lines.push(`• denied actor differs from owner: ${report.result.actorDifferentFromOwner ? 'yes' : 'no'}`);
    lines.push(`• private delivery succeeded: ${report.result.privateDeliverySucceeded ? 'yes' : 'no'}`);
    lines.push(`• private chat separated from group: ${report.result.privateChatSeparatedFromGroup ? 'yes' : 'no'}`);
    lines.push(`• shared card unchanged: ${report.result.sharedCardUnchanged ? 'yes' : 'no'}`);
  }
  if (!report.secondUserReady && report.mode !== 'verify') {
    lines.push('A second real user must join the existing acceptance group before --prepare can write.');
  }
  if (report.error) lines.push(`• error: ${report.error}`);
  return lines.join('\n');
}

async function main() {
  let options;
  try {
    options = parseLarkDenialLiveSmokeArgs(process.argv.slice(2));
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
  const report = await runLarkDenialLiveSmoke({ options, rootDir });
  console.log(options.json ? JSON.stringify(report, null, 2) : formatHuman(report));
  if (!report.ok) process.exitCode = 1;
}

main();
