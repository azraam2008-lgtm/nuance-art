import 'server-only';
import { rawDb } from '@/lib/supabase/server';
import { currentStoreId, hasStore } from '@/lib/tenant';

/**
 * Deneme mağazası: yalnızca o mağazada örnek ürün/sipariş verisi ve simülasyon adaptörleri kullanılır;
 * hiçbir pazaryerine gerçek istek gitmez. (Geliştirme için DEMO_MODE=true tüm mağazalarda açar.)
 */
const cache = new Map<string, { v: boolean; exp: number }>();

export async function isDemoStore(storeId?: string): Promise<boolean> {
  if (process.env.DEMO_MODE === 'true') return true;
  const sid = storeId ?? (hasStore() ? currentStoreId() : null);
  if (!sid) return false;
  const hit = cache.get(sid);
  if (hit && hit.exp > Date.now()) return hit.v;
  const { data } = await rawDb().from('stores').select('is_demo').eq('id', sid).maybeSingle();
  const v = !!(data as { is_demo?: boolean } | null)?.is_demo;
  cache.set(sid, { v, exp: Date.now() + 15_000 });
  return v;
}

export function forgetDemoCache(storeId: string) {
  cache.delete(storeId);
}
