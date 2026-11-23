import { handle, HttpError, readJson } from '@/lib/api';
import { db, rawDb, must } from '@/lib/supabase/server';
import { currentStoreId } from '@/lib/tenant';
import { forgetDemoCache, isDemoStore } from '@/lib/demo';
import { recomputeAll } from '@/lib/fees/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Deneme mağazası aç/kapat.
 *  Aç: mağazada gerçek veri yoksa örnek ürün ve siparişler yüklenir; tüm pazaryerleri simülasyonla çalışır.
 *  Kapat: örnek veriler silinir, mağaza gerçek kullanıma döner (API anahtarları ve ayarlar korunur).
 */
export const GET = handle(async () => ({ demo: await isDemoStore() }));

export const POST = handle(async (req: Request) => {
  const { enable } = await readJson<{ enable?: boolean }>(req);
  const sid = currentStoreId();
  const now = await isDemoStore();
  if (enable) {
    if (now) return { demo: true };
    const live = must(await db().from('marketplace_credentials').select('marketplace_name').eq('is_active', true)) as unknown[];
    const { count } = await db().from('products').select('id', { count: 'exact', head: true });
    if (live.length || (count ?? 0) > 0) {
      throw new HttpError(409, 'Bu mağazada gerçek ürün veya bağlı pazaryeri var; deneme verisi bunları silerdi. Deneme için ayrı bir e-postayla yeni hesap açın.');
    }
    must(await rawDb().from('stores').update({ is_demo: true }).eq('id', sid).select('id'));
    forgetDemoCache(sid);
    const seeded = must(await db().rpc('seed_demo_data', {})) as { orders: number; products: number };
    await recomputeAll();
    await db().from('app_settings').upsert({ key: 'onboarding', value: { completedAt: new Date().toISOString() }, updated_at: new Date().toISOString() });
    return { demo: true, ...seeded };
  }
  if (!now) return { demo: false };
  must(await db().rpc('clear_store_data', {}));
  must(await rawDb().from('stores').update({ is_demo: false }).eq('id', sid).select('id'));
  forgetDemoCache(sid);
  return { demo: false };
});
