// Replays a real Codex rollout through the production progress reporter and
// reports how many Discord messages the thread would receive. Used to size the
// turn-marker delay and heartbeat interval against observed sessions rather
// than guesses.
import fs from 'node:fs';
import readline from 'node:readline';

import { createPromptProgressReporterFactory } from '../src/prompt-progress-reporter.js';
import { createRuntimePresentation } from '../src/runtime-presentation.js';
import {
  buildProgressEventDedupeKey,
  createProgressEventDeduper,
} from '../src/codex-event-utils.js';

const file = process.argv[2];
const markDelayMs = Number(process.argv[3] || 90_000);
const heartbeatMs = Number(process.argv[4] || 240_000);
if (!file) {
  console.error('usage: replay-progress-density.mjs <rollout.jsonl> [markDelayMs] [heartbeatMs]');
  process.exit(2);
}

let clock = 0;
const streamed = [];
const timers = [];

const presentation = createRuntimePresentation({
  showReasoning: false,
  streamToolActivity: false,
  progressTextPreviewChars: 140,
  progressDoneStepsMax: 4,
  progressActivityMaxLines: 4,
  progressProcessLines: 2,
  humanAge: (ms) => `${Math.round(ms / 1000)}s`,
});

const createProgressReporter = createPromptProgressReporterFactory({
  defaultUiLanguage: 'zh',
  progressUpdatesEnabled: true,
  progressEventFlushMs: 0,
  // Distinct from the 15s marker tick so the two timers can be told apart below.
  progressUpdateIntervalMs: 60_000,
  progressProcessPushIntervalMs: 1100,
  progressTurnMarkDelayMs: markDelayMs,
  progressHeartbeatIntervalMs: heartbeatMs,
  presentation,
  createProgressEventDeduper,
  buildProgressEventDedupeKey,
  safeReply: async () => ({ id: 'card', async edit() {} }),
  humanElapsed: (ms) => `${Math.round(ms / 60000)}min`,
  now: () => clock,
  setIntervalFn: (fn, ms) => {
    const handle = { fn, ms, unref() {} };
    timers.push(handle);
    return handle;
  },
  clearIntervalFn: () => {},
  onStreamProcessMessage: async (text) => { streamed.push(text); },
});

const reporter = createProgressReporter({
  message: { id: 'm', author: { id: 'u' } },
  channelState: { queue: [], activeRun: { phase: 'exec' } },
  session: { provider: 'codex' },
  language: 'zh',
});

await reporter.start();
// The reporter drives its markers off a 15s interval; replaying means firing
// that same callback for every tick the real elapsed time would have covered.
const heartbeat = timers.find((handle) => handle.ms === 15_000);
const heartbeatTick = () => heartbeat?.fn();

const rl = readline.createInterface({
  input: fs.createReadStream(file),
  crlfDelay: Infinity,
});

let firstTs = 0;
let lastTs = 0;
let events = 0;

for await (const line of rl) {
  if (!line.trim()) continue;
  let row;
  try { row = JSON.parse(line); } catch { continue; }
  const ts = Date.parse(row.timestamp || '') || 0;
  if (ts) {
    if (!firstTs) firstTs = ts;
    // Advance the injected clock to the event's real time and fire every
    // heartbeat tick that would have elapsed in between.
    const target = ts - firstTs;
    while (clock + 15_000 <= target) {
      clock += 15_000;
      heartbeatTick();
      await new Promise((resolve) => setImmediate(resolve));
    }
    clock = target;
    lastTs = ts;
  }
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : null;
  if (!payload) continue;
  reporter.onEvent({ type: row.type, payload });
  events += 1;
  await new Promise((resolve) => setImmediate(resolve));
}

await reporter.finish({ ok: true });

const hours = (lastTs - firstTs) / 3_600_000;
const markers = streamed.filter((t) => /^[▶…]/.test(t)).length;
console.log(JSON.stringify({
  file: file.split('/').pop(),
  events,
  hours: Number(hours.toFixed(2)),
  threadMessages: streamed.length,
  turnMarkers: markers,
  realOutput: streamed.length - markers,
  perHour: Number((streamed.length / Math.max(hours, 0.01)).toFixed(1)),
}, null, 2));

if (process.env.SHOW_MESSAGES) {
  for (const text of streamed) {
    console.log(`--- ${text.replace(/\n/g, ' ⏎ ').slice(0, 150)}`);
  }
}
