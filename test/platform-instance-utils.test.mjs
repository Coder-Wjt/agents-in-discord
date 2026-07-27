import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendPlatformInstanceSuffix,
  normalizeBotPlatform,
  normalizePlatformInstanceId,
} from '../src/platform-instance-utils.js';

test('platform instance helpers preserve the legacy default Discord filenames', () => {
  assert.equal(normalizeBotPlatform('DISCORD'), 'discord');
  assert.equal(normalizeBotPlatform('lark'), 'lark');
  assert.equal(normalizeBotPlatform('unknown'), 'discord');
  assert.equal(normalizePlatformInstanceId('Prod CN'), 'prod-cn');
  assert.equal(appendPlatformInstanceSuffix('sessions.codex.json'), 'sessions.codex.json');
});

test('platform instance helpers isolate Lark data and locks', () => {
  assert.equal(
    appendPlatformInstanceSuffix('sessions.codex.json', { platformId: 'lark', instanceId: 'prod-cn' }),
    'sessions.codex.lark.prod-cn.json',
  );
  assert.equal(
    appendPlatformInstanceSuffix('workspace-locks', { platformId: 'lark', instanceId: 'default' }),
    'workspace-locks.lark.default',
  );
});
