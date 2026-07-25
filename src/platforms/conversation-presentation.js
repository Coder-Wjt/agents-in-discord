export const CONVERSATION_TERM_KEYS = Object.freeze([
  'sourceConversation',
  'currentSourceConversation',
  'parentSourceConversation',
  'childConversation',
  'childConversationShort',
  'childConversationLocalized',
  'parentConversation',
  'parentConversationLocalized',
  'parentConversationStatusLabel',
  'sideConversation',
  'sideConversationStatusLabel',
  'temporaryChildConversation',
  'childConversationId',
]);

const DEFAULT_CONVERSATION_TERMS = Object.freeze({
  sourceConversation: Object.freeze({ en: 'conversation', zh: '会话' }),
  currentSourceConversation: Object.freeze({ en: 'current conversation', zh: '当前会话' }),
  parentSourceConversation: Object.freeze({ en: 'parent conversation', zh: '父会话' }),
  childConversation: Object.freeze({ en: 'child conversation', zh: '子会话' }),
  childConversationShort: Object.freeze({ en: 'conversation', zh: '会话' }),
  childConversationLocalized: Object.freeze({ en: 'conversation', zh: '会话' }),
  parentConversation: Object.freeze({ en: 'parent conversation', zh: '父会话' }),
  parentConversationLocalized: Object.freeze({ en: 'parent conversation', zh: '父会话' }),
  parentConversationStatusLabel: Object.freeze({ en: 'parent conversation', zh: '父会话' }),
  sideConversation: Object.freeze({ en: 'side conversation', zh: 'side conversation' }),
  sideConversationStatusLabel: Object.freeze({ en: 'side conversation', zh: 'side conversation' }),
  temporaryChildConversation: Object.freeze({ en: 'temporary child conversation', zh: '临时子会话' }),
  childConversationId: Object.freeze({ en: 'conversation id', zh: '会话 ID' }),
});

function normalizeLanguage(language) {
  return String(language || '').trim().toLowerCase() === 'en' ? 'en' : 'zh';
}

function normalizeTerm(value, key, language) {
  const term = String(value || '').trim();
  if (!term) {
    throw new TypeError(`Conversation presentation term "${key}.${language}" must be a non-empty string.`);
  }
  return term;
}

export function createConversationPresentation({ terms = {} } = {}) {
  const resolvedTerms = Object.freeze(Object.fromEntries(CONVERSATION_TERM_KEYS.map((key) => {
    const defaults = DEFAULT_CONVERSATION_TERMS[key];
    const overrides = terms?.[key] || {};
    return [key, Object.freeze({
      en: normalizeTerm(overrides.en ?? defaults.en, key, 'en'),
      zh: normalizeTerm(overrides.zh ?? defaults.zh, key, 'zh'),
    })];
  })));

  return Object.freeze({
    getTerm(key, language = 'zh') {
      if (!CONVERSATION_TERM_KEYS.includes(key)) {
        throw new TypeError(`Unknown conversation presentation term: ${key}`);
      }
      return resolvedTerms[key][normalizeLanguage(language)];
    },
  });
}

export const DEFAULT_CONVERSATION_PRESENTATION = createConversationPresentation();

export function assertConversationPresentation(presentation) {
  if (!presentation || typeof presentation !== 'object' || Array.isArray(presentation)) {
    throw new TypeError('Conversation presentation must be an object.');
  }
  if (typeof presentation.getTerm !== 'function') {
    throw new TypeError('Conversation presentation must provide getTerm().');
  }
  return presentation;
}
