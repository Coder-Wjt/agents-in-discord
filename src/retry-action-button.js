import { buildCommandActionButtonId } from './slash-command-router.js';
import {
  createCommandActionRow,
  createCommandButton,
  createCommandMessageView,
} from './platforms/command-view.js';

function normalizePayload(payload) {
  return typeof payload === 'string' ? { content: payload } : payload;
}

export function withRetryAction(payload, userId, {
  label = 'Retry',
  fallbackText = '按钮不可用时，请发送 `!retry` 重试这个失败任务。',
} = {}) {
  const body = normalizePayload(payload);
  if (!body || !userId) return body;

  return createCommandMessageView({
    content: body.content,
    rows: [
      ...(Array.isArray(body.rows) ? body.rows : []),
      createCommandActionRow([
        createCommandButton({
          id: buildCommandActionButtonId('retry', userId),
          label,
          style: 'primary',
        }),
      ]),
    ],
    visibility: body.visibility,
    fallbackText: body.fallbackText || fallbackText,
  });
}
