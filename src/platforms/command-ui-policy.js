import {
  PLATFORM_CAPABILITY_NAMES,
  assertPlatformCapabilities,
} from './capabilities.js';
import {
  assertCommandRegistryRenderer,
} from './command-registry.js';
import {
  assertCommandViewRenderer,
  createCommandMessageView,
} from './command-view.js';
import { assertInteractionResponse } from './interaction-response.js';

const POLICY_META = Symbol('commandUiCapabilityPolicy');

function capabilitiesMatch(left, right) {
  return PLATFORM_CAPABILITY_NAMES.every((name) => left?.[name] === right?.[name]);
}

function markPolicy(value, kind, capabilities) {
  Object.defineProperty(value, POLICY_META, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { kind, capabilities },
  });
  return value;
}

function hasPolicy(value, kind, capabilities) {
  const meta = value?.[POLICY_META];
  return meta?.kind === kind && capabilitiesMatch(meta.capabilities, capabilities);
}

function supportsCommandSpec(spec, capabilities) {
  return (spec?.requiredCapabilities || []).every((name) => capabilities[name] === true);
}

export function createCapabilityAwareCommandRegistryRenderer({
  capabilities,
  renderer,
  textCommandPrefix = '!',
} = {}) {
  const resolvedCapabilities = assertPlatformCapabilities(capabilities);
  const resolvedRenderer = assertCommandRegistryRenderer(renderer);
  if (hasPolicy(resolvedRenderer, 'command-registry', resolvedCapabilities)) return resolvedRenderer;

  const prefix = String(textCommandPrefix || '!');
  return markPolicy(assertCommandRegistryRenderer({
    renderCommands(specs = []) {
      if (!resolvedCapabilities.slashCommands) return [];
      return resolvedRenderer.renderCommands(
        specs.filter((spec) => supportsCommandSpec(spec, resolvedCapabilities)),
      );
    },
    formatCommandName: (name) => resolvedRenderer.formatCommandName(name),
    normalizeCommandName: (name) => resolvedRenderer.normalizeCommandName(name),
    formatCommandReference(name) {
      if (resolvedCapabilities.slashCommands) {
        return resolvedRenderer.formatCommandReference(name);
      }
      return `${prefix}${resolvedRenderer.normalizeCommandName(name)}`;
    },
  }), 'command-registry', resolvedCapabilities);
}

function componentCapability(component) {
  if (component?.type === 'button') return 'buttons';
  if (component?.type === 'select') return 'selectMenus';
  if (component?.type === 'text_input') return 'modals';
  return null;
}

function formatComponentFallback(component) {
  if (component?.type === 'button') {
    if (component.disabled) return '';
    return component.style === 'link' && component.url
      ? `• ${component.label}: ${component.url}`
      : `• ${component.label}`;
  }
  if (component?.type === 'select') {
    if (component.disabled) return '';
    const options = (component.options || [])
      .slice(0, 8)
      .map((option) => `${option.label} (${option.value})`)
      .join(', ');
    const suffix = (component.options || []).length > 8 ? ', …' : '';
    return `• ${component.placeholder || component.id}: ${options}${suffix}`;
  }
  return '';
}

function defaultFormatUnsupportedControls(components) {
  const lines = components.map(formatComponentFallback).filter(Boolean);
  if (!lines.length) return '';
  return [
    'Interactive controls are unavailable on this platform.',
    ...lines,
  ].join('\n');
}

export function adaptCommandMessageViewForCapabilities(view, capabilities, {
  formatUnsupportedControls = defaultFormatUnsupportedControls,
} = {}) {
  const resolvedCapabilities = assertPlatformCapabilities(capabilities);
  const unsupported = [];
  const rows = (view?.rows || []).map((row) => {
    const components = (row?.components || []).filter((component) => {
      const capability = componentCapability(component);
      const supported = !capability || resolvedCapabilities[capability];
      if (!supported) unsupported.push(component);
      return supported;
    });
    return components.length ? { ...row, components } : null;
  }).filter(Boolean);

  if (!unsupported.length) return view;
  const fallbackText = String(
    view?.fallbackText
    || formatUnsupportedControls(unsupported, view)
    || '',
  ).trim();
  const content = [String(view?.content || '').trim(), fallbackText]
    .filter(Boolean)
    .join('\n\n');
  return {
    ...view,
    content,
    rows,
  };
}

export function createCapabilityAwareCommandViewRenderer({
  capabilities,
  renderer,
  formatUnsupportedControls,
} = {}) {
  const resolvedCapabilities = assertPlatformCapabilities(capabilities);
  const resolvedRenderer = assertCommandViewRenderer(renderer);
  if (hasPolicy(resolvedRenderer, 'command-view', resolvedCapabilities)) return resolvedRenderer;

  const adaptMessage = (view) => adaptCommandMessageViewForCapabilities(
    view,
    resolvedCapabilities,
    { formatUnsupportedControls },
  );
  return markPolicy(assertCommandViewRenderer({
    renderActionRows(rows = []) {
      const adapted = adaptMessage(createCommandMessageView({ rows }));
      return resolvedRenderer.renderActionRows(adapted.rows);
    },
    renderMessage: (view) => resolvedRenderer.renderMessage(adaptMessage(view)),
    renderModal(view) {
      if (!resolvedCapabilities.modals) {
        throw new TypeError('Platform does not support command modals.');
      }
      return resolvedRenderer.renderModal(view);
    },
  }), 'command-view', resolvedCapabilities);
}

function createDefaultModalFallback(view) {
  const fields = (view?.rows || [])
    .flatMap((row) => row?.components || [])
    .filter((component) => component?.type === 'text_input')
    .map((component) => `• ${component.label}${component.required ? ' (required)' : ''}`);
  return createCommandMessageView({
    content: [
      `**${String(view?.title || 'Form')}**`,
      'Interactive forms are unavailable on this platform.',
      ...fields,
    ].join('\n'),
    visibility: 'ephemeral',
  });
}

export function createCapabilityAwareInteractionResponse({
  capabilities,
  interactionResponse,
} = {}) {
  const resolvedCapabilities = assertPlatformCapabilities(capabilities);
  const resolvedResponse = assertInteractionResponse(interactionResponse);
  if (hasPolicy(resolvedResponse, 'interaction-response', resolvedCapabilities)) return resolvedResponse;

  return markPolicy(assertInteractionResponse({
    respond: (interaction, view) => resolvedResponse.respond(interaction, view),
    update(interaction, view) {
      if (resolvedCapabilities.messageEdits) {
        return resolvedResponse.update(interaction, view);
      }
      return resolvedResponse.respond(interaction, view);
    },
    showModal(interaction, view) {
      if (resolvedCapabilities.modals) {
        return resolvedResponse.showModal(interaction, view);
      }
      return resolvedResponse.respond(
        interaction,
        view?.fallback || createDefaultModalFallback(view),
      );
    },
    defer: (interaction, options) => resolvedResponse.defer(interaction, options),
  }), 'interaction-response', resolvedCapabilities);
}
