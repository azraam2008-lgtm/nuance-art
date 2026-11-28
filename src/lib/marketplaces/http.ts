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
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
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

/** Ham JSON içinden güvenle alan okuma (pazaryeri yanıtları için) */
export type Rec = Record<string, unknown>;
export const rec = (v: unknown): Rec => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : {});
export const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec) : []);

/** Pazaryerinin bu durumu API ile kabul etmediği durumlar için açıklayıcı sonuç */
export const notSupported = (message: string) => ({ ok: false, message, unsupported: true as const });

/**
 * Pazaryeri kategori ağacını "Ana › Alt › Yaprak" yollu düz listeye çevirir (yalnızca yaprak kategoriler).
 * Hem iç içe (children/subCategories) hem düz (parentId'li) yapıları destekler.
 */
export function flattenCategories(
  nodes: unknown,
  keys: { id?: string[]; name?: string[]; children?: string[]; parent?: string[]; leaf?: string[] } = {},
): Array<{ id: string | number; name: string; path: string }> {
  const idK = keys.id ?? ['id', 'categoryId', 'code'];
  const nameK = keys.name ?? ['name', 'label', 'title', 'displayName'];
  const childK = keys.children ?? ['subCategories', 'children', 'subcategories', 'childCategories'];
  const parentK = keys.parent ?? ['parentId', 'parent_code', 'parentCategoryId'];
  const leafK = keys.leaf ?? ['leaf', 'isLeaf'];
  const pick = (o: Rec, ks: string[]) => { for (const k of ks) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return undefined; };
  const out: Array<{ id: string | number; name: string; path: string }> = [];
  const list = recs(nodes);
  const nested = list.some((n) => recs(pick(n, childK)).length > 0);
  if (nested || !list.some((n) => pick(n, parentK) !== undefined)) {
    const walk = (arr: Rec[], parents: string[]) => {
      for (const n of arr) {
        const name = str(pick(n, nameK));
        const path = [...parents, name];
        const kids = recs(pick(n, childK));
        if (kids.length) walk(kids, path);
        else out.push({ id: pick(n, idK) as string | number, name, path: path.join(' › ') });
      }
    };
    walk(list, []);
    return out.filter((c) => c.id !== undefined);
  }
  // Düz liste: parentId ile yolu kur, çocuğu olmayanları (veya leaf=true) al
  const byId = new Map(list.map((n) => [str(pick(n, idK)), n]));
  const hasChild = new Set(list.map((n) => str(pick(n, parentK))).filter(Boolean));
  for (const n of list) {
    const id = str(pick(n, idK));
    const leafFlag = pick(n, leafK);
    if (leafFlag === false || (leafFlag === undefined && hasChild.has(id))) continue;
    const names: string[] = [];
    let cur: Rec | undefined = n;
    for (let guard = 0; cur && guard < 12; guard++) {
      names.unshift(str(pick(cur, nameK)));
      const p = str(pick(cur, parentK));
      cur = p ? byId.get(p) : undefined;
    }
    out.push({ id: pick(n, idK) as string | number, name: str(pick(n, nameK)), path: names.join(' › ') });
  }
  return out;
}

/** Kategori listelerini 6 saat önbellekte tutar (tüm mağazalar için aynı katalog) */
const catCache = new Map<string, { exp: number; items: Array<{ id: string | number; name: string; path: string }> }>();
export async function cachedCategories(key: string, load: () => Promise<Array<{ id: string | number; name: string; path: string }>>) {
  const hit = catCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.items;
  const items = await load();
  if (items.length) catCache.set(key, { exp: Date.now() + 6 * 3600_000, items });
  return items;
}

export function searchIn<T extends { path: string }>(items: T[], q: string, limit = 40): T[] {
  const words = q.toLocaleLowerCase('tr-TR').split(/\s+/).filter(Boolean);
  return items.filter((c) => { const p = c.path.toLocaleLowerCase('tr-TR'); return words.every((w) => p.includes(w)); }).slice(0, limit);
}

const TR_OFFSET_MS = 3 * 3600_000;
/**
 * Pazaryeri tarihini doğru ana çevirir (ISO). Türkiye pazaryerleri saatleri çoğunlukla Türkiye saatiyle (UTC+3) verir:
 *  - Saat dilimi yazmayan metin ("2026-11-25 14:30:00", "25.11.2026 14:30") → Türkiye saati kabul edilir.
 *  - Sayı (milisaniye): `localEpoch` ise Türkiye saati "UTC gibi" yazılmıştır (Trendyol) → 3 saat geri alınır.
 */
export function parseMarketDate(v: unknown, opts: { localEpoch?: boolean; fallback?: number } = {}): string {
  const fb = () => new Date(opts.fallback ?? Date.now()).toISOString();
  if (v === null || v === undefined || v === '') return fb();
  if (typeof v === 'number' || /^\d{10,13}$/.test(String(v))) {
    let n = Number(v);
    if (n < 1e12) n *= 1000; // saniye
    if (opts.localEpoch) n -= TR_OFFSET_MS;
    return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : fb();
  }
  let s = String(v).trim();
  const tr = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (tr) s = `${tr[3]}-${tr[2].padStart(2, '0')}-${tr[1].padStart(2, '0')}T${(tr[4] ?? '00').padStart(2, '0')}:${tr[5] ?? '00'}:${tr[6] ?? '00'}`;
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(s);
  if (!hasZone && /^\d{4}-\d{2}-\d{2}/.test(s)) s = `${s.replace(' ', 'T')}${s.length <= 10 ? 'T00:00:00' : ''}+03:00`;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : fb();
}
