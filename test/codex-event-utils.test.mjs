import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProgressEventDedupeKey,
  composeFinalAnswerText,
  createProgressEventDeduper,
  extractAgentMessageText,
  extractCodexAgentMessageForNarration,
  getAgentMessagePhase,
  isFinalAnswerLikeAgentMessage,
  stripCodexControlBlocks,
} from '../src/codex-event-utils.js';
import {
  extractRawProgressTextFromEvent,
  summarizeCodexEvent,
} from '../src/progress-utils.js';

test('extractAgentMessageText reads direct text and content fallback', () => {
  assert.equal(
    extractAgentMessageText({ type: 'agent_message', text: '  第一段  ' }),
    '第一段',
  );
  assert.equal(
    extractAgentMessageText({
      type: 'agent_message',
      content: [{ type: 'output_text', text: '第二段' }],
    }),
    '第二段',
  );
  assert.equal(
    extractAgentMessageText({
      type: 'assistant',
      message: {
        type: 'message',
        content: [{ type: 'text', text: '第三段' }],
      },
    }),
    '第三段',
  );
});

test('extractAgentMessageText keeps markdown line breaks', () => {
  const text = extractAgentMessageText({
    type: 'agent_message',
    text: '  结论：\n1. 第一条\n2. 第二条\n\n```txt\nline a\nline b\n```  ',
  });
  assert.equal(text, '结论：\n1. 第一条\n2. 第二条\n\n```txt\nline a\nline b\n```');
});

test('extractAgentMessageText strips subagent notification control blocks', () => {
  const text = extractAgentMessageText({
    type: 'agent_message',
    message: [
      '第一段正常总结。',
      '<subagent_notification>',
      '{"agent_path":"sub-1","status":{"completed":"很长的子任务原始输出"}}',
      '</subagent_notification>',
      '第二段正常总结。',
    ].join('\n'),
  });

  assert.equal(text, '第一段正常总结。\n\n第二段正常总结。');
  assert.equal(
    stripCodexControlBlocks('<subagent_notification>{"agent_path":"sub-1"}</subagent_notification>'),
    '',
  );
});

test('getAgentMessagePhase normalizes phase and defaults empty', () => {
  assert.equal(getAgentMessagePhase({ phase: 'Final.Answer' }), 'final_answer');
  assert.equal(getAgentMessagePhase({ message: { phase: 'commentary' } }), 'commentary');
  assert.equal(getAgentMessagePhase({}), '');
});

test('isFinalAnswerLikeAgentMessage excludes commentary items', () => {
  assert.equal(
    isFinalAnswerLikeAgentMessage({ type: 'agent_message', phase: 'commentary', text: '过程消息' }),
    false,
  );
  assert.equal(
    isFinalAnswerLikeAgentMessage({ type: 'agent_message', phase: 'final_answer', text: '最终答案' }),
    true,
  );
  assert.equal(
    isFinalAnswerLikeAgentMessage({ type: 'agent_message', text: '无 phase 也按最终答案处理' }),
    true,
  );
});

test('composeFinalAnswerText keeps all final answer segments', () => {
  const text = composeFinalAnswerText({
    messages: ['过程消息', '最终答案 A', '最终答案 B'],
    finalAnswerMessages: ['最终答案 A', '最终答案 B'],
  });
  assert.equal(text, '最终答案 A\n\n最终答案 B');
});

test('composeFinalAnswerText preserves paragraph structure in final answer', () => {
  const text = composeFinalAnswerText({
    messages: ['过程消息'],
    finalAnswerMessages: ['结论：\n- A\n- B', '证据：\n```txt\nx\ny\n```'],
  });
  assert.equal(text, '结论：\n- A\n- B\n\n证据：\n```txt\nx\ny\n```');
});

test('composeFinalAnswerText does not promote process messages when no final segments exist', () => {
  const text = composeFinalAnswerText({
    messages: ['过程消息 A', '过程消息 B'],
    finalAnswerMessages: [],
  });
  assert.equal(text, '');
});

test('buildProgressEventDedupeKey prefers raw activity and normalizes case/space', () => {
  const key = buildProgressEventDedupeKey({
    summaryStep: 'agent message: 正在检查日志',
    rawActivity: '  正在检查日志  ',
    completedStep: '',
    planSummary: '',
  });
  assert.equal(key, 'raw:正在检查日志');
});

test('createProgressEventDeduper drops duplicates only inside ttl window', () => {
  const isDuplicate = createProgressEventDeduper({ ttlMs: 3000, maxKeys: 16 });
  assert.equal(isDuplicate('raw:正在检查日志', 1000), false);
  assert.equal(isDuplicate('raw:正在检查日志', 1200), true);
  assert.equal(isDuplicate('raw:正在检查日志', 4500), false);
});

test('bridge and stdout events map to one dedupe key for same activity text', () => {
  const stdoutEvent = {
    type: 'response.output_text.delta',
    delta: '正在检查日志并合并重复事件',
  };
  const bridgeEvent = {
    type: 'event_msg',
    payload: {
      type: 'agent_message',
      phase: 'commentary',
      message: '正在检查日志并合并重复事件',
    },
  };

  const stdoutKey = buildProgressEventDedupeKey({
    summaryStep: summarizeCodexEvent(stdoutEvent, { previewChars: 180 }),
    rawActivity: extractRawProgressTextFromEvent(stdoutEvent),
  });
  const bridgeKey = buildProgressEventDedupeKey({
    summaryStep: summarizeCodexEvent(bridgeEvent, { previewChars: 180 }),
    rawActivity: extractRawProgressTextFromEvent(bridgeEvent),
  });

  assert.equal(stdoutKey, bridgeKey);
  const isDuplicate = createProgressEventDeduper({ ttlMs: 3000, maxKeys: 16 });
  assert.equal(isDuplicate(stdoutKey, 1000), false);
  assert.equal(isDuplicate(bridgeKey, 1300), true);
});

test('extractCodexAgentMessageForNarration streams commentary immediately', () => {
  const state = { pendingFinalAnswer: '' };
  const event = {
    type: 'item.completed',
    item: { type: 'agent_message', phase: 'commentary', message: '先读一遍配置。' },
  };
  assert.equal(extractCodexAgentMessageForNarration(event, state), '先读一遍配置。');
  // Commentary is never a candidate final answer.
  assert.equal(state.pendingFinalAnswer, '');
});

test('extractCodexAgentMessageForNarration retires superseded final answers', () => {
  const state = { pendingFinalAnswer: '' };
  const mk = (message) => ({
    type: 'item.completed',
    item: { type: 'agent_message', phase: 'final_answer', message },
  });

  // Long resume sessions label nearly every message final_answer, so the first
  // one is held back rather than streamed.
  assert.equal(extractCodexAgentMessageForNarration(mk('第一阶段完成。'), state), '');
  assert.equal(state.pendingFinalAnswer, '第一阶段完成。');

  // A newer one proves the previous was really mid-task progress.
  assert.equal(extractCodexAgentMessageForNarration(mk('第二阶段完成。'), state), '第一阶段完成。');
  assert.equal(extractCodexAgentMessageForNarration(mk('全部写完了。'), state), '第二阶段完成。');

  // The newest is still pending, so it goes out as the reply, not the stream.
  assert.equal(state.pendingFinalAnswer, '全部写完了。');
});

test('extractCodexAgentMessageForNarration ignores repeats and unphased messages', () => {
  const state = { pendingFinalAnswer: '' };
  const mk = (message) => ({
    type: 'item.completed',
    item: { type: 'agent_message', phase: 'final_answer', message },
  });

  extractCodexAgentMessageForNarration(mk('同一句。'), state);
  // A redelivered identical message must not duplicate itself into the stream.
  assert.equal(extractCodexAgentMessageForNarration(mk('同一句。'), state), '');

  // Unphased messages belong to the buffering path, not this one.
  assert.equal(extractCodexAgentMessageForNarration({
    type: 'item.completed',
    item: { type: 'agent_message', text: '没有 phase。' },
  }, state), '');

  // Non-agent-message events are ignored outright.
  assert.equal(extractCodexAgentMessageForNarration({
    type: 'item.completed',
    item: { type: 'command_execution', command: 'ls' },
  }, state), '');
});
