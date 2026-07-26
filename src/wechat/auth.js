import { fetchWechat } from './http.js';

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';

export async function getWechatQrCode() {
  const response = await fetchWechat(
    `${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`,
    { timeoutMs: 20_000, retries: 4, retryOnHttpError: true },
  );
  if (!response.ok) throw new Error(`WeChat QR request failed: HTTP ${response.status}`);
  return response.json();
}

export async function pollWechatQrCode(qrcode) {
  const response = await fetchWechat(
    `${DEFAULT_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
    {
      headers: { 'iLink-App-ClientVersion': '1' },
      timeoutMs: 15_000,
      retries: 1,
    },
  );
  if (!response.ok) throw new Error(`WeChat QR status failed: HTTP ${response.status}`);
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loginWechat({ showQrCode, logger = console } = {}) {
  for (let refresh = 0; refresh < 3; refresh += 1) {
    const qr = await getWechatQrCode();
    showQrCode(qr.qrcode_img_content || qr.qrcode);
    logger.log('[wechat] scan the QR code, then confirm on the phone');
    const deadline = Date.now() + 5 * 60_000;

    while (Date.now() < deadline) {
      await sleep(2000);
      try {
        const status = await pollWechatQrCode(qr.qrcode);
        if (status.status === 'scaned') {
          logger.log('[wechat] QR scanned; waiting for confirmation');
        } else if (status.status === 'confirmed') {
          return {
            botToken: status.bot_token,
            baseUrl: status.baseurl || DEFAULT_BASE_URL,
            ilinkBotId: status.ilink_bot_id,
            ilinkUserId: status.ilink_user_id,
          };
        } else if (status.status === 'expired') {
          break;
        }
      } catch (err) {
        logger.warn(`[wechat] QR status error: ${err?.message || err}`);
      }
    }
  }
  throw new Error('WeChat QR login timed out');
}
