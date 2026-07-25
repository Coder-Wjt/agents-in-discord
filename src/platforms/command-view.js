export const COMMAND_BUTTON_STYLES = Object.freeze([
  'primary',
  'secondary',
  'success',
  'danger',
  'link',
]);

export const COMMAND_TEXT_INPUT_STYLES = Object.freeze([
  'short',
  'paragraph',
]);

function requireText(value, name) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${name} must be a non-empty string.`);
  return normalized;
}

export function createCommandButton({
  id,
  label,
  style = 'secondary',
  disabled = false,
  url = null,
} = {}) {
  if (!COMMAND_BUTTON_STYLES.includes(style)) {
    throw new TypeError(`Unsupported command button style: ${style}`);
  }
  return {
    type: 'button',
    id: style === 'link' ? null : requireText(id, 'button id'),
    label: requireText(label, 'button label'),
    style,
    disabled: Boolean(disabled),
    url: style === 'link' ? requireText(url, 'button url') : null,
  };
}

export function createCommandSelect({
  id,
  placeholder = '',
  options = [],
  minValues = 1,
  maxValues = 1,
  disabled = false,
} = {}) {
  return {
    type: 'select',
    id: requireText(id, 'select id'),
    placeholder: String(placeholder || ''),
    options: options.map((option) => ({
      label: requireText(option?.label, 'select option label'),
      value: requireText(option?.value, 'select option value'),
      description: String(option?.description || '').trim() || null,
      default: Boolean(option?.default),
    })),
    minValues: Math.max(0, Number(minValues) || 0),
    maxValues: Math.max(1, Number(maxValues) || 1),
    disabled: Boolean(disabled),
  };
}

export function createCommandTextInput({
  id,
  label,
  style = 'short',
  placeholder = '',
  value = '',
  required = true,
  minLength = null,
  maxLength = null,
} = {}) {
  if (!COMMAND_TEXT_INPUT_STYLES.includes(style)) {
    throw new TypeError(`Unsupported command text input style: ${style}`);
  }
  return {
    type: 'text_input',
    id: requireText(id, 'text input id'),
    label: requireText(label, 'text input label'),
    style,
    placeholder: String(placeholder || ''),
    value: String(value || ''),
    required: Boolean(required),
    minLength: Number.isInteger(minLength) ? minLength : null,
    maxLength: Number.isInteger(maxLength) ? maxLength : null,
  };
}

export function createCommandActionRow(components = []) {
  if (!Array.isArray(components) || components.length === 0) {
    throw new TypeError('Command action row requires at least one component.');
  }
  return { type: 'action_row', components };
}

export function createCommandMessageView({
  content = '',
  rows = [],
  visibility = 'public',
  fallbackText = '',
} = {}) {
  if (!['public', 'ephemeral'].includes(visibility)) {
    throw new TypeError(`Unsupported command message visibility: ${visibility}`);
  }
  return {
    type: 'message',
    content: String(content || ''),
    rows: Array.isArray(rows) ? rows : [],
    visibility,
    ...(String(fallbackText || '').trim()
      ? { fallbackText: String(fallbackText).trim() }
      : {}),
  };
}

export function createCommandModalView({ id, title, rows = [], fallback = null } = {}) {
  return {
    type: 'modal',
    id: requireText(id, 'modal id'),
    title: requireText(title, 'modal title'),
    rows: Array.isArray(rows) ? rows : [],
    ...(fallback ? { fallback: createCommandMessageView(fallback) } : {}),
  };
}

export function assertCommandViewRenderer(renderer) {
  if (!renderer || typeof renderer !== 'object' || Array.isArray(renderer)) {
    throw new TypeError('Command view renderer must be an object.');
  }
  for (const method of ['renderActionRows', 'renderMessage', 'renderModal']) {
    if (typeof renderer[method] !== 'function') {
      throw new TypeError(`Command view renderer must provide ${method}().`);
    }
  }
  return renderer;
}
