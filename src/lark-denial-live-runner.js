import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { loadRuntimeEnv } from './env-loader.js';
import { createLarkCliChannel } from './lark-cli-channel.js';
import {
  buildLarkDenialAcceptanceCard,
  hashLarkDenialAcceptanceCard,
  verifyLarkDenialAcceptanceCard,
  writeLarkDenialAcceptanceState,
} from './lark-denial-acceptance.js';
import {
  createLarkDenialLiveError,
  createLarkDenialPreparedState,
  discoverActiveLarkRuntime,
  extractLarkSessionConversationIds,
  formatLarkDenialLiveSmokeError,
  inspectLarkDenialLiveMembers,
  inspectLarkDenialOwnerAllowlist,
  inspectPendingLarkDenialAcceptance,
} from './lark-denial-live-smoke.js';
import { inspectLarkDenialSmokeAuth } from './lark-denial-smoke.js';
import { inspectLarkRuntimeConfig } from './lark-runtime-config.js';

function normalizeProfile(value) {
  return String(value || '').trim();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyAcceptance({ executeCli, runtime, state, now }) {
  const payload = await executeCli([
    'api',
    'GET',
    `/open-apis/im/v1/messages/${encodeURIComponent(String(state.messageId || ''))}`,
    '--as',
    'bot',
  ]);
  const sharedCardUnchanged = verifyLarkDenialAcceptanceCard(payload, state);
  if (!sharedCardUnchanged) {
    throw createLarkDenialLiveError('lark_denial_live_shared_mutation');
  }
  const result = {
    ok: Boolean(
      state?.evidence?.actorDifferentFromOwner
      && state?.evidence?.privateDeliverySucceeded
      && state?.evidence?.privateChatSeparatedFromGroup
      && sharedCardUnchanged
    ),
    callbackObserved: state.status === 'observed' || state.status === 'verified',
    actorDifferentFromOwner: state?.evidence?.actorDifferentFromOwner === true,
    privateDeliverySucceeded: state?.evidence?.privateDeliverySucceeded === true,
    privateChatSeparatedFromGroup: state?.evidence?.privateChatSeparatedFromGroup === true,
    sharedCardUnchanged,
  };
  if (result.ok && state.status !== 'verified') {
    writeLarkDenialAcceptanceState(runtime.acceptanceFile, {
      ...state,
      status: 'verified',
      verifiedAt: new Date(Number(now()) || Date.now()).toISOString(),
    });
  }
  return result;
}

export async function runLarkDenialLiveSmoke({
  options,
  rootDir = process.cwd(),
  dataDir = path.join(rootDir, 'data'),
  env = process.env,
  fsImpl = fs,
  processRef = process,
  execFileFn = execFileCallback,
  now = Date.now,
  delayFn = delay,
} = {}) {
  const report = {
    ok: false,
    mode: options?.mode || 'preflight',
    activeRuntime: false,
    productionConsumerReused: false,
    botReady: false,
    userReady: false,
    groupCount: 0,
    groupUserCount: 0,
    secondUserReady: false,
    ownerAllowlistReady: false,
    prepared: false,
    result: null,
  };
  try {
    const runtimes = discoverActiveLarkRuntime({ dataDir, fsImpl, processRef });
    if (runtimes.length !== 1) {
      throw createLarkDenialLiveError('lark_denial_live_active_instance_unavailable');
    }
    const runtime = runtimes[0];
    report.activeRuntime = true;
    report.productionConsumerReused = true;
    if (runtime.botProvider) env.BOT_PROVIDER = runtime.botProvider;
    else delete env.BOT_PROVIDER;
    loadRuntimeEnv({ rootDir, env });
    const config = inspectLarkRuntimeConfig({ botProvider: runtime.botProvider, env }).config;
    const cliEnv = {
      ...env,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
    };
    const withProfile = (args) => normalizeProfile(config.cliProfile)
      ? ['--profile', normalizeProfile(config.cliProfile), ...args]
      : args;
    const execFileAsync = promisify(execFileFn);
    const executeCli = async (args) => {
      try {
        const { stdout } = await execFileAsync(config.cliBin, withProfile(args), {
          cwd: rootDir,
          env: cliEnv,
          maxBuffer: 20 * 1024 * 1024,
        });
        return JSON.parse(stdout);
      } catch {
        throw createLarkDenialLiveError('lark_denial_live_cli_error');
      }
    };
    const [authPayload, userPayload] = await Promise.all([
      executeCli(['auth', 'status', '--verify', '--json']),
      executeCli(['whoami', '--as', 'user']),
    ]);
    const auth = inspectLarkDenialSmokeAuth(authPayload, userPayload);
    report.botReady = auth.botReady;
    report.userReady = auth.userReady;
    if (!auth.ok) throw createLarkDenialLiveError('lark_denial_live_identity_unavailable');

    let sessionState;
    try {
      sessionState = JSON.parse(fsImpl.readFileSync(runtime.sessionFile, 'utf8'));
    } catch {
      throw createLarkDenialLiveError('lark_denial_live_group_unavailable');
    }
    const groupIds = [];
    for (const chatId of extractLarkSessionConversationIds(sessionState)) {
      try {
        const payload = await executeCli([
          'api', 'GET', `/open-apis/im/v1/chats/${encodeURIComponent(chatId)}`, '--as', 'bot',
        ]);
        const item = payload?.data?.items?.[0] || payload?.data || payload || {};
        const mode = String(
          item?.chat_mode || item?.chatMode || item?.chat_type || item?.chatType || '',
        ).trim().toLowerCase();
        if (mode.includes('group')) groupIds.push(chatId);
      } catch {
        // Ignore inaccessible historical conversations; one live group is required below.
      }
    }
    report.groupCount = groupIds.length;
    if (groupIds.length !== 1) {
      throw createLarkDenialLiveError('lark_denial_live_group_unavailable');
    }
    const groupId = groupIds[0];
    const members = inspectLarkDenialLiveMembers(await executeCli([
      'im', '+chat-members-list', '--as', 'user', '--chat-id', groupId,
      '--member-types', 'user', '--page-all', '--json',
    ]));
    report.groupUserCount = members.userCount;
    report.secondUserReady = members.secondUserReady && !members.truncated;
    const ownerAllowlist = inspectLarkDenialOwnerAllowlist(
      env.LARK_ALLOWED_USER_IDS || env.ALLOWED_USER_IDS,
      auth.actorOpenId,
    );
    report.ownerAllowlistReady = ownerAllowlist.ok;
    if (!ownerAllowlist.ok) {
      throw createLarkDenialLiveError('lark_denial_live_owner_allowlist_invalid');
    }

    const pending = inspectPendingLarkDenialAcceptance(runtime.acceptanceFile, { now });
    if (report.mode === 'preflight') {
      if (!report.secondUserReady) {
        throw createLarkDenialLiveError('lark_denial_live_second_user_unavailable');
      }
      if (pending.pending || pending.observed) {
        throw createLarkDenialLiveError('lark_denial_live_pending');
      }
      report.ok = true;
      return report;
    }
    if (report.mode === 'prepare') {
      if (!report.secondUserReady) {
        throw createLarkDenialLiveError('lark_denial_live_second_user_unavailable');
      }
      if (pending.pending || pending.observed) {
        throw createLarkDenialLiveError('lark_denial_live_pending');
      }
      const { card, componentId } = buildLarkDenialAcceptanceCard({ ownerUserId: auth.actorOpenId });
      const channel = createLarkCliChannel({
        cliBin: config.cliBin,
        profile: config.cliProfile,
        cwd: rootDir,
        env: cliEnv,
        execFileFn: execFileAsync,
        logger: { log() {}, warn() {}, error() {} },
      });
      const before = channel.getConnectionStatus();
      const sent = await channel.send(groupId, { card });
      const after = channel.getConnectionStatus();
      if (Number(before.consumerCount || 0) !== 0
        || Number(after.consumerCount || 0) !== 0
        || after.state !== 'idle') {
        throw createLarkDenialLiveError('lark_denial_live_consumer_started');
      }
      if (!sent?.messageId || !sent?.chatId) {
        throw createLarkDenialLiveError('lark_denial_live_prepare_failed');
      }
      writeLarkDenialAcceptanceState(runtime.acceptanceFile, createLarkDenialPreparedState({
        chatId: sent.chatId,
        messageId: sent.messageId,
        componentId,
        ownerUserId: auth.actorOpenId,
        cardHash: hashLarkDenialAcceptanceCard(card),
        now,
      }));
      report.prepared = true;
      report.ok = true;
      if (!options?.waitMs) return report;
      const deadline = (Number(now()) || Date.now()) + options.waitMs;
      let observed = inspectPendingLarkDenialAcceptance(runtime.acceptanceFile, { now });
      while (!observed.observed && (Number(now()) || Date.now()) < deadline) {
        await delayFn(Math.min(1000, Math.max(100, deadline - (Number(now()) || Date.now()))));
        observed = inspectPendingLarkDenialAcceptance(runtime.acceptanceFile, { now });
      }
      if (!observed.observed) {
        throw createLarkDenialLiveError('lark_denial_live_not_observed');
      }
      report.result = await verifyAcceptance({ executeCli, runtime, state: observed.state, now });
      report.ok = report.result.ok;
      return report;
    }
    if (!pending.exists) throw createLarkDenialLiveError('lark_denial_live_not_prepared');
    if (!pending.observed && !pending.verified) {
      throw createLarkDenialLiveError('lark_denial_live_not_observed');
    }
    report.result = await verifyAcceptance({ executeCli, runtime, state: pending.state, now });
    report.ok = report.result.ok;
    return report;
  } catch (error) {
    report.ok = false;
    report.error = formatLarkDenialLiveSmokeError(error);
    return report;
  }
}
