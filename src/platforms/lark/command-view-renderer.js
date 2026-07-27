import { assertCommandViewRenderer } from '../command-view.js';
import { buildLarkModalSubmitName } from './card-interactions.js';

const BUTTON_TYPES = Object.freeze({
  primary: 'primary',
  secondary: 'default',
  success: 'primary',
  danger: 'danger',
  link: 'default',
});

function plainText(content) {
  return { tag: 'plain_text', content: String(content || '') };
}

function renderButton(component) {
  if (component.disabled) return null;
  return {
    tag: 'button',
    text: plainText(component.label),
    type: BUTTON_TYPES[component.style] || 'default',
    ...(component.style === 'link'
      ? { url: component.url }
      : { value: { id: component.id } }),
  };
}

function renderSelect(component) {
  if (component.disabled) return null;
  const selected = component.options.find((option) => option.default)?.value;
  return {
    tag: 'select_static',
    placeholder: plainText(component.placeholder || component.id),
    option: component.options.map((option) => ({
      text: plainText(option.label),
      value: option.value,
    })),
    value: { id: component.id },
    ...(selected ? { initial_option: selected } : {}),
  };
}

function renderTextInput(component) {
  return {
    tag: 'input',
    name: component.id,
    label: plainText(component.label),
    input_type: component.style === 'paragraph' ? 'multiline_text' : 'text',
    required: Boolean(component.required),
    width: 'fill',
    ...(component.placeholder ? { placeholder: plainText(component.placeholder) } : {}),
    ...(component.value ? { default_value: String(component.value) } : {}),
    ...(component.maxLength !== null ? { max_length: Math.min(1000, component.maxLength) } : {}),
    ...(component.style === 'paragraph' ? { rows: 5, auto_resize: true, max_rows: 10 } : {}),
  };
}

function renderComponent(component) {
  if (component?.type === 'button') return renderButton(component);
  if (component?.type === 'select') return renderSelect(component);
  throw new TypeError(`Unsupported Lark command view component: ${component?.type || 'unknown'}`);
}

function buildCard(content, actionRows) {
  return {
    config: {
      enable_forward: true,
      update_multi: true,
      wide_screen_mode: true,
    },
    elements: [
      ...(String(content || '').trim()
        ? [{ tag: 'markdown', content: String(content) }]
        : []),
      ...actionRows,
    ],
  };
}

function buildModalCard(view) {
  const inputs = (view?.rows || []).flatMap((row) => (
    (row?.components || []).map((component) => {
      if (component?.type !== 'text_input') {
        throw new TypeError(`Unsupported Lark modal component: ${component?.type || 'unknown'}`);
      }
      return renderTextInput(component);
    })
  ));
  return {
    schema: '2.0',
    config: {
      update_multi: true,
      width_mode: 'default',
      enable_forward: false,
      summary: { content: String(view?.title || 'Form') },
    },
    header: {
      title: plainText(view?.title || 'Form'),
      template: 'blue',
      icon: { tag: 'standard_icon', token: 'file-form_colorful' },
    },
    body: {
      direction: 'vertical',
      padding: '12px 12px 20px 12px',
      elements: [{
        tag: 'form',
        name: 'aid_command_modal_form',
        direction: 'vertical',
        vertical_spacing: '12px',
        elements: [
          ...inputs,
          {
            tag: 'button',
            name: buildLarkModalSubmitName(view?.id),
            text: plainText('提交'),
            type: 'primary_filled',
            width: 'fill',
            form_action_type: 'submit',
          },
        ],
      }],
    },
  };
}

export function createLarkCommandViewRenderer() {
  return assertCommandViewRenderer({
    renderActionRows(rows = []) {
      return rows.map((row) => {
        const actions = (row?.components || []).map(renderComponent).filter(Boolean);
        return actions.length ? { tag: 'action', layout: 'flow', actions } : null;
      }).filter(Boolean);
    },
    renderMessage(view) {
      const content = String(view?.content || '');
      const actionRows = this.renderActionRows(view?.rows || []);
      return {
        content,
        text: content,
        card: buildCard(content, actionRows),
        interactive: actionRows.length > 0,
        visibility: view?.visibility || 'public',
      };
    },
    renderModal(view) {
      const title = String(view?.title || '');
      return {
        id: String(view?.id || ''),
        title,
        content: title,
        text: title,
        card: buildModalCard(view),
        interactive: true,
        visibility: 'public',
      };
    },
  });
}
