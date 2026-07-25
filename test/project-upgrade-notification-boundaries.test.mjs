import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const schedulerSource = fs.readFileSync(
  path.join(testDir, '..', 'src', 'project-upgrade-scheduler.js'),
  'utf8',
);

test('project upgrade scheduler delivers notifications only through the platform port', () => {
  assert.match(schedulerSource, /resolvedNotificationDelivery\.sendNotification/);
  assert.doesNotMatch(schedulerSource, /getClient/);
  assert.doesNotMatch(schedulerSource, /channels\?*\.fetch|channels\.fetch/);
  assert.doesNotMatch(schedulerSource, /channel\?*\.send|channel\.send/);
  assert.doesNotMatch(schedulerSource, /discord/i);
});
