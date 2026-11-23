import { handle, HttpError } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { recomputeAll } from '@/lib/fees/service';
import { isDemoStore } from '@/lib/demo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Demo verisini sıfırlar ve yeniden üretir. Canlı moda geçilmiş bir pazaryeri varsa güvenlik için reddedilir.
export const POST = handle(async () => {
  if (!(await isDemoStore())) throw new HttpError(404, 'Örnek veri yalnızca deneme mağazasında yüklenebilir.');
  const live = must(await db().from('marketplace_credentials').select('marketplace_name').eq('is_active', true)) as unknown[];
  if (live.length) {
    throw new HttpError(409, 'Canlı modda pazaryeri varken demo verisi yüklenemez (tüm ürün ve siparişler silinir). Önce canlı modu kapatın.');
  }
  const res = must(await db().rpc('seed_demo_data', {})) as { orders: number; products: number };
  const computed = await recomputeAll();
  return { ...res, computed };
});
