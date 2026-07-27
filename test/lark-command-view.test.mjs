import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCommandActionRow,
  createCommandButton,
  createCommandMessageView,
  createCommandModalView,
  createCommandSelect,
  createCommandTextInput,
} from '../src/platforms/command-view.js';
import { createLarkCommandViewRenderer } from '../src/platforms/lark/command-view-renderer.js';

test('Lark command view renderer maps buttons and selects to interactive card actions', () => {
  const renderer = createLarkCommandViewRenderer();
  const rendered = renderer.renderMessage(createCommandMessageView({
    content: '**Choose**',
    rows: [
      createCommandActionRow([
        createCommandButton({ id: 'action:run', label: 'Run', style: 'success' }),
        createCommandButton({ id: 'ignored', label: 'Disabled', disabled: true }),
      ]),
      createCommandActionRow([
        createCommandSelect({
          id: 'settings:model',
          placeholder: 'Model',
          options: [
            { label: 'GPT 5.6', value: 'gpt-5.6', default: true },
            { label: 'Default', value: 'default' },
          ],
        }),
      ]),
    ],
  }));

  assert.equal(rendered.interactive, true);
  assert.equal(rendered.card.elements[1].actions.length, 1);
  assert.deepEqual(rendered.card.elements[1].actions[0].value, { id: 'action:run' });
  assert.equal(rendered.card.elements[2].actions[0].tag, 'select_static');
  assert.equal(rendered.card.elements[2].actions[0].initial_option, 'gpt-5.6');
  assert.deepEqual(rendered.card.elements[2].actions[0].value, { id: 'settings:model' });
});

test('Lark command view renderer can force content-only messages into editable cards', () => {
  const renderer = createLarkCommandViewRenderer();
  const rendered = renderer.renderMessage({
    content: '🧵 Codex side notes',
    interactive: true,
  });

  assert.equal(rendered.interactive, true);
  assert.deepEqual(rendered.card.elements, [{
    tag: 'markdown',
    content: '🧵 Codex side notes',
  }]);
});

test('Lark command view renderer maps shared modals to Card 2.0 forms', () => {
  const renderer = createLarkCommandViewRenderer();
  const rendered = renderer.renderModal(createCommandModalView({
    id: 'stgm:model:ou_user',
    title: '设置自定义模型',
    rows: [createCommandActionRow([
      createCommandTextInput({
        id: 'model_name',
        label: '模型名或 default',
        placeholder: '例如 gpt-5.6',
        value: 'gpt-5.4',
        required: true,
        maxLength: 120,
      }),
    ])],
  }));

  assert.equal(rendered.interactive, true);
  assert.equal(rendered.card.schema, '2.0');
  assert.equal(rendered.card.header.title.content, '设置自定义模型');
  const form = rendered.card.body.elements[0];
  assert.equal(form.tag, 'form');
  assert.deepEqual(form.elements[0], {
    tag: 'input',
    name: 'model_name',
    label: { tag: 'plain_text', content: '模型名或 default' },
    input_type: 'text',
    required: true,
    width: 'fill',
    placeholder: { tag: 'plain_text', content: '例如 gpt-5.6' },
    default_value: 'gpt-5.4',
    max_length: 120,
  });
  assert.equal(form.elements[1].form_action_type, 'submit');
  assert.equal(form.elements[1].name, 'aid_modal_submit:stgm:model:ou_user');
});
