import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCommandSpecs } from '../src/command-spec.js';
import {
  buildCodexSideBoundaryText,
  buildCodexSideDeveloperInstructions,
  formatCodexSideResult,
  formatCodexSideStatus,
} from '../src/codex-side-flow.js';
import { formatProviderForkResult } from '../src/codex-fork-flow.js';
import { createReportFormatters } from '../src/report-formatters.js';
import {
  DEFAULT_CONVERSATION_PRESENTATION,
  assertConversationPresentation,
  createConversationPresentation,
} from '../src/platforms/conversation-presentation.js';
import { createDiscordConversationPresentation } from '../src/platforms/discord/conversation-presentation.js';

test('conversation presentation provides neutral defaults and validated overrides', () => {
  assert.equal(DEFAULT_CONVERSATION_PRESENTATION.getTerm('sourceConversation', 'en'), 'conversation');
  assert.equal(DEFAULT_CONVERSATION_PRESENTATION.getTerm('childConversation', 'zh'), '子会话');

  const presentation = createConversationPresentation({
    terms: {
      childConversation: { en: 'topic', zh: '话题' },
    },
  });
  assert.equal(presentation.getTerm('childConversation', 'en'), 'topic');
  assert.equal(presentation.getTerm('childConversation', 'zh'), '话题');
  assert.equal(presentation.getTerm('sourceConversation', 'zh'), '会话');
  assert.equal(assertConversationPresentation(presentation), presentation);
  assert.throws(() => presentation.getTerm('unknown', 'en'), /Unknown conversation presentation term/);
  assert.throws(
    () => createConversationPresentation({ terms: { childConversation: { en: '' } } }),
    /childConversation\.en.*non-empty string/,
  );
});

test('Discord conversation presentation preserves command descriptions and help wording', () => {
  const presentation = createDiscordConversationPresentation();
  const specs = buildCommandSpecs({ botProvider: 'codex', conversationPresentation: presentation });
  const fork = specs.find((entry) => entry.name === 'fork');
  const side = specs.find((entry) => entry.name === 'side');

  assert.equal(
    fork.description,
    '用当前 provider 原生 fork 创建一个新的 Discord thread，可选指定 thread 名',
  );
  assert.equal(fork.options[0].description, '可选：新 thread 名；留空自动生成');
  assert.equal(side.options[1].description, '可选：新 side thread 名');

  const formatters = createReportFormatters({
    conversationPresentation: presentation,
    getSessionLanguage: (session) => session.language,
    getSessionProvider: (session) => session.provider,
    getProviderDisplayName: () => 'Codex',
  });
  assert.match(
    formatters.formatHelpReport({ language: 'en', provider: 'codex' }),
    /create a native Codex fork in a new Discord thread/,
  );
  assert.match(
    formatters.formatHelpReport({ language: 'zh', provider: 'codex' }),
    /用 Codex 原生 fork 创建新 Discord thread/,
  );
});

test('Discord conversation presentation preserves fork and side messages exactly', () => {
  const presentation = createDiscordConversationPresentation();

  assert.equal(
    formatProviderForkResult({ ok: false, reason: 'parent_running' }, 'en', presentation),
    '⏳ The parent channel is running. Fork after the current task finishes.',
  );
  assert.equal(
    formatProviderForkResult({ ok: false, reason: 'thread_unavailable' }, 'zh', presentation),
    '❌ 当前 Discord 频道不能创建 fork thread。',
  );
  assert.equal(
    formatCodexSideResult({ ok: false, reason: 'thread_unavailable' }, 'en', presentation),
    '❌ This Discord channel cannot create a side thread.',
  );
  assert.equal(
    formatCodexSideResult({ ok: false, reason: 'nested_side' }, 'zh', presentation),
    '❌ side 线程里不能再开 side。',
  );

  const status = formatCodexSideStatus({
    openSideConversation: {
      status: 'open',
      parentChannelId: 'parent-1',
      sideChannelId: 'side-1',
      sideSessionId: 'side-session-1',
      parentSessionId: 'parent-session-1',
      openedAt: '2026-07-24T00:00:00.000Z',
    },
  }, 'zh', { running: false, queued: 0 }, {
    formatConversationReference: (id) => `<#${id}>`,
  }, presentation);
  assert.match(status, /^Codex side conversation 已打开，是临时线程。/);
  assert.match(status, /• parent thread: <#parent-1>/);
  assert.match(status, /• side thread: <#side-1>/);
});

test('Discord conversation presentation preserves side runtime instructions exactly', () => {
  const presentation = createDiscordConversationPresentation();

  assert.equal(buildCodexSideBoundaryText(presentation), [
    'You are now in a Codex side conversation.',
    'Treat this as a temporary read-only side track by default.',
    'Do not change parent session goals, progress, queue, compact state, or reply delivery.',
    'Do not modify files or run destructive actions unless the user explicitly asks for edits inside this side thread.',
    'When answering, stay focused on the side question and do not claim that parent state changed.',
  ].join('\n'));
  assert.equal(buildCodexSideDeveloperInstructions(presentation), [
    'Side conversation rules:',
    '- This is an ephemeral side thread forked from the parent Codex thread.',
    '- Prefer explanation, inspection, and lightweight non-destructive exploration.',
    '- File edits require an explicit user request in this side Discord thread.',
    '- Never update or complete the parent goal from this side conversation.',
  ].join('\n'));
});
