import { assertCommandViewRenderer } from '../command-view.js';

const RAW_COMPONENT_TYPES = Object.freeze({
  actionRow: 1,
  button: 2,
  select: 3,
  textInput: 4,
});

const RAW_BUTTON_STYLES = Object.freeze({
  primary: 1,
  secondary: 2,
  success: 3,
  danger: 4,
  link: 5,
});

const RAW_TEXT_INPUT_STYLES = Object.freeze({
  short: 1,
  paragraph: 2,
});

export function createDiscordCommandViewRenderer({
  ActionRowBuilder = null,
  ButtonBuilder = null,
  ButtonStyle = {},
  StringSelectMenuBuilder = null,
  ModalBuilder = null,
  TextInputBuilder = null,
  TextInputStyle = {},
} = {}) {
  const buttonStyles = {
    primary: ButtonStyle.Primary ?? RAW_BUTTON_STYLES.primary,
    secondary: ButtonStyle.Secondary ?? RAW_BUTTON_STYLES.secondary,
    success: ButtonStyle.Success ?? RAW_BUTTON_STYLES.success,
    danger: ButtonStyle.Danger ?? RAW_BUTTON_STYLES.danger,
    link: ButtonStyle.Link ?? RAW_BUTTON_STYLES.link,
  };
  const textInputStyles = {
    short: TextInputStyle.Short ?? RAW_TEXT_INPUT_STYLES.short,
    paragraph: TextInputStyle.Paragraph ?? RAW_TEXT_INPUT_STYLES.paragraph,
  };

  function renderButton(component) {
    if (ButtonBuilder) {
      const builder = new ButtonBuilder()
        .setLabel(component.label)
        .setStyle(buttonStyles[component.style]);
      if (component.style === 'link') builder.setURL(component.url);
      else builder.setCustomId(component.id);
      if (typeof builder.setDisabled === 'function') builder.setDisabled(component.disabled);
      return builder;
    }
    return {
      type: RAW_COMPONENT_TYPES.button,
      style: buttonStyles[component.style],
      label: component.label,
      ...(component.style === 'link' ? { url: component.url } : { custom_id: component.id }),
      ...(component.disabled ? { disabled: true } : {}),
    };
  }

  function renderSelect(component) {
    if (StringSelectMenuBuilder) {
      const builder = new StringSelectMenuBuilder()
        .setCustomId(component.id)
        .addOptions(component.options.map((option) => ({
          label: option.label,
          value: option.value,
          ...(option.description ? { description: option.description } : {}),
          ...(option.default ? { default: true } : {}),
        })));
      if (component.placeholder && typeof builder.setPlaceholder === 'function') builder.setPlaceholder(component.placeholder);
      if (typeof builder.setMinValues === 'function') builder.setMinValues(component.minValues);
      if (typeof builder.setMaxValues === 'function') builder.setMaxValues(component.maxValues);
      if (typeof builder.setDisabled === 'function') builder.setDisabled(component.disabled);
      return builder;
    }
    return {
      type: RAW_COMPONENT_TYPES.select,
      custom_id: component.id,
      options: component.options.map((option) => ({
        label: option.label,
        value: option.value,
        ...(option.description ? { description: option.description } : {}),
        ...(option.default ? { default: true } : {}),
      })),
      ...(component.placeholder ? { placeholder: component.placeholder } : {}),
      min_values: component.minValues,
      max_values: component.maxValues,
      ...(component.disabled ? { disabled: true } : {}),
    };
  }

  function renderTextInput(component) {
    if (TextInputBuilder) {
      const builder = new TextInputBuilder()
        .setCustomId(component.id)
        .setLabel(component.label)
        .setStyle(textInputStyles[component.style])
        .setRequired(component.required);
      if (component.placeholder && typeof builder.setPlaceholder === 'function') builder.setPlaceholder(component.placeholder);
      if (component.value && typeof builder.setValue === 'function') builder.setValue(component.value);
      if (component.minLength !== null && typeof builder.setMinLength === 'function') builder.setMinLength(component.minLength);
      if (component.maxLength !== null && typeof builder.setMaxLength === 'function') builder.setMaxLength(component.maxLength);
      return builder;
    }
    return {
      type: RAW_COMPONENT_TYPES.textInput,
      custom_id: component.id,
      label: component.label,
      style: textInputStyles[component.style],
      required: component.required,
      ...(component.placeholder ? { placeholder: component.placeholder } : {}),
      ...(component.value ? { value: component.value } : {}),
      ...(component.minLength !== null ? { min_length: component.minLength } : {}),
      ...(component.maxLength !== null ? { max_length: component.maxLength } : {}),
    };
  }

  function renderComponent(component) {
    if (component?.type === 'button') return renderButton(component);
    if (component?.type === 'select') return renderSelect(component);
    if (component?.type === 'text_input') return renderTextInput(component);
    throw new TypeError(`Unsupported command view component: ${component?.type || 'unknown'}`);
  }

  function renderActionRows(rows = []) {
    return rows.map((row) => {
      const components = row.components.map(renderComponent);
      if (ActionRowBuilder) return new ActionRowBuilder().addComponents(...components);
      return { type: RAW_COMPONENT_TYPES.actionRow, components };
    });
  }

  function renderMessage(view) {
    return {
      content: String(view?.content || ''),
      components: renderActionRows(view?.rows || []),
      ...(view?.visibility === 'ephemeral' ? { flags: 64 } : {}),
    };
  }

  function renderModal(view) {
    const rows = renderActionRows(view?.rows || []);
    if (ModalBuilder) {
      return new ModalBuilder()
        .setCustomId(view.id)
        .setTitle(view.title)
        .addComponents(...rows);
    }
    return {
      custom_id: view.id,
      title: view.title,
      components: rows,
    };
  }

  return assertCommandViewRenderer({
    renderActionRows,
    renderMessage,
    renderModal,
  });
}
