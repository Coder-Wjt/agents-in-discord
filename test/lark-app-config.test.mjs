import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const configUrl = new URL('../docs/lark-app-config.v1.json', import.meta.url);

test('versioned Lark app config covers message, bot-menu, resource, card, and reaction capabilities', () => {
  const config = JSON.parse(fs.readFileSync(configUrl, 'utf8'));

  assert.equal(config.schemaVersion, 1);
  assert.equal(config.defaultTransport, 'websocket');
  assert.deepEqual(config.transports, ['websocket', 'webhook']);
  assert.deepEqual(config.features, { botMenu: true, nativeSlashCommands: true });
  assert.deepEqual(config.botMenuEventKeys, [
    'status',
    'settings',
    'progress',
    'queue',
    'cancel',
    'new',
    'onboarding',
  ]);
  assert.deepEqual(config.events, ['im.message.receive_v1', 'application.bot.menu_v6']);
  assert.deepEqual(config.callbacks, ['card.action.trigger']);
  assert.deepEqual(new Set(config.tenantScopes), new Set([
    'im:message.group_at_msg:readonly',
    'im:message.p2p_msg:readonly',
    'im:message:readonly',
    'im:message:send_as_bot',
    'im:message:update',
    'im:message:recall',
    'im:resource',
    'im:message.reactions:read',
    'im:message.reactions:write_only',
  ]));
  assert.deepEqual(new Set(config.provisioningTenantScopes), new Set([
    'application:app_slash_command:read',
    'application:app_slash_command:write',
  ]));
});
