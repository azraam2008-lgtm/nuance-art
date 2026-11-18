import 'server-only';
import { NextResponse } from 'next/server';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Route handler'ları saran ortak hata yönetimi */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
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
