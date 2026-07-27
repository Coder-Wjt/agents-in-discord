import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildLarkDenialAcceptanceCard,
  createLarkDenialAcceptanceRecorder,
  hashLarkDenialAcceptanceCard,
  readLarkDenialAcceptanceState,
  resolveLarkDenialAcceptanceCardHash,
  resolveLarkDenialAcceptanceStateFile,
  verifyLarkDenialAcceptanceCard,
  writeLarkDenialAcceptanceState,
} from '../src/lark-denial-acceptance.js';
import { createLarkDenialPreparedState } from '../src/lark-denial-live-smoke.js';

test('Lark denial acceptance builds a production-recognized card and stable hash', () => {
  const { card, componentId } = buildLarkDenialAcceptanceCard({
    ownerUserId: 'ou_owner',
    nonce: 'abc123',
  });
  assert.equal(componentId, 'stg:nav:main:overview:ou_owner:abc123');
  assert.equal(card.elements[1].actions[0].value.id, componentId);
  assert.equal(
    hashLarkDenialAcceptanceCard({ b: 2, a: { d: 4, c: 3 } }),
    hashLarkDenialAcceptanceCard({ a: { c: 3, d: 4 }, b: 2 }),
  );
});

test('Lark denial acceptance verifies that the prepared shared card stayed unchanged', () => {
  const { card, componentId } = buildLarkDenialAcceptanceCard({
    ownerUserId: 'ou_owner',
    nonce: 'abc123',
  });
  const state = createLarkDenialPreparedState({
    chatId: 'oc_group',
    messageId: 'om_shared',
    componentId,
    ownerUserId: 'ou_owner',
    cardHash: hashLarkDenialAcceptanceCard(card),
    now: () => Date.parse('2026-07-27T00:00:00.000Z'),
  });
  assert.equal(verifyLarkDenialAcceptanceCard({
    data: {
      items: [{
        message_id: 'om_shared',
        body: { content: JSON.stringify(card) },
      }],
    },
  }, state), true);
  assert.equal(verifyLarkDenialAcceptanceCard({
    data: {
      items: [{
        message_id: 'om_shared',
        body: { content: JSON.stringify({ ...card, elements: [] }) },
      }],
    },
  }, state), false);
  const transformed = {
    title: 'server-normalized',
    elements: [{ tag: 'div' }],
  };
  const transformedPayload = {
    data: {
      items: [{
        message_id: 'om_shared',
        body: { content: JSON.stringify(transformed) },
      }],
    },
  };
  const transformedHash = resolveLarkDenialAcceptanceCardHash(
    transformedPayload,
    'om_shared',
  );
  assert.equal(verifyLarkDenialAcceptanceCard(transformedPayload, {
    ...state,
    cardHash: transformedHash,
  }), true);
});

test('Lark denial acceptance recorder stores a private receipt without the denied actor or DM ids', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lark-denial-acceptance-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, 'state.json');
  const prepared = createLarkDenialPreparedState({
    chatId: 'oc_group',
    messageId: 'om_shared',
    componentId: 'stg:nav:main:overview:ou_owner:abc123',
    ownerUserId: 'ou_owner',
    cardHash: 'hash',
    now: () => Date.parse('2026-07-27T00:00:00.000Z'),
  });
  writeLarkDenialAcceptanceState(stateFile, prepared);
  const recorder = createLarkDenialAcceptanceRecorder({
    stateFile,
    now: () => Date.parse('2026-07-27T00:01:00.000Z'),
  });
  const recorded = await recorder.recordPermissionDenied({
    actor: { id: 'ou_intruder' },
    component: { id: prepared.componentId },
    responseTarget: { chatId: 'oc_group', messageId: 'om_shared' },
  }, {
    delivery: 'private',
    response: { messageId: 'om_private', chatId: 'oc_private' },
  });
  assert.equal(recorded, true);
  const state = readLarkDenialAcceptanceState(stateFile);
  assert.equal(state.status, 'observed');
  assert.deepEqual(state.evidence, {
    actorDifferentFromOwner: true,
    privateDeliverySucceeded: true,
    privateChatSeparatedFromGroup: true,
  });
  assert.doesNotMatch(JSON.stringify(state), /ou_intruder|om_private|oc_private/);
});

test('Lark denial acceptance recorder ignores owner clicks and unrelated cards', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lark-denial-acceptance-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, 'state.json');
  const prepared = createLarkDenialPreparedState({
    chatId: 'oc_group',
    messageId: 'om_shared',
    componentId: 'stg:nav:main:overview:ou_owner:abc123',
    ownerUserId: 'ou_owner',
    cardHash: 'hash',
    now: () => Date.parse('2026-07-27T00:00:00.000Z'),
  });
  writeLarkDenialAcceptanceState(stateFile, prepared);
  const recorder = createLarkDenialAcceptanceRecorder({
    stateFile,
    now: () => Date.parse('2026-07-27T00:01:00.000Z'),
  });
  assert.equal(await recorder.recordPermissionDenied({
    actor: { id: 'ou_owner' },
    component: { id: prepared.componentId },
    responseTarget: { chatId: prepared.chatId, messageId: prepared.messageId },
  }, {
    delivery: 'private',
    response: { messageId: 'om_private', chatId: 'oc_private' },
  }), false);
  assert.equal(await recorder.recordPermissionDenied({
    actor: { id: 'ou_intruder' },
    component: { id: 'stg:nav:main:overview:ou_owner:different' },
    responseTarget: { chatId: prepared.chatId, messageId: prepared.messageId },
  }, {
    delivery: 'private',
    response: { messageId: 'om_private', chatId: 'oc_private' },
  }), false);
  assert.equal(readLarkDenialAcceptanceState(stateFile).status, 'prepared');
});

test('Lark denial acceptance state filenames stay provider and instance isolated', () => {
  assert.equal(
    path.basename(resolveLarkDenialAcceptanceStateFile({
      dataDir: '/tmp/data',
      instanceId: 'prod',
      botProvider: 'codex',
    })),
    'lark-denial-acceptance.codex.lark.prod.json',
  );
});
