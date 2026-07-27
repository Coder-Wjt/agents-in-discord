const MODAL_SUBMIT_NAME_PREFIX = 'aid_modal_submit:';

function normalizeText(value) {
  return String(value || '').trim();
}

function hasFormValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  return typeof value === 'object' && !Array.isArray(value);
}

function parseFormValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...value };
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function buildLarkModalSubmitName(modalId) {
  const normalized = normalizeText(modalId);
  if (!normalized) throw new TypeError('Lark modal id must be a non-empty string.');
  return `${MODAL_SUBMIT_NAME_PREFIX}${normalized}`;
}

export function parseLarkModalSubmitName(actionName) {
  const normalized = normalizeText(actionName);
  if (!normalized.startsWith(MODAL_SUBMIT_NAME_PREFIX)) return null;
  return normalizeText(normalized.slice(MODAL_SUBMIT_NAME_PREFIX.length));
}

export function resolveLarkModalSubmission(interaction) {
  const raw = interaction?.raw?.event || interaction?.raw || {};
  const formValue = [
    interaction?.action?.formValue,
    interaction?.action?.form_value,
    raw?.action?.form_value,
    raw?.action?.formValue,
    raw?.form_value,
    raw?.formValue,
  ].find(hasFormValue);
  if (!hasFormValue(formValue)) return null;

  const modalId = parseLarkModalSubmitName(
    interaction?.action?.name
    || raw?.action?.name
    || raw?.action_name,
  );
  if (!modalId) return null;
  return {
    id: modalId,
    fields: parseFormValue(formValue),
  };
}
