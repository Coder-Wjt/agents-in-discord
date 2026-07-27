import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertInboundInteractionEvent,
  assertInboundMessageEvent,
  assertPlatformAdapter,
} from '../../src/platforms/index.js';

const REQUIRED_DRIVER_METHODS = Object.freeze([
  'ordinaryMessage',
  'command',
  'cancel',
  'attachments',
  'capabilityDegradation',
  'childConversation',
  'errorRecovery',
]);

function assertDriver(driver, platformName) {
  assertPlatformAdapter(driver?.adapter);
  for (const method of REQUIRED_DRIVER_METHODS) {
    assert.equal(
      typeof driver?.[method],
      'function',
      `${platformName} conformance driver must provide ${method}()`,
    );
  }
  return driver;
}

export function definePlatformAdapterConformance({ platformName, createDriver } = {}) {
  const label = String(platformName || '').trim();
  if (!label) throw new TypeError('Platform conformance suite requires platformName.');
  if (typeof createDriver !== 'function') {
    throw new TypeError('Platform conformance suite requires createDriver().');
  }
  const getDriver = () => assertDriver(createDriver(), label);

  test(`${label} Adapter conformance: ordinary messages reach the prompt route`, async () => {
    const result = await getDriver().ordinaryMessage();
    assertInboundMessageEvent(result.event);
    assert.equal(result.event.platformId, result.adapterId);
    assert.equal(result.event.actor.id, 'user-1');
    assert.equal(result.event.conversation.id, result.expectedConversationId || 'conversation-1');
    assert.equal(result.event.text, 'hello adapter');
    assert.equal(result.dispatch.kind, 'prompt');
    assert.equal(result.dispatch.actorId, 'user-1');
    assert.equal(result.dispatch.conversationId, result.expectedConversationId || 'conversation-1');
    assert.equal(result.dispatch.content, 'hello adapter');
  });

  test(`${label} Adapter conformance: commands normalize and route`, async () => {
    const driver = getDriver();
    const result = await driver.command();
    if (result.event) {
      assertInboundInteractionEvent(result.event);
      assert.equal(result.event.kind, 'command');
      assert.equal(result.event.command.name, 'status');
      assert.equal(result.event.command.getOption('detail'), 'full');
    } else {
      assert.equal(
        result.route.mode,
        driver.adapter.capabilities.slashCommands ? 'native_text' : 'text',
      );
    }
    assert.equal(result.route.commandName, 'status');
    assert.equal(result.route.actorId, 'user-1');
    assert.equal(result.route.conversationId, result.expectedConversationId || 'conversation-1');
  });

  test(`${label} Adapter conformance: cancel reaches the shared command core`, async () => {
    const result = await getDriver().cancel();
    assert.deepEqual(result.cancel, {
      conversationId: result.expectedConversationId || 'conversation-1',
      reason: 'text_command:!cancel',
    });
    assert.equal(result.promptCount, 0);
    assert.match(result.reply, /cancel/i);
  });

  test(`${label} Adapter conformance: attachments stay normalized through prompt routing`, async () => {
    const result = await getDriver().attachments();
    assertInboundMessageEvent(result.event);
    assert.deepEqual(result.event.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      url: attachment.url,
    })), [{
      id: 'attachment-1',
      name: 'brief.png',
      mimeType: 'image/png',
      sizeBytes: 42,
      url: 'https://cdn.example/brief.png',
    }]);
    assert.equal(result.dispatch.attachmentCount, 1);
    assert.match(result.dispatch.content, /Attachments:/);
    assert.match(result.dispatch.content, /brief\.png/);
  });

  test(`${label} Adapter conformance: unsupported capabilities degrade without raw operations`, async () => {
    const result = await getDriver().capabilityDegradation();
    assert.deepEqual(result.attachments, []);
    assert.equal(result.editCalls, 0);
    assert.equal(result.statusCalls, 0);
    assert.equal(result.threadCreateListener, false);
    assert.equal(result.threadSyncListener, false);
  });

  test(`${label} Adapter conformance: child conversations preserve normalized topology`, async () => {
    const driver = getDriver();
    const result = await driver.childConversation();
    if (result.unsupported) {
      assert.equal(driver.adapter.capabilities.threads, false);
      assert.equal(driver.adapter.conversationSpawn.canSpawn(result.source), false);
      return;
    }
    assert.equal(result.spawnedId, result.expectedSpawnedId || 'child-conversation-1');
    assert.equal(result.joined, true);
    assert.equal(result.requestedName, 'Child conversation');
    assert.equal(result.prompt.actor.id, 'user-1');
    assert.equal(result.prompt.conversation.id, result.expectedSpawnedId || 'child-conversation-1');
    assert.equal(result.prompt.conversation.parentId, result.expectedParentId || 'conversation-1');
    assert.equal(result.prompt.conversation.isThread, true);
    assert.equal(result.notice, 'child ready');
  });

  test(`${label} Adapter conformance: entry failures are visible and lifecycle recovery remains wired`, async () => {
    const result = await getDriver().errorRecovery();
    assert.deepEqual(result.statuses, result.expectedStatuses || ['failed']);
    assert.match(result.reply, /adapter boom/);
    assert.deepEqual(
      result.selfHealReasons,
      result.expectedSelfHealReasons || ['shard_disconnect:2:code=1006'],
    );
  });
}
