import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const readSource = (name) => fs.readFileSync(path.join(testDir, '..', 'src', name), 'utf8');

test('prompt and command presentation core do not use Discord-native send or mention syntax', () => {
  const promptSource = readSource('prompt-orchestrator.js');
  const reportSource = readSource('report-formatters.js');
  const settingsSource = readSource('settings-panel.js');
  const slashSource = readSource('slash-command-router.js');

  assert.match(promptSource, /assertMessageDelivery\(messageDelivery\)/);
  assert.doesNotMatch(promptSource, /message\.channel\.send|safeChannelSend|splitForDiscord|withDiscordNetworkRetry|<@/);
  assert.doesNotMatch(reportSource, /<@\$\{|<@[!&]?|<#/);
  assert.doesNotMatch(settingsSource, /channel\?*\.send|channel\.send/);
  assert.doesNotMatch(slashSource, /channel\?*\.send|channel\.send/);
});

test('Discord composition explicitly keeps the legacy extra info default', () => {
  const indexSource = readSource('index.js');

  assert.match(indexSource, /DISCORD_DEFAULT_EXTRA_INFO_TEMPLATE/);
  assert.match(indexSource, /EXTRA_INFO_TEXT[\s\S]*\|\| DISCORD_DEFAULT_EXTRA_INFO_TEMPLATE/);
});
