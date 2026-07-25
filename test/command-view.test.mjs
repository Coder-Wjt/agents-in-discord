import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertCommandViewRenderer,
  createCommandActionRow,
  createCommandButton,
  createCommandMessageView,
  createCommandModalView,
  createCommandSelect,
  createCommandTextInput,
} from '../src/platforms/command-view.js';

test('command view builders create platform-neutral message components', () => {
  const button = createCommandButton({
    id: 'retry:12345',
    label: 'Retry',
    style: 'primary',
    disabled: true,
  });
  const select = createCommandSelect({
    id: 'provider',
    placeholder: 'Choose provider',
    options: [{ label: 'Codex', value: 'codex', default: true }],
  });
  const row = createCommandActionRow([button, select]);
  const view = createCommandMessageView({
    content: 'Choose an action',
    rows: [row],
    visibility: 'ephemeral',
  });

  assert.deepEqual(button, {
    type: 'button',
    id: 'retry:12345',
    label: 'Retry',
    style: 'primary',
    disabled: true,
    url: null,
  });
  assert.equal(select.options[0].default, true);
  assert.deepEqual(view, {
    type: 'message',
    content: 'Choose an action',
    rows: [row],
    visibility: 'ephemeral',
  });
});

test('command view builders support links and modal text inputs', () => {
  const link = createCommandButton({
    label: 'Docs',
    style: 'link',
    url: 'https://example.com/docs',
  });
  const input = createCommandTextInput({
    id: 'goal',
    label: 'Goal',
    style: 'paragraph',
    minLength: 3,
    maxLength: 1000,
  });
  const modal = createCommandModalView({
    id: 'goal:create',
    title: 'Create goal',
    rows: [createCommandActionRow([input])],
  });

  assert.equal(link.id, null);
  assert.equal(link.url, 'https://example.com/docs');
  assert.equal(modal.rows[0].components[0].style, 'paragraph');
});

test('command view contracts reject unsupported values and incomplete renderers', () => {
  assert.throws(
    () => createCommandButton({ id: 'x', label: 'X', style: 'warning' }),
    /Unsupported command button style/,
  );
  assert.throws(
    () => createCommandTextInput({ id: 'x', label: 'X', style: 'multiline' }),
    /Unsupported command text input style/,
  );
  assert.throws(
    () => createCommandMessageView({ visibility: 'private' }),
    /Unsupported command message visibility/,
  );
  assert.throws(
    () => assertCommandViewRenderer({ renderActionRows() {} }),
    /must provide renderMessage\(\)/,
  );
});
