import { assertTextPresentation } from '../text-presentation.js';

export function createDiscordTextPresentation() {
  return assertTextPresentation({
    sanitizeDisplayText(value) {
      return String(value || '').replace(/\|\|/g, '｜｜');
    },
  });
}
