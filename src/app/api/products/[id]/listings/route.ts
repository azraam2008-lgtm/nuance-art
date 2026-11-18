import { handle, HttpError, readJson } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { isMarketplace } from '@/lib/marketplaces/meta';
import { computeOrderCosts } from '@/lib/fees/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface ListingSettings {
  marketplace: string; commissionRate?: number | null; handlingDays?: number; sameDayTag?: boolean; fastTag?: boolean;
  carrier?: string | null; manualShippingCost?: number | null; priceOverride?: number | null;
}

/**
 * Ürünün maliyet bilgileri + pazaryeri bazlı ayarlarını kaydeder.
 * Bekleyen (kargolanmamış) siparişlerin tahmini kârı otomatik güncellenir.
 */
export const PUT = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const b = await readJson<{ product?: { costPrice?: number; costVatRate?: number | null; desi?: number; packagingCost?: number; vatRate?: number; lowStockThreshold?: number; price?: number }; listings?: ListingSettings[] }>(req);
  const num = (v: unknown, name: string, min = 0, max = 1e7) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} geçersiz.`);
    return n;
  };
  if (b.product) {
    const u: Record<string, unknown> = {};
    const p = b.product;
    if (p.costPrice !== undefined) u.cost_price = num(p.costPrice, 'Maliyet');
    if (p.costVatRate !== undefined) u.cost_vat_rate = num(p.costVatRate, 'Maliyet KDV', 0, 100);
    if (p.desi !== undefined) u.desi = num(p.desi, 'Desi', 0, 2000);
    if (p.packagingCost !== undefined) u.packaging_cost = num(p.packagingCost, 'Ambalaj');
    if (p.vatRate !== undefined) u.vat_rate = num(p.vatRate, 'KDV', 0, 100);
    if (p.lowStockThreshold !== undefined) u.low_stock_threshold = num(p.lowStockThreshold, 'Kritik eşik', 0, 1e6);
    if (p.price !== undefined) u.price = num(p.price, 'Fiyat');
    if (Object.keys(u).length) must(await db().from('products').update(u).eq('id', id).select('id'));
  }
  for (const l of b.listings ?? []) {
    if (!isMarketplace(l.marketplace)) throw new HttpError(400, 'Geçersiz pazaryeri.');
    const u: Record<string, unknown> = {};
    if (l.commissionRate !== undefined) u.commission_rate = num(l.commissionRate, 'Komisyon', 0, 100);
    if (l.handlingDays !== undefined) u.handling_days = num(l.handlingDays, 'Termin', 0, 30);
    if (l.sameDayTag !== undefined) u.same_day_tag = !!l.sameDayTag;
    if (l.fastTag !== undefined) u.fast_tag = !!l.fastTag;
    if (l.carrier !== undefined) u.carrier = l.carrier || null;
    if (l.manualShippingCost !== undefined) u.manual_shipping_cost = num(l.manualShippingCost, 'Kargo maliyeti');
    if (l.priceOverride !== undefined) u.price_override = num(l.priceOverride, 'Pazaryeri fiyatı');
    const { data } = await db().from('marketplace_listings').update(u).eq('product_id', id).eq('marketplace_name', l.marketplace).select('id');
    if (!data?.length) {
      must(await db().from('marketplace_listings').insert({ product_id: id, marketplace_name: l.marketplace, listing_status: 'passive', ...u }).select('id'));
    }
  }
  // Bu ürünü içeren son 90 günlük siparişlerin kârını tazele
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const orderIds = (must(await db().from('order_items').select('order_id, order:orders!inner(order_date)').eq('product_id', id).gte('order.order_date', since)) as Array<{ order_id: string }>).map((x) => x.order_id);
  let recomputed = 0;
  recomputed = await computeOrderCosts(orderIds);
  return { ok: true, recomputed };
});
