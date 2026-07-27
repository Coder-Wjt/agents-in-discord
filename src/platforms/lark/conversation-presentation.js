import { createConversationPresentation } from '../conversation-presentation.js';

const LARK_CONVERSATION_TERMS = Object.freeze({
  sourceConversation: Object.freeze({ en: 'Lark chat', zh: '飞书会话' }),
  currentSourceConversation: Object.freeze({ en: 'current chat', zh: '当前会话' }),
  parentSourceConversation: Object.freeze({ en: 'parent chat', zh: '父会话' }),
  childConversation: Object.freeze({ en: 'Lark thread', zh: '飞书话题' }),
  childConversationShort: Object.freeze({ en: 'thread', zh: '话题' }),
  childConversationLocalized: Object.freeze({ en: 'thread', zh: '话题' }),
  parentConversation: Object.freeze({ en: 'parent Lark chat', zh: '父飞书会话' }),
  parentConversationLocalized: Object.freeze({ en: 'parent chat', zh: '父会话' }),
  parentConversationStatusLabel: Object.freeze({ en: 'parent chat', zh: '父会话' }),
  sideConversation: Object.freeze({ en: 'side Lark chat', zh: '旁路飞书会话' }),
  sideConversationStatusLabel: Object.freeze({ en: 'side chat', zh: '旁路会话' }),
  temporaryChildConversation: Object.freeze({ en: 'temporary thread', zh: '临时话题' }),
  childConversationId: Object.freeze({ en: 'thread id', zh: '话题 ID' }),
});

export function createLarkConversationPresentation({ terms = {} } = {}) {
  return createConversationPresentation({
    terms: Object.fromEntries(Object.entries(LARK_CONVERSATION_TERMS).map(([key, defaults]) => [
      key,
      { ...defaults, ...(terms?.[key] || {}) },
    ])),
  });
}
