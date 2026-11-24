import 'server-only';
import { NextResponse } from 'next/server';
import { activeUser } from '@/lib/auth/server';
import { currentRole, withStore, type Role } from '@/lib/tenant';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/**
 * Route handler'ları saran ortak hata yönetimi + oturum/mağaza bağlamı.
 * Oturum geçersizse 401 döner; geçerliyse fonksiyon kullanıcının mağazası bağlamında çalışır
 * (db() yalnızca o mağazanın verisini görür).
 */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return handlePublic(async (...args: A) => {
    const user = await activeUser();
    if (!user) throw new HttpError(401, 'Oturumunuz sona erdi. Lütfen tekrar giriş yapın.');
    const role = (user.role === 'admin' || user.role === 'staff' ? user.role : 'owner') as Role;
    const req = args[0] instanceof Request ? args[0] : null;
    if (req) checkPolicy(role, new URL(req.url).pathname, req.method);
    const out = await withStore(user.storeId, () => fn(...args), user.id, { role, name: user.name });
    return role === 'staff' && !(out instanceof Response) ? stripSensitive(out) : out;
  });
}

/** Oturum gerektirmeyen uçlar (cron, webhook, giriş): mağaza bağlamını kendileri kurar */
export function handlePublic<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return async (...args: A) => {
    try {
      const data = await fn(...args);
      return data instanceof Response ? data : NextResponse.json(data ?? { ok: true });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const message = e instanceof Error ? e.message : String(e);
      if (status >= 500) console.error('[api]', e);
      return NextResponse.json({ error: message }, { status });
    }
  };
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Geçersiz JSON gövdesi.');
  }
}

export function requireString(v: unknown, field: string, max = 500): string {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${field} zorunludur.`);
  if (v.length > max) throw new HttpError(400, `${field} en fazla ${max} karakter olabilir.`);
  return v.trim();
}

export function requireNumber(v: unknown, field: string, { min = 0, int = false } = {}): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n < min) throw new HttpError(400, `${field} geçerli bir sayı olmalı (en az ${min}).`);
  if (int && !Number.isInteger(n)) throw new HttpError(400, `${field} tam sayı olmalı.`);
  return n;
}

/** Europe/Istanbul saat dilimine göre YYYY-MM-DD */
export function istanbulDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const RANK: Record<Role, number> = { staff: 1, admin: 2, owner: 3 };
const ROLE_NAME: Record<Role, string> = { owner: 'mağaza sahibi', admin: 'yönetici', staff: 'personel' };

/** Bu işlem için en az şu rol gerekir; değilse 403 */
export function requireRole(min: Role) {
  if (RANK[currentRole()] < RANK[min]) {
    throw new HttpError(403, `Bu işlem için ${ROLE_NAME[min]} yetkisi gerekiyor. Mağaza sahibinden yetki isteyin.`);
  }
}

/**
 * Rol politikası (tek yerde):
 * - Personel: maliyet/kâr/fiyat sayfaları, API anahtarları, giderler, reklam, toplu fiyat, içe aktarma kapalı.
 * - Yönetici: her şey açık; yalnızca ekip yönetimi ve deneme mağazası sahipte.
 */
const STAFF_BLOCKED = [
  /^\/api\/credentials/, /^\/api\/fees\//, /^\/api\/profit/, /^\/api\/insights/, /^\/api\/expenses/, /^\/api\/ads/,
  /^\/api\/products\/bulk-(price|import)/, /^\/api\/products\/import/, /^\/api\/simulate/, /^\/api\/orders\/[^/]+\/cost/, /^\/api\/demo/,
  /^\/api\/products\/[^/]+\/listings$/, /^\/api\/invoicing/,
];
const OWNER_ONLY = [/^\/api\/demo/];
export function checkPolicy(role: Role, path: string, method: string) {
  if (role === 'staff' && STAFF_BLOCKED.some((r) => r.test(path))) {
    // Pazaryeri bağlantı durumunu (anahtarsız) personel de görebilir
    if (!(path === '/api/credentials' && method === 'GET')) {
      throw new HttpError(403, 'Bu bölüm için yetkiniz yok (personel hesabı). Mağaza sahibinden yetki isteyin.');
    }
  }
  if (role !== 'owner' && OWNER_ONLY.some((r) => r.test(path)) && method !== 'GET') {
    throw new HttpError(403, 'Bu işlemi yalnızca mağaza sahibi yapabilir.');
  }
}

/** Personele giden yanıttan maliyet, kâr, komisyon ve anahtar bilgilerini çıkarır */
const SENSITIVE = /(cost|profit|margin|commission|secret|api_?key|seller_?id|withholding|stopaj)/i;
export function stripSensitive(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripSensitive);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const o: Record<string, unknown> = {};
    // "cost" sipariş termin bilgisini de taşır: nesne kalır, içindeki kâr alanları çıkarılır
    for (const [k, x] of Object.entries(v)) if (k === 'cost' || !SENSITIVE.test(k)) o[k] = stripSensitive(x);
    return o;
  }
  return v;
}
