import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscordTextPresentation } from '../src/platforms/discord/text-presentation.js';

test('Discord text presentation neutralizes spoiler markers for progress surfaces', () => {
  const presentation = createDiscordTextPresentation();

  assert.equal(
    presentation.sanitizeDisplayText('check cache || use fallback'),
    'check cache ｜｜ use fallback',
  );
});
