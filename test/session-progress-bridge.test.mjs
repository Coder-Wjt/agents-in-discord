import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createSessionProgressBridgeFactory } from '../src/session-progress-bridge.js';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readMatch(file) {
  const stat = fs.statSync(file);
  return {
    file,
    mtimeMs: stat.mtimeMs,
    sizeBytes: stat.size,
  };
}

test('codex session progress bridge skips old replay when an existing rollout file is discovered late', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-in-discord-progress-codex-'));
  const rolloutFile = path.join(root, 'rollout.jsonl');
  fs.writeFileSync(
    rolloutFile,
    `${JSON.stringify({
      timestamp: '2026-03-25T10:00:00.000Z',
      type: 'item.completed',
      payload: { text: 'old replay' },
    })}\n`,
  );

  let filteredLookups = 0;
  const seen = [];
  const factory = createSessionProgressBridgeFactory({
    normalizeProvider: (provider) => provider,
    extractRawProgressTextFromEvent: (event) => String(event?.payload?.text || ''),
    findLatestRolloutFileBySessionId: () => {
      const match = readMatch(rolloutFile);
      if (filteredLookups === 0) {
        filteredLookups += 1;
        return match;
      }
      filteredLookups += 1;
      return filteredLookups >= 3 ? match : null;
    },
    findLatestClaudeSessionFileBySessionId: () => null,
  });

  const stop = factory.startSessionProgressBridge({
    provider: 'codex',
    threadId: 'sid-codex',
    onEvent: (event) => seen.push(String(event?.payload?.text || '')),
  });

  try {
    await wait(150);
    fs.appendFileSync(
      rolloutFile,
      `${JSON.stringify({
        timestamp: '2026-03-25T10:00:01.000Z',
        type: 'item.completed',
        payload: { text: 'new tail' },
      })}\n`,
    );

    await wait(900);
    assert.deepEqual(seen, ['new tail']);
  } finally {
    stop();
  }
});

test('claude session progress bridge skips old replay when an existing session file is discovered late', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-in-discord-progress-claude-'));
  const sessionFile = path.join(root, 'session.jsonl');
  fs.writeFileSync(
    sessionFile,
    `${JSON.stringify({
      timestamp: '2026-03-25T10:00:00.000Z',
      type: 'assistant',
      sessionId: 'sid-claude',
      text: 'old replay',
    })}\n`,
  );

  let filteredLookups = 0;
  const seen = [];
  const factory = createSessionProgressBridgeFactory({
    normalizeProvider: (provider) => provider,
    extractRawProgressTextFromEvent: (event) => String(event?.text || ''),
    findLatestRolloutFileBySessionId: () => null,
    findLatestClaudeSessionFileBySessionId: () => {
      const match = readMatch(sessionFile);
      if (filteredLookups === 0) {
        filteredLookups += 1;
        return match;
      }
      filteredLookups += 1;
      return filteredLookups >= 3 ? match : null;
    },
  });

  const stop = factory.startSessionProgressBridge({
    provider: 'claude',
    threadId: 'sid-claude',
    workspaceDir: '/tmp/demo',
    onEvent: (event) => seen.push(String(event?.text || '')),
  });

  try {
    await wait(150);
    fs.appendFileSync(
      sessionFile,
      `${JSON.stringify({
        timestamp: '2026-03-25T10:00:01.000Z',
        type: 'assistant',
        sessionId: 'sid-claude',
        text: 'new tail',
      })}\n`,
    );

    await wait(900);
    assert.deepEqual(seen, ['new tail']);
  } finally {
    stop();
  }
});

test('claude session progress bridge forwards user tool_result events for downstream result parsing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-in-discord-progress-claude-tool-result-'));
  const sessionFile = path.join(root, 'session.jsonl');
  fs.writeFileSync(sessionFile, '');

  const seen = [];
  const factory = createSessionProgressBridgeFactory({
    normalizeProvider: (provider) => provider,
    extractRawProgressTextFromEvent: () => '',
    findLatestRolloutFileBySessionId: () => null,
    findLatestClaudeSessionFileBySessionId: () => readMatch(sessionFile),
  });

  const stop = factory.startSessionProgressBridge({
    provider: 'claude',
    threadId: 'sid-claude-tool-result',
    workspaceDir: '/tmp/demo',
    onEvent: (event) => seen.push(event),
  });

  try {
    await wait(150);
    fs.appendFileSync(
      sessionFile,
      `${JSON.stringify({
        timestamp: '2026-03-25T10:00:01.000Z',
        type: 'user',
        sessionId: 'sid-claude-tool-result',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              content: '## 角色卡 #1\n\n完整正文',
            },
          ],
        },
      })}\n`,
    );

    await wait(900);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.type, 'user');
  } finally {
    stop();
  }
});

test('claude session progress bridge forwards assistant tool_use snapshots even when raw text extraction is empty', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-in-discord-progress-claude-assistant-'));
  const sessionFile = path.join(root, 'session.jsonl');
  fs.writeFileSync(sessionFile, '');

  const seen = [];
  const factory = createSessionProgressBridgeFactory({
    normalizeProvider: (provider) => provider,
    extractRawProgressTextFromEvent: () => '',
    findLatestRolloutFileBySessionId: () => null,
    findLatestClaudeSessionFileBySessionId: () => readMatch(sessionFile),
  });

  const stop = factory.startSessionProgressBridge({
    provider: 'claude',
    threadId: 'sid-claude-assistant',
    workspaceDir: '/tmp/demo',
    onEvent: (event) => seen.push(event),
  });

  try {
    await wait(150);
    fs.appendFileSync(
      sessionFile,
      `${JSON.stringify({
        timestamp: '2026-03-25T10:00:01.000Z',
        type: 'assistant',
        sessionId: 'sid-claude-assistant',
        uuid: 'evt-1',
        message: {
          id: 'msg-1',
          role: 'assistant',
          type: 'message',
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_ls',
              name: 'Bash',
              input: {
                command: 'ls -la',
                description: 'List current directory',
              },
            },
          ],
        },
      })}\n`,
    );

    await wait(900);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.type, 'assistant');
    assert.equal(seen[0]?.message?.content?.[0]?.type, 'tool_use');
  } finally {
    stop();
  }
});

test('zcode session progress bridge forwards new model and tool activity then stops cleanly', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-in-discord-progress-zcode-'));
  const rolloutFile = path.join(root, 'model-io-sess_zcode.jsonl');
  fs.writeFileSync(rolloutFile, `${JSON.stringify({
    type: 'model_io',
    sessionId: 'sess_zcode',
    startedAt: '2026-03-25T10:00:00.000Z',
    model: { providerId: 'bigmodel', modelId: 'GLM-5.3' },
    response: { finishReason: 'stop', toolCalls: [] },
  })}\n`);

  const seen = [];
  const factory = createSessionProgressBridgeFactory({
    normalizeProvider: (provider) => provider,
    extractRawProgressTextFromEvent: (event) => String(event?.args?.description || event?.type || ''),
    findLatestRolloutFileBySessionId: () => null,
    findLatestClaudeSessionFileBySessionId: () => null,
    findLatestZCodeRolloutFile: () => readMatch(rolloutFile),
  });

  const stop = factory.startSessionProgressBridge({
    provider: 'zcode',
    threadId: 'sess_zcode',
    workspaceDir: '/tmp/demo',
    onEvent: (event) => seen.push(event),
  });

  await wait(150);
  fs.appendFileSync(rolloutFile, `${JSON.stringify({
    type: 'model_io',
    sessionId: 'sess_zcode',
    startedAt: '2026-03-25T10:00:01.000Z',
    model: { providerId: 'bigmodel', modelId: 'GLM-5.3' },
    response: {
      finishReason: 'tool-calls',
      toolCalls: [{
        id: 'call-1',
        name: 'Read',
        input: { file_path: '/tmp/demo/README.md', description: 'Read project overview' },
      }],
    },
  })}\n`);
  fs.appendFileSync(rolloutFile, `${JSON.stringify({
    type: 'model_io',
    sessionId: 'sess_zcode',
    startedAt: '2026-03-25T10:00:01.500Z',
    model: { providerId: 'bigmodel', modelId: 'GLM-5.3' },
    requestId: 'request-error',
    error: { message: 'provider request failed' },
  })}\n`);

  await wait(900);
  assert.equal(seen.length, 2);
  assert.equal(seen[0]?.type, 'tool_execution_start');
  assert.equal(seen[0]?.toolName, 'Read');
  assert.equal(seen[0]?.model, 'GLM-5.3');
  assert.equal(seen[0]?.args?.description, 'Read project overview');
  assert.equal(seen[1]?.type, 'error');
  assert.equal(seen[1]?.error, 'provider request failed');

  stop();
  fs.appendFileSync(rolloutFile, `${JSON.stringify({
    type: 'model_io',
    sessionId: 'sess_zcode',
    startedAt: '2026-03-25T10:00:02.000Z',
    model: { providerId: 'bigmodel', modelId: 'GLM-5.3' },
    response: {
      finishReason: 'tool-calls',
      toolCalls: [{ id: 'call-2', name: 'Bash', input: { description: 'Should not be forwarded' } }],
    },
  })}\n`);
  await wait(900);
  assert.equal(seen.length, 2);
});

test('session progress bridge does not treat Pi-family sessions as Codex rollouts', () => {
  let codexLookupCount = 0;
  const factory = createSessionProgressBridgeFactory({
    normalizeProvider: (provider) => provider,
    extractRawProgressTextFromEvent: () => '',
    findLatestRolloutFileBySessionId: () => {
      codexLookupCount += 1;
      return null;
    },
    findLatestClaudeSessionFileBySessionId: () => null,
  });

  const stopPi = factory.startSessionProgressBridge({
    provider: 'pi',
    threadId: 'pi-session',
    workspaceDir: '/tmp',
    onEvent() {},
  });
  const stopOmp = factory.startSessionProgressBridge({
    provider: 'omp',
    threadId: 'omp-session',
    workspaceDir: '/tmp',
    onEvent() {},
  });

  stopPi();
  stopOmp();
  assert.equal(codexLookupCount, 0);
});
