export function buildPromptFromMessage(rawContent, attachments) {
  const text = String(rawContent || '').trim();
  const attachmentBlock = formatAttachmentsForPrompt(attachments);

  if (!text && !attachmentBlock) return '';
  if (text && !attachmentBlock) return text;

  if (!text && attachmentBlock) {
    return [
      '用户发送了附件，请先查看附件再回复。',
      attachmentBlock,
    ].join('\n\n');
  }

  return [
    text,
    attachmentBlock,
  ].join('\n\n').trim();
}

export function formatAttachmentsForPrompt(attachments) {
  const values = Array.isArray(attachments)
    ? attachments
    : attachments && typeof attachments.values === 'function'
      ? [...attachments.values()]
      : [];
  if (!values.length) return '';

  const lines = [];
  for (let index = 1; index <= values.length; index += 1) {
    const attachment = values[index - 1];
    if (index > 8) {
      lines.push(`...and ${values.length - 8} more attachment(s).`);
      break;
    }

    const raw = attachment?.raw || attachment;
    const name = attachment?.name || raw?.name || 'unnamed-file';
    const type = attachment?.mimeType || raw?.contentType || 'unknown';
    const sizeBytes = Number.isFinite(attachment?.sizeBytes)
      ? attachment.sizeBytes
      : raw?.size;
    const size = Number.isFinite(sizeBytes) ? `${sizeBytes}B` : 'unknown';
    const url = attachment?.url || raw?.url || raw?.proxyURL || '(missing-url)';
    lines.push(`${index}. name=${name}; type=${type}; size=${size}; url=${url}`);
  }

  return [
    'Attachments:',
    ...lines,
  ].join('\n');
}
