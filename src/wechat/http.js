import { ProxyAgent, setGlobalDispatcher } from 'undici';

const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'EPIPE',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findErrorCode(err) {
  let current = err;
  for (let depth = 0; current && typeof current === 'object' && depth < 6; depth += 1) {
    if (typeof current.code === 'string') return current.code;
    current = current.cause;
  }
  return '';
}

export function isRetryableWechatNetworkError(err) {
  const code = findErrorCode(err);
  if (RETRYABLE_CODES.has(code)) return true;
  if (err?.name === 'TimeoutError') return true;
  const text = String(err?.message || err || '').toLowerCase();
  return text.includes('socket hang up') || text.includes('terminated');
}

function combineSignals(external, timeout) {
  if (!external) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([external, timeout]);
  const controller = new AbortController();
  for (const signal of [external, timeout]) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

export async function fetchWechat(url, {
  timeoutMs = 30_000,
  retries = 2,
  retryOnHttpError = false,
  signal: externalSignal,
  ...init
} = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (externalSignal?.aborted) {
      throw externalSignal.reason || new DOMException('Aborted', 'AbortError');
    }
    const signal = combineSignals(externalSignal, AbortSignal.timeout(timeoutMs));
    try {
      const response = await fetch(url, { ...init, signal });
      if (
        retryOnHttpError
        && (response.status === 429 || response.status >= 500)
        && attempt < retries
      ) {
        await sleep(Math.min(8000, 500 * (2 ** attempt)));
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      if (externalSignal?.aborted) throw externalSignal.reason || err;
      if (!isRetryableWechatNetworkError(err) || attempt >= retries) throw err;
      await sleep(Math.min(8000, 500 * (2 ** attempt)));
    }
  }
  throw lastError || new Error('WeChat request failed');
}

export function configureWechatProxy(env = process.env, logger = console) {
  const proxy = env.WECHAT_HTTPS_PROXY
    || env.HTTPS_PROXY
    || env.https_proxy
    || env.HTTP_PROXY
    || env.http_proxy
    || env.ALL_PROXY
    || env.all_proxy;
  if (!proxy) return null;
  setGlobalDispatcher(new ProxyAgent(proxy));
  let label = proxy;
  try {
    const parsed = new URL(proxy);
    if (parsed.password) parsed.password = '***';
    label = parsed.toString();
  } catch {
  }
  logger.log(`[wechat] proxy enabled: ${label}`);
  return proxy;
}
