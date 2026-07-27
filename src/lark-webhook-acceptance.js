import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { appendProviderSuffix } from './bot-instance-utils.js';
import { appendPlatformInstanceSuffix } from './platform-instance-utils.js';

const STATE_VERSION = 1;

export const LARK_WEBHOOK_ACCEPTANCE_EVIDENCE_KEYS = Object.freeze([
  'localHealthReady', 'publicHealthReady',
  'signedRequestVerified', 'encryptedRequestVerified', 'challengeVerified',
  'messageEventHandled', 'nativeSlashCommandHandled',
  'botMenuHandled', 'cardActionHandled',
  'applicationRestartObserved', 'proxyRestartObserved',
]);

const EVENT_EVIDENCE_KEYS = Object.freeze({
  message: 'messageEventHandled', nativeSlashCommand: 'nativeSlashCommandHandled',
  botMenu: 'botMenuHandled', cardAction: 'cardActionHandled',
});

function normalizeText(value) {
  return String(value || '').trim();
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

function normalizeEvidence(value = {}) {
  return Object.fromEntries(
    LARK_WEBHOOK_ACCEPTANCE_EVIDENCE_KEYS.map((key) => [key, value?.[key] === true]),
  );
}

function isActiveState(state, now = Date.now) {
  const expiresAt = Date.parse(String(state?.expiresAt || ''));
  return Boolean(state)
    && ['prepared', 'observed'].includes(state.status)
    && Number.isFinite(expiresAt)
    && expiresAt > (Number(now()) || Date.now());
}

export function resolveLarkWebhookAcceptanceStateFile({
  dataDir,
  instanceId = 'default',
  botProvider = null,
} = {}) {
  const base = appendProviderSuffix('lark-webhook-acceptance.json', botProvider);
  return path.join(String(dataDir || ''), appendPlatformInstanceSuffix(base, {
    platformId: 'lark',
    instanceId,
  }));
}

export function resolveLarkProcessBootFingerprint(pid = process.pid, { fsImpl = fs } = {}) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return '';
  try {
    const stat = fsImpl.readFileSync(`/proc/${numericPid}/stat`, 'utf8');
    const closingParen = stat.lastIndexOf(')');
    const fields = stat.slice(closingParen + 1).trim().split(/\s+/);
    const startTime = normalizeText(fields[19]);
    if (!startTime) return '';
    return crypto.createHash('sha256')
      .update(`${numericPid}:${startTime}`)
      .digest('hex');
  } catch {
    return '';
  }
}

export function createLarkWebhookPreparedState({
  bootFingerprint,
  localHealthReady = false,
  publicHealthReady = false,
  now = Date.now,
  ttlMs = 24 * 60 * 60_000,
} = {}) {
  const preparedBootFingerprint = normalizeText(bootFingerprint);
  if (!preparedBootFingerprint) {
    throw new TypeError('Lark webhook acceptance requires a runtime boot fingerprint.');
  }
  const currentTime = Number(now()) || Date.now();
  return {
    version: STATE_VERSION,
    status: 'prepared',
    preparedAt: new Date(currentTime).toISOString(),
    expiresAt: new Date(currentTime + Math.max(60_000, Number(ttlMs) || 0)).toISOString(),
    preparedBootFingerprint,
    evidence: normalizeEvidence({ localHealthReady, publicHealthReady }),
  };
}

export function readLarkWebhookAcceptanceState(filePath, { fsImpl = fs } = {}) {
  try {
    const value = JSON.parse(fsImpl.readFileSync(filePath, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return { ...value, evidence: normalizeEvidence(value.evidence) };
  } catch {
    return null;
  }
}

export function writeLarkWebhookAcceptanceState(filePath, state, { fsImpl = fs } = {}) {
  atomicWriteJson(filePath, {
    ...state,
    version: STATE_VERSION,
    evidence: normalizeEvidence(state?.evidence),
  }, fsImpl);
}

export function mergeLarkWebhookAcceptanceEvidence(filePath, evidence, {
  fsImpl = fs,
  now = Date.now,
} = {}) {
  const state = readLarkWebhookAcceptanceState(filePath, { fsImpl });
  if (!isActiveState(state, now)) return false;
  const allowed = normalizeEvidence(evidence);
  const merged = Object.fromEntries(LARK_WEBHOOK_ACCEPTANCE_EVIDENCE_KEYS.map((key) => [
    key,
    state.evidence[key] === true || allowed[key] === true,
  ]));
  writeLarkWebhookAcceptanceState(filePath, {
    ...state,
    status: 'observed',
    observedAt: state.observedAt || new Date(Number(now()) || Date.now()).toISOString(),
    evidence: merged,
  }, { fsImpl });
  return true;
}

export function inspectLarkWebhookAcceptance(state, { now = Date.now } = {}) {
  const evidence = normalizeEvidence(state?.evidence);
  const missing = LARK_WEBHOOK_ACCEPTANCE_EVIDENCE_KEYS.filter((key) => !evidence[key]);
  return {
    exists: Boolean(state),
    active: isActiveState(state, now),
    verified: state?.status === 'verified',
    complete: missing.length === 0,
    missing,
    evidence,
  };
}

export function createLarkWebhookAcceptanceRecorder({
  stateFile,
  bootFingerprint = resolveLarkProcessBootFingerprint(),
  fsImpl = fs,
  now = Date.now,
} = {}) {
  const filePath = normalizeText(stateFile);
  const currentBootFingerprint = normalizeText(bootFingerprint);

  function record(evidence) {
    if (!filePath) return false;
    const state = readLarkWebhookAcceptanceState(filePath, { fsImpl });
    const applicationRestartObserved = Boolean(
      currentBootFingerprint
      && normalizeText(state?.preparedBootFingerprint)
      && currentBootFingerprint !== normalizeText(state.preparedBootFingerprint)
    );
    return mergeLarkWebhookAcceptanceEvidence(filePath, {
      ...evidence,
      applicationRestartObserved,
    }, { fsImpl, now });
  }

  async function recordVerifiedRequest({
    encrypted = false,
    challenge = false,
    signed = false,
  } = {}) {
    return record({
      signedRequestVerified: signed === true,
      encryptedRequestVerified: encrypted === true,
      challengeVerified: challenge === true,
    });
  }

  async function recordAcceptedEvent(kind) {
    const key = EVENT_EVIDENCE_KEYS[normalizeText(kind)];
    return key ? record({ [key]: true }) : false;
  }

  return { recordAcceptedEvent, recordVerifiedRequest };
}
