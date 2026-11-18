'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/**
 * Tarayıcı istemcisi yalnızca Realtime "panel" broadcast kanalını dinlemek için kullanılır.
 * Tablolarda RLS açık ve anon için politika yok; yani bu anahtarla veri okunamaz.
 */
export function browserClient(): SupabaseClient | null {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}
