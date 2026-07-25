import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const CORE_PRESENTATION_FILES = [
  'src/command-spec.js',
  'src/report-formatters.js',
  'src/codex-fork-flow.js',
  'src/codex-side-flow.js',
];

test('conversation presentation core does not own Discord channel or thread terminology', async () => {
  const forbidden = /Discord (?:channel|thread)|父 Discord|新的 Discord thread|new Discord thread/;

  for (const file of CORE_PRESENTATION_FILES) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, forbidden, `${file} must obtain Discord terminology from conversationPresentation`);
  }
});
