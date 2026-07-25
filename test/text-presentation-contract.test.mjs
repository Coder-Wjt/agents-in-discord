import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TEXT_PRESENTATION,
  assertTextPresentation,
} from '../src/platforms/text-presentation.js';

test('text presentation contract accepts a display sanitizer', () => {
  const presentation = {
    sanitizeDisplayText: (value) => `safe:${value}`,
  };

  assert.equal(assertTextPresentation(presentation), presentation);
  assert.equal(presentation.sanitizeDisplayText('hello'), 'safe:hello');
  assert.equal(DEFAULT_TEXT_PRESENTATION.sanitizeDisplayText('hello || world'), 'hello || world');
});

test('text presentation contract rejects incomplete implementations', () => {
  assert.throws(
    () => assertTextPresentation({}),
    /must provide sanitizeDisplayText\(\)/,
  );
});
