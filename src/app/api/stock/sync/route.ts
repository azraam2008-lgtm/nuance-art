import { handle } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { log, pushStock } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Tüm aktif ilanların stok ve fiyatını ortak havuzdaki değerle yeniden gönderir
export const POST = handle(async () => {
  const ids = [...new Set((must(await db().from('marketplace_listings').select('product_id').eq('listing_status', 'active')) as Array<{ product_id: string }>).map((x) => x.product_id))];
  const summary = await pushStock(ids, null);
  await log('info', 'stock', null, `Toplu stok eşitleme: ${ids.length} ürün.`);
  return { products: ids.length, summary };
});
