import { assertTextPresentation } from '../text-presentation.js';

export function createLarkTextPresentation() {
  return assertTextPresentation({
    sanitizeDisplayText: (value) => String(value || ''),
  });
}
