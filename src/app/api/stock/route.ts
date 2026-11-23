import { handle } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Ürün bazında: başlangıç stoğu, pazaryeri satışları, kalan net stok ve her pazaryerine gönderilen son stok
export const GET = handle(async () => {
  const rows = must(await db().from('v_stock_breakdown').select('*').order('is_critical', { ascending: false }).order('title')) as Array<{ id: string }>;
  const listings = must(await db().from('marketplace_listings').select('product_id, marketplace_name, listing_status, last_pushed_stock, sync_error_message, last_synced_at').neq('listing_status', 'passive')) as
    Array<{ product_id: string; marketplace_name: string; listing_status: string; last_pushed_stock: number | null; sync_error_message: string | null; last_synced_at: string | null }>;
  const images = must(await db().from('products').select('id, image_url, variant_attrs, safety_stock')) as Array<{ id: string; image_url: string | null; variant_attrs: Record<string, string> | null; safety_stock: number | null }>;
  const img = new Map(images.map((x) => [x.id, x]));
  const by = new Map<string, typeof listings>();
  for (const l of listings) by.set(l.product_id, [...(by.get(l.product_id) ?? []), l]);
  return { rows: rows.map((r) => ({ ...r, image_url: img.get(r.id)?.image_url ?? null, variant_attrs: img.get(r.id)?.variant_attrs ?? {}, safety_stock: img.get(r.id)?.safety_stock ?? 0, listings: by.get(r.id) ?? [] })) };
});
