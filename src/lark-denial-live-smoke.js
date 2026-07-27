import fs from 'node:fs';
import path from 'node:path';

import { appendProviderSuffix } from './bot-instance-utils.js';
import {
  readLarkDenialAcceptanceState,
  resolveLarkDenialAcceptanceStateFile,
} from './lark-denial-acceptance.js';
import { appendPlatformInstanceSuffix } from './platform-instance-utils.js';
import { parseConversationKey } from './platforms/conversation-key.js';

const DEFAULT_WAIT_MS = 0;
const MAX_WAIT_MS = 10 * 60_000;

const SAFE_ERROR_MESSAGES = Object.freeze({
  lark_denial_live_active_instance_unavailable: 'Exactly one active Lark runtime is required.',
  lark_denial_live_cli_error: 'A lark-cli read or write operation failed.',
  lark_denial_live_group_unavailable: 'Exactly one accessible group from the active session state is required.',
  lark_denial_live_identity_unavailable: 'Ready bot and user identities are required.',
  lark_denial_live_owner_allowlist_invalid: 'The active Lark runtime must allow only the current CLI user.',
  lark_denial_live_second_user_unavailable: 'A second user must join the acceptance group before preparation.',
  lark_denial_live_pending: 'An unexpired denial acceptance is already pending.',
  lark_denial_live_prepare_failed: 'The shared acceptance card could not be prepared.',
  lark_denial_live_not_prepared: 'No prepared denial acceptance is available.',
  lark_denial_live_not_observed: 'The second-user denial callback has not been observed.',
  lark_denial_live_shared_mutation: 'The prepared shared card changed during denial handling.',
  lark_denial_live_consumer_started: 'The live denial smoke unexpectedly started an event consumer.',
});

function normalizeText(value) {
  return String(value || '').trim();
}

function parseBoundedWait(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_WAIT_MS) {
    throw new TypeError(`--wait-ms must be an integer from 0 to ${MAX_WAIT_MS}.`);
  }
  return parsed;
}

function isProcessAlive(pid, processRef = process) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    processRef.kill(value, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function parseActiveLockName(filename) {
  const match = /^bot(?:\.([a-z0-9_-]+))?\.lark\.([a-z0-9_-]+)\.lock$/i.exec(filename);
  if (!match) return null;
  return {
    botProvider: normalizeText(match[1]).toLowerCase() || null,
    instanceId: normalizeText(match[2]).toLowerCase(),
  };
}

export function parseLarkDenialLiveSmokeArgs(argv = []) {
  const options = {
    mode: 'preflight',
    help: false,
    json: false,
    waitMs: DEFAULT_WAIT_MS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--prepare') {
      if (options.mode !== 'preflight') throw new TypeError('--prepare and --verify are mutually exclusive.');
      options.mode = 'prepare';
    } else if (arg === '--verify') {
      if (options.mode !== 'preflight') throw new TypeError('--prepare and --verify are mutually exclusive.');
      options.mode = 'verify';
    } else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--wait-ms') {
      index += 1;
      if (argv[index] === undefined) throw new TypeError('--wait-ms requires a value.');
      options.waitMs = parseBoundedWait(argv[index]);
    } else if (arg.startsWith('--wait-ms=')) {
      options.waitMs = parseBoundedWait(arg.slice('--wait-ms='.length));
    } else throw new TypeError(`Unknown option: ${arg}`);
  }
  if (options.waitMs && options.mode !== 'prepare') {
    throw new TypeError('--wait-ms requires --prepare.');
  }
  return options;
}

export function discoverActiveLarkRuntime({
  dataDir,
  fsImpl = fs,
  processRef = process,
} = {}) {
  const directory = path.resolve(String(dataDir || 'data'));
  let filenames = [];
  try {
    filenames = fsImpl.readdirSync(directory);
  } catch {
    filenames = [];
  }
  const runtimes = [];
  for (const filename of filenames) {
    const parsed = parseActiveLockName(filename);
    if (!parsed) continue;
    try {
      const lock = JSON.parse(fsImpl.readFileSync(path.join(directory, filename), 'utf8'));
      if (!isProcessAlive(lock?.pid, processRef)) continue;
    } catch {
      continue;
    }
    const sessionBase = appendProviderSuffix('sessions.json', parsed.botProvider);
    runtimes.push({
      ...parsed,
      lockFile: path.join(directory, filename),
      sessionFile: path.join(directory, appendPlatformInstanceSuffix(sessionBase, {
        platformId: 'lark',
        instanceId: parsed.instanceId,
      })),
      acceptanceFile: resolveLarkDenialAcceptanceStateFile({
        dataDir: directory,
        instanceId: parsed.instanceId,
        botProvider: parsed.botProvider,
      }),
    });
  }
  return runtimes;
}

export function extractLarkSessionConversationIds(sessionState) {
  const ids = new Set();
  for (const key of Object.keys(sessionState?.threads || {})) {
    try {
      const parsed = parseConversationKey(key);
      if (parsed.platformId === 'lark') ids.add(parsed.conversationId);
    } catch {
      // Ignore legacy or malformed session keys; they cannot identify a live Lark group safely.
    }
  }
  return [...ids];
}

export function inspectLarkDenialLiveMembers(payload) {
  const users = payload?.data?.users || payload?.users || [];
  const truncations = payload?.data?.truncations || payload?.truncations || [];
  const userCount = Array.isArray(users)
    ? users.length
    : Math.max(0, Number(payload?.data?.user_total || payload?.user_total || 0));
  return {
    ok: userCount >= 2 && !(Array.isArray(truncations) && truncations.length),
    userCount,
    secondUserReady: userCount >= 2,
    truncated: Array.isArray(truncations) && truncations.length > 0,
  };
}

export function inspectLarkDenialOwnerAllowlist(value, ownerUserId) {
  const owner = normalizeText(ownerUserId);
  const ids = String(value || '').split(',').map(normalizeText).filter(Boolean);
  return {
    ok: Boolean(owner) && ids.length === 1 && ids[0] === owner,
    allowedUserCount: ids.length,
    ownerAllowed: Boolean(owner) && ids.includes(owner),
  };
}

export function inspectPendingLarkDenialAcceptance(filePath, {
  fsImpl = fs,
  now = Date.now,
} = {}) {
  const state = readLarkDenialAcceptanceState(filePath, { fsImpl });
  const expiresAt = Date.parse(String(state?.expiresAt || ''));
  const unexpired = Boolean(state)
    && Number.isFinite(expiresAt)
    && expiresAt > (Number(now()) || Date.now());
  return {
    exists: Boolean(state),
    pending: unexpired && state.status === 'prepared',
    observed: unexpired && state.status === 'observed',
    verified: state?.status === 'verified',
    state,
  };
}

export function createLarkDenialPreparedState({
  chatId,
  messageId,
  componentId,
  ownerUserId,
  cardHash,
  now = Date.now,
  ttlMs = 24 * 60 * 60_000,
} = {}) {
  const currentTime = Number(now()) || Date.now();
  const fields = {
    chatId: normalizeText(chatId),
    messageId: normalizeText(messageId),
    componentId: normalizeText(componentId),
    ownerUserId: normalizeText(ownerUserId),
    cardHash: normalizeText(cardHash),
  };
  if (Object.values(fields).some((value) => !value)) {
    throw new TypeError('Lark denial acceptance preparation requires complete state.');
  }
  return {
    version: 1,
    status: 'prepared',
    preparedAt: new Date(currentTime).toISOString(),
    expiresAt: new Date(currentTime + Math.max(60_000, Number(ttlMs) || 0)).toISOString(),
    ...fields,
    evidence: {
      actorDifferentFromOwner: false,
      privateDeliverySucceeded: false,
      privateChatSeparatedFromGroup: false,
    },
  };
}

export function formatLarkDenialLiveSmokeError(error) {
  return SAFE_ERROR_MESSAGES[normalizeText(error?.code)] || 'Lark live private-denial acceptance failed.';
}

export function createLarkDenialLiveError(code) {
  const error = new Error(SAFE_ERROR_MESSAGES[code] || 'Lark live private-denial acceptance failed.');
  error.code = code;
  return error;
}
