import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const CORE_MESSAGE_CONTEXT_FILES = [
  '../src/channel-queue.js',
  '../src/channel-runtime.js',
  '../src/codex-fork-flow.js',
  '../src/codex-side-flow.js',
  '../src/extra-info.js',
  '../src/prompt-orchestrator.js',
  '../src/text-command-handler.js',
  '../src/native-image-inputs.js',
];

test('core message consumers do not read Discord-shaped message context fields', async () => {
  const forbiddenMessageField = /message\??\.(?:author|channel|attachments|reference)\b/;

  for (const relativePath of CORE_MESSAGE_CONTEXT_FILES) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    assert.doesNotMatch(source, forbiddenMessageField, relativePath);
  }
});

test('fork and side flows resolve requesters through the inbound actor accessor', async () => {
  for (const relativePath of ['../src/codex-fork-flow.js', '../src/codex-side-flow.js']) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(source, /getInboundActorId/);
    assert.doesNotMatch(source, /source\??\.(?:author|user)\b/);
  }
});

test('text command core imports platform-neutral message input helpers', async () => {
  const source = await readFile(new URL('../src/text-command-handler.js', import.meta.url), 'utf8');

  assert.match(source, /from '\.\/message-input\.js'/);
  assert.doesNotMatch(source, /from '\.\/discord-message-input\.js'/);
});

test('slash command core delegates synthetic prompt messages to the conversation port', async () => {
  const source = await readFile(new URL('../src/slash-command-router.js', import.meta.url), 'utf8');

  assert.match(source, /createPromptMessageFromInteraction/);
  assert.match(source, /port\.createPromptMessage\(/);
  assert.doesNotMatch(source, /function createInteractionPromptMessage/);
  assert.doesNotMatch(source, /reactions:\s*\{\s*cache:/);
});
