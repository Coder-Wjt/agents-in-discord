const PROVIDERS = Object.freeze([
  'codex',
  'claude',
  'cursor',
  'grok',
  'antigravity',
  'zcode',
  'pi',
  'omp',
]);

function readConfiguredThreshold(env, key, provider) {
  const raw = env?.[key];
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`invalid compact threshold default for ${provider}: ${key}=${text}`);
  }
  const tokens = Number(text);
  if (!Number.isSafeInteger(tokens) || tokens <= 0) {
    throw new Error(`invalid compact threshold default for ${provider}: ${key}=${text}`);
  }
  return tokens;
}

function readProviderThreshold(env, provider) {
  const upper = provider.toUpperCase();
  const prefixedKey = `${upper}__MAX_INPUT_TOKENS_BEFORE_COMPACT`;
  const suffixedKey = `MAX_INPUT_TOKENS_BEFORE_COMPACT_${upper}`;
  const prefixed = readConfiguredThreshold(env, prefixedKey, provider);
  const suffixed = readConfiguredThreshold(env, suffixedKey, provider);
  if (prefixed !== null) return { tokens: prefixed, source: 'provider env' };
  if (suffixed !== null) return { tokens: suffixed, source: 'provider env' };
  return null;
}

export function buildCompactThresholdDefaults({
  env = process.env,
  appliedProviderScope = null,
  appliedScopedKeys = [],
  codexBuiltInDefault = 250_000,
} = {}) {
  const defaults = {};
  for (const provider of PROVIDERS) {
    defaults[provider] = readProviderThreshold(env, provider)
      || { tokens: null, source: 'provider default' };
  }

  if (defaults.codex.tokens !== null) return defaults;

  const globalWasOverwrittenByAnotherProvider = appliedProviderScope
    && appliedProviderScope !== 'codex'
    && new Set(appliedScopedKeys).has('MAX_INPUT_TOKENS_BEFORE_COMPACT');
  const legacyWasOverwrittenByAnotherProvider = appliedProviderScope
    && appliedProviderScope !== 'codex'
    && new Set(appliedScopedKeys).has('MAX_INPUT_TOKENS_BEFORE_RESET');
  const globalTokens = globalWasOverwrittenByAnotherProvider
    ? null
    : readConfiguredThreshold(env, 'MAX_INPUT_TOKENS_BEFORE_COMPACT', 'codex');
  const legacyTokens = legacyWasOverwrittenByAnotherProvider
    ? null
    : readConfiguredThreshold(env, 'MAX_INPUT_TOKENS_BEFORE_RESET', 'codex');
  if (globalTokens !== null) {
    defaults.codex = { tokens: globalTokens, source: 'env default' };
    return defaults;
  }
  if (legacyTokens !== null) {
    defaults.codex = { tokens: legacyTokens, source: 'legacy env' };
    return defaults;
  }

  const builtInTokens = readConfiguredThreshold(
    { CODEX_BUILT_IN_COMPACT_THRESHOLD: codexBuiltInDefault },
    'CODEX_BUILT_IN_COMPACT_THRESHOLD',
    'codex',
  );
  defaults.codex = { tokens: builtInTokens, source: 'built-in default' };
  return defaults;
}

export const COMPACT_THRESHOLD_PROVIDERS = PROVIDERS;
