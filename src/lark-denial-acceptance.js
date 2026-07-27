import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { appendProviderSuffix } from './bot-instance-utils.js';
import { appendPlatformInstanceSuffix } from './platform-instance-utils.js';

const STATE_VERSION = 1;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeJson(value) {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, normalizeJson(value[key])]),
  );
}

function normalizeMessageItems(payload) {
  const items = Array.isArray(payload)
    ? payload
    : payload?.data?.items || payload?.data?.messages || payload?.items || payload?.messages;
  return Array.isArray(items) ? items : (payload?.data ? [payload.data] : []);
}

function readCardContent(message) {
  const raw = message?.body?.content || message?.content;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function atomicWriteJson(filePath, value, fsImpl = fs) {
  const directory = path.dirname(filePath);
  fsImpl.mkdirSync(directory, { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fsImpl.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fsImpl.renameSync(temporary, filePath);
  } finally {
    try {
      fsImpl.unlinkSync(temporary);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

export function resolveLarkDenialAcceptanceStateFile({
  dataDir,
  instanceId = 'default',
  botProvider = null,
} = {}) {
  const base = appendProviderSuffix('lark-denial-acceptance.json', botProvider);
  return path.join(String(dataDir || ''), appendPlatformInstanceSuffix(base, {
    platformId: 'lark',
    instanceId,
  }));
}

export function hashLarkDenialAcceptanceCard(card) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(normalizeJson(card || {})))
    .digest('hex');
}

export function buildLarkDenialAcceptanceCard({
  ownerUserId,
  nonce = crypto.randomBytes(8).toString('hex'),
} = {}) {
  const owner = normalizeText(ownerUserId);
  const generation = normalizeText(nonce).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 16);
  if (!/^[a-z0-9_-]{1,64}$/i.test(owner)) {
    throw new TypeError('Lark denial acceptance requires a valid owner user ID.');
  }
  if (!generation) throw new TypeError('Lark denial acceptance requires a nonce.');
  const componentId = `stg:nav:main:overview:${owner}:${generation}`;
  return {
    componentId,
    card: {
      config: {
        enable_forward: false,
        update_multi: true,
        wide_screen_mode: true,
      },
      header: {
        template: 'orange',
        title: { tag: 'plain_text', content: '飞书私密拒绝验收' },
      },
      elements: [
        {
          tag: 'markdown',
          content: '请仅由群内第二位、未加入 allowlist 的测试用户点击下方按钮。拒绝结果应只进入该用户与机器人的私聊，本群卡片保持不变。',
        },
        {
          tag: 'action',
          actions: [{
            tag: 'button',
            type: 'primary',
            text: { tag: 'plain_text', content: '验证私密拒绝' },
            value: { id: componentId },
          }],
        },
      ],
    },
  };
}

export function readLarkDenialAcceptanceState(filePath, { fsImpl = fs } = {}) {
  try {
    const value = JSON.parse(fsImpl.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    return null;
  }
}

export function writeLarkDenialAcceptanceState(filePath, state, { fsImpl = fs } = {}) {
  atomicWriteJson(filePath, {
    ...state,
    version: STATE_VERSION,
  }, fsImpl);
}

export function verifyLarkDenialAcceptanceCard(payload, state) {
  const expectedMessageId = normalizeText(state?.messageId);
  const expectedHash = normalizeText(state?.cardHash);
  if (!expectedMessageId || !expectedHash) return false;
  return resolveLarkDenialAcceptanceCardHash(payload, expectedMessageId) === expectedHash;
}

export function resolveLarkDenialAcceptanceCardHash(payload, expectedMessageId) {
  const targetMessageId = normalizeText(expectedMessageId);
  if (!targetMessageId) return null;
  for (const message of normalizeMessageItems(payload)) {
    const messageId = normalizeText(message?.message_id || message?.messageId);
    const card = readCardContent(message);
    if (messageId === targetMessageId && card) return hashLarkDenialAcceptanceCard(card);
  }
  return null;
}

export function createLarkDenialAcceptanceRecorder({
  stateFile,
  fsImpl = fs,
  now = Date.now,
} = {}) {
  const filePath = normalizeText(stateFile);

  async function recordPermissionDenied(event, {
    delivery,
    response,
  } = {}) {
    if (!filePath) return false;
    const state = readLarkDenialAcceptanceState(filePath, { fsImpl });
    if (!state || state.status !== 'prepared') return false;
    const currentTime = Number(now()) || Date.now();
    const expiresAt = Date.parse(String(state.expiresAt || ''));
    if (!Number.isFinite(expiresAt) || expiresAt <= currentTime) return false;

    const actorId = normalizeText(event?.actor?.id);
    const componentId = normalizeText(event?.component?.id);
    const messageId = normalizeText(event?.responseTarget?.messageId);
    const chatId = normalizeText(event?.responseTarget?.chatId);
    const responseMessageId = normalizeText(response?.messageId || response?.id);
    const responseChatId = normalizeText(response?.chatId || response?.responseTarget?.chatId);
    const matchesPreparedCard = componentId === normalizeText(state.componentId)
      && messageId === normalizeText(state.messageId)
      && chatId === normalizeText(state.chatId);
    const actorDifferentFromOwner = Boolean(actorId)
      && actorId !== normalizeText(state.ownerUserId);
    const privateDeliverySucceeded = delivery === 'private'
      && Boolean(responseMessageId)
      && Boolean(responseChatId)
      && responseChatId !== normalizeText(state.chatId);
    if (!matchesPreparedCard || !actorDifferentFromOwner || !privateDeliverySucceeded) return false;

    writeLarkDenialAcceptanceState(filePath, {
      ...state,
      status: 'observed',
      observedAt: new Date(currentTime).toISOString(),
      evidence: {
        actorDifferentFromOwner: true,
        privateDeliverySucceeded: true,
        privateChatSeparatedFromGroup: true,
      },
    }, { fsImpl });
    return true;
  }

  return { recordPermissionDenied };
}
