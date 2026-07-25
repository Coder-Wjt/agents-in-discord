export {
  buildPromptFromMessage,
  formatAttachmentsForPrompt,
} from './message-input.js';

export function doesMessageTargetBot(message, botUserId) {
  const mentioned = Boolean(message.mentions?.users?.has?.(botUserId));
  const repliedToBot = message.mentions?.repliedUser?.id === botUserId;
  return mentioned || repliedToBot;
}
