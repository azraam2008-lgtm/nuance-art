// Pazaryeri API çağrıları için ortak HTTP katmanı: zaman aşımı, 429/5xx'te üstel geri çekilmeli tekrar.

export class MarketplaceApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = 'MarketplaceApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  json?: unknown;
  body?: BodyInit;
  timeoutMs?: number;
  retries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function request<T = unknown>(url: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', headers = {}, json, body, timeoutMs = 20_000, retries = 2 } = opts;
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: { Accept: 'application/json', ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: json !== undefined ? JSON.stringify(json) : body,
        signal: controller.signal,
        cache: 'no-store',
      });
      const text = await res.text();
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          const retryAfter = Number(res.headers.get('retry-after')) * 1000;
          await sleep(retryAfter > 0 ? retryAfter : 500 * 2 ** attempt);
          attempt++;
          continue;
        }
        throw new MarketplaceApiError(`HTTP ${res.status} — ${text.slice(0, 300) || res.statusText}`, res.status, text);
      }
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    } catch (err) {
      if (err instanceof MarketplaceApiError) throw err;
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
        attempt++;
        continue;
      }
      const msg = err instanceof Error ? (err.name === 'AbortError' ? 'Zaman aşımı' : err.message) : String(err);
      throw new MarketplaceApiError(`Bağlantı hatası: ${msg}`, 0, '');
    } finally {
      clearTimeout(timer);
    }
  }
}

export const basicAuth = (user: string, pass: string) =>
  'Basic ' + Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Tarih aralığını en fazla `maxDays` günlük pencerelere böler (Trendyol 14 gün sınırı vb.) */
export function dateWindows(since: Date, until: Date, maxDays: number): Array<[Date, Date]> {
  const out: Array<[Date, Date]> = [];
  let start = since.getTime();
  const end = until.getTime();
  const step = maxDays * 86_400_000;
  while (start < end) {
    const stop = Math.min(start + step, end);
    out.push([new Date(start), new Date(stop)]);
    start = stop;
  }
  return out;
}

export const str = (v: unknown, fallback = '') => (v === undefined || v === null ? fallback : String(v));
export const num = (v: unknown, fallback = 0) => {
  if (typeof v === 'object' && v !== null && 'amount' in v) v = (v as { amount: unknown }).amount;
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
};
