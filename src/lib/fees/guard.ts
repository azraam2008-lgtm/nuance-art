import 'server-only';
import { db, must } from '@/lib/supabase/server';
import { MARKETPLACE_META, isMarketplace } from '@/lib/marketplaces/meta';
import { profitsFor } from './listing-profit';

/**
 * Zararına satış koruması: yayındaki ilanların güncel fiyatıyla net kârı hesaplar;
 * zarar eden veya ürünün "en düşük kâr marjı" altında kalan pazaryerlerini döndürür.
 * priceOf ile henüz kaydedilmemiş yeni fiyatlar da denenebilir (toplu fiyat önizlemesi).
 */
export interface PriceWarning { productId: string; sku: string; marketplace: string; label: string; price: number; netProfit: number; margin: number; minMargin: number | null }

export async function priceWarnings(productIds: string[], priceOf?: (id: string, current: number) => number): Promise<PriceWarning[]> {
  const out: PriceWarning[] = [];
  for (let i = 0; i < productIds.length; i += 100) {
    const rows = must(await db().from('products')
      .select('*, listings:marketplace_listings(marketplace_name, listing_status, commission_rate, handling_days, same_day_tag, fast_tag, carrier, manual_shipping_cost, price_override)')
      .in('id', productIds.slice(i, i + 100))) as Array<Record<string, unknown> & { id: string; sku: string; price: number; min_margin: number | null; listings: Array<{ marketplace_name: string; listing_status: string; price_override: number | null }> }>;
    const prepared = rows.map((p) => ({
      ...p,
      price: priceOf ? priceOf(p.id, Number(p.price)) : Number(p.price),
      listings: p.listings.filter((l) => l.listing_status !== 'passive'),
    }));
    const withProfit = await profitsFor(prepared as unknown as Parameters<typeof profitsFor>[0]);
    for (const p of withProfit as unknown as Array<typeof prepared[number] & { profits: Record<string, { price: number; netProfit: number; margin: number }> }>) {
      const min = p.min_margin != null ? Number(p.min_margin) / 100 : null;
      for (const [mp, pr] of Object.entries(p.profits ?? {})) {
        if (pr.netProfit < 0 || (min !== null && pr.margin < min)) {
          out.push({ productId: p.id, sku: p.sku, marketplace: mp, label: isMarketplace(mp) ? MARKETPLACE_META[mp].label : mp, price: pr.price, netProfit: pr.netProfit, margin: pr.margin, minMargin: p.min_margin });
        }
      }
    }
  }
  return out;
}
