import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const CORE_CONVERSATION_FLOW_FILES = [
  'src/codex-fork-flow.js',
  'src/codex-side-flow.js',
];

test('fork and side core flows do not call Discord conversation APIs directly', async () => {
  const forbidden = [
    /\.threads\.create\s*\(/,
    /childThread\?*\.send\s*\(/,
    /childThread\?*\.delete\s*\(/,
    /childThread\?*\.setName\s*\(/,
    /\.setArchived\s*\(/,
    /\.setLocked\s*\(/,
    /allowedMentions/,
    /discord-message-splitter/,
  ];

  for (const file of CORE_CONVERSATION_FLOW_FILES) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${file} must use conversationSpawn instead of ${pattern}`);
    }
  }
});
