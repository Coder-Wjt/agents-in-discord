export const TEXT_PRESENTATION_METHODS = Object.freeze([
  'sanitizeDisplayText',
]);

export function assertTextPresentation(textPresentation) {
  if (!textPresentation || typeof textPresentation !== 'object' || Array.isArray(textPresentation)) {
    throw new TypeError('Text presentation must be an object.');
  }
  for (const method of TEXT_PRESENTATION_METHODS) {
    if (typeof textPresentation[method] !== 'function') {
      throw new TypeError(`Text presentation must provide ${method}().`);
    }
  }
  return textPresentation;
}

export const DEFAULT_TEXT_PRESENTATION = Object.freeze({
  sanitizeDisplayText(value) {
    return String(value || '');
  },
});
