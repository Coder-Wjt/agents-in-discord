import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCompactThresholdDefaults } from '../src/compact-threshold-defaults.js';

test('buildCompactThresholdDefaults keeps the legacy global threshold Codex-only', () => {
  const defaults = buildCompactThresholdDefaults({
    env: { MAX_INPUT_TOKENS_BEFORE_COMPACT: '272000' },
  });

  assert.deepEqual(defaults.codex, { tokens: 272_000, source: 'env default' });
  for (const provider of ['claude', 'cursor', 'grok', 'antigravity', 'zcode', 'pi', 'omp']) {
    assert.deepEqual(defaults[provider], { tokens: null, source: 'provider default' });
  }
});

test('buildCompactThresholdDefaults preserves explicit provider thresholds', () => {
  const explicitProviders = ['claude', 'cursor', 'grok', 'antigravity', 'zcode', 'pi', 'omp'];
  const providerEnv = Object.fromEntries(explicitProviders.map((provider, index) => [
    `${provider.toUpperCase()}__MAX_INPUT_TOKENS_BEFORE_COMPACT`,
    String(180_000 + index),
  ]));
  const defaults = buildCompactThresholdDefaults({
    env: {
      MAX_INPUT_TOKENS_BEFORE_COMPACT: '272000',
      ...providerEnv,
    },
  });

  assert.deepEqual(defaults.codex, { tokens: 272_000, source: 'env default' });
  for (const [index, provider] of explicitProviders.entries()) {
    assert.deepEqual(defaults[provider], {
      tokens: 180_000 + index,
      source: 'provider env',
    });
  }
});

test('buildCompactThresholdDefaults does not mistake a flattened non-Codex value for the Codex global', () => {
  const defaults = buildCompactThresholdDefaults({
    env: {
      MAX_INPUT_TOKENS_BEFORE_COMPACT: '180000',
      GROK__MAX_INPUT_TOKENS_BEFORE_COMPACT: '180000',
    },
    appliedProviderScope: 'grok',
    appliedScopedKeys: ['MAX_INPUT_TOKENS_BEFORE_COMPACT'],
  });

  assert.deepEqual(defaults.codex, { tokens: 250_000, source: 'built-in default' });
  assert.deepEqual(defaults.grok, { tokens: 180_000, source: 'provider env' });
});

test('buildCompactThresholdDefaults rejects malformed provider config', () => {
  for (const provider of ['codex', 'claude', 'cursor', 'grok', 'antigravity', 'zcode', 'pi', 'omp']) {
    assert.throws(
      () => buildCompactThresholdDefaults({
        env: { [`${provider.toUpperCase()}__MAX_INPUT_TOKENS_BEFORE_COMPACT`]: 'broken' },
      }),
      new RegExp(`invalid compact threshold default for ${provider}`, 'i'),
    );
  }
  assert.throws(
    () => buildCompactThresholdDefaults({
      env: {
        GROK__MAX_INPUT_TOKENS_BEFORE_COMPACT: '180000',
        MAX_INPUT_TOKENS_BEFORE_COMPACT_GROK: 'broken',
      },
    }),
    /invalid compact threshold default for grok/i,
  );
});
