import { createConversationPresentation } from '../conversation-presentation.js';

const DISCORD_CONVERSATION_TERMS = Object.freeze({
  sourceConversation: Object.freeze({ en: 'Discord channel', zh: 'Discord 频道' }),
  currentSourceConversation: Object.freeze({ en: 'current channel', zh: '当前频道' }),
  parentSourceConversation: Object.freeze({ en: 'parent channel', zh: '父频道' }),
  childConversation: Object.freeze({ en: 'Discord thread', zh: 'Discord thread' }),
  childConversationShort: Object.freeze({ en: 'thread', zh: 'thread' }),
  childConversationLocalized: Object.freeze({ en: 'thread', zh: '线程' }),
  parentConversation: Object.freeze({ en: 'parent Discord thread', zh: '父 Discord thread' }),
  parentConversationLocalized: Object.freeze({ en: 'parent thread', zh: '父线程' }),
  parentConversationStatusLabel: Object.freeze({ en: 'parent thread', zh: 'parent thread' }),
  sideConversation: Object.freeze({ en: 'side Discord thread', zh: 'side Discord thread' }),
  sideConversationStatusLabel: Object.freeze({ en: 'side thread', zh: 'side thread' }),
  temporaryChildConversation: Object.freeze({ en: 'temporary thread', zh: '临时线程' }),
  childConversationId: Object.freeze({ en: 'thread id', zh: 'thread id' }),
});

export function createDiscordConversationPresentation({ terms = {} } = {}) {
  return createConversationPresentation({
    terms: Object.fromEntries(Object.entries(DISCORD_CONVERSATION_TERMS).map(([key, defaults]) => [
      key,
      { ...defaults, ...(terms?.[key] || {}) },
    ])),
  });
}
