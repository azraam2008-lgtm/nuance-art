import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** Sunucu tarafı Supabase istemcisi (service_role — RLS'i aşar, asla tarayıcıya gönderilmez). */
export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY ortam değişkenleri tanımlı olmalı (.env.local).');
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** Supabase hatasını fırlatır, aksi halde veriyi döndürür */
export function must<T>(res: { data: T | null; error: { message: string; details?: string; hint?: string; code?: string } | null; status?: number }): T {
  if (res.error) {
    const e = res.error;
    throw new Error(e.message || e.details || e.hint || `Veritabanı hatası (${e.code ?? res.status ?? 'bilinmiyor'})`);
  }
  return res.data as T;
}
