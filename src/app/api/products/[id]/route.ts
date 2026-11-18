import { handle, HttpError, readJson, requireNumber, requireString } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { isMarketplace, MARKETPLACE_META } from '@/lib/marketplaces/meta';
import { errorMessage } from '@/lib/marketplaces/http';
import { computeOrderCosts } from '@/lib/fees/service';
import { profitsFor } from '@/lib/fees/listing-profit';
import { loadAdapters, log, pushStock, toPayload, type ProductRow } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Ürün detayı: ürün + pazaryeri ilanları + son hareketler + satış özeti
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const product = must(await db().from('products').select('*, listings:marketplace_listings(*)').eq('id', id).maybeSingle());
  if (!product) throw new HttpError(404, 'Ürün bulunamadı.');
  const movements = must(await db().from('stock_movements').select('marketplace_name, change_amount, reason, created_at').eq('product_id', id).order('created_at', { ascending: false }).limit(15));
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const sales = must(await db().from('order_items').select('quantity, unit_price, order:orders!inner(marketplace_name, status, order_date)').eq('product_id', id).gte('order.order_date', since)) as unknown as Array<{ quantity: number; unit_price: number; order: { marketplace_name: string; status: string } }>;
  const by: Record<string, { units: number; revenue: number }> = {};
  for (const s of sales) {
    if (s.order.status === 'cancelled') continue;
    const k = s.order.marketplace_name;
    by[k] = { units: (by[k]?.units ?? 0) + s.quantity, revenue: (by[k]?.revenue ?? 0) + s.quantity * Number(s.unit_price) };
  }
  const [withProfit] = await profitsFor([product as Parameters<typeof profitsFor>[0][number]]);
  return { product: withProfit, movements, sales30: by };
});

/**
 * Ürünü günceller ve değişikliği bağlı pazaryerlerine gönderir:
 * fiyat & stok → tüm aktif ilanlar; başlık/açıklama/görseller → içerik güncellemesini destekleyen pazaryerleri.
 */
export const PUT = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const b = await readJson<Record<string, unknown>>(req);
  const before = must(await db().from('products').select('*').eq('id', id).maybeSingle()) as ProductRow | null;
  if (!before) throw new HttpError(404, 'Ürün bulunamadı.');
  const u: Record<string, unknown> = {};
  if (b.title !== undefined) u.title = requireString(b.title, 'Ürün adı', 200);
  if (b.description !== undefined) u.description = String(b.description ?? '').slice(0, 30000);
  if (b.brand !== undefined) u.brand = String(b.brand ?? '').slice(0, 100);
  if (b.category !== undefined) u.category = String(b.category ?? '').slice(0, 120);
  if (b.price !== undefined) u.price = requireNumber(b.price, 'Satış fiyatı');
  if (b.listPrice !== undefined) u.list_price = b.listPrice === '' || b.listPrice == null ? null : requireNumber(b.listPrice, 'Liste fiyatı');
  if (b.vatRate !== undefined) u.vat_rate = requireNumber(b.vatRate, 'KDV');
  if (b.costPrice !== undefined) u.cost_price = requireNumber(b.costPrice, 'Maliyet');
  if (b.desi !== undefined) u.desi = requireNumber(b.desi, 'Desi');
  if (b.lowStockThreshold !== undefined) u.low_stock_threshold = requireNumber(b.lowStockThreshold, 'Kritik eşik', { int: true });
  if (Array.isArray(b.images)) {
    const imgs = (b.images as unknown[]).map(String).filter((x) => /^https?:\/\//.test(x)).slice(0, 10);
    u.images = imgs; u.image_url = imgs[0] ?? null;
  }
  if (b.marketplaceAttributes && typeof b.marketplaceAttributes === 'object') {
    u.marketplace_attributes = { ...(before.marketplace_attributes ?? {}), ...(b.marketplaceAttributes as Record<string, unknown>) };
  }
  if (Object.keys(u).length) must(await db().from('products').update(u).eq('id', id).select('id'));
  const prices = (b.priceOverrides && typeof b.priceOverrides === 'object' ? b.priceOverrides : {}) as Record<string, number | null>;
  for (const [mp, v] of Object.entries(prices)) {
    if (!isMarketplace(mp)) continue;
    await db().from('marketplace_listings').update({ price_override: v === null || v === undefined || (v as unknown) === '' ? null : Number(v) }).eq('product_id', id).eq('marketplace_name', mp);
  }

  const product = must(await db().from('products').select('*').eq('id', id).single()) as ProductRow;
  await log('info', 'system', null, `${product.sku} güncellendi.`);

  // Fiyat ve stok: tüm aktif ilanlara
  const stock = await pushStock([id], null);

  // İçerik: destekleyen pazaryerlerine
  const contentChanged = ['title', 'description', 'images', 'brand', 'marketplace_attributes'].some((k) => k in u);
  const content: Record<string, { ok: boolean; message: string }> = {};
  if (contentChanged) {
    const listings = must(await db().from('marketplace_listings').select('marketplace_name, external_product_id, price_override, handling_days, same_day_tag, fast_tag, listing_status').eq('product_id', id).in('listing_status', ['active', 'pending'])) as Array<{ marketplace_name: string; external_product_id: string | null; price_override: number | null; handling_days: number; same_day_tag: boolean; fast_tag: boolean }>;
    const adapters = await loadAdapters();
    for (const l of listings) {
      if (!isMarketplace(l.marketplace_name)) continue;
      const a = adapters.get(l.marketplace_name)?.adapter;
      if (!a) continue;
      if (!a.updateProduct) {
        content[l.marketplace_name] = { ok: false, message: `${MARKETPLACE_META[l.marketplace_name].label} API'si içerik güncellemesini desteklemiyor — fiyat ve stok gönderildi; başlık/görsel değişikliğini panelden yapın.` };
        continue;
      }
      try {
        const r = await a.updateProduct(toPayload(product, l.marketplace_name, l), l.external_product_id);
        content[l.marketplace_name] = { ok: r.ok, message: r.message };
        await log(r.ok ? 'success' : 'error', 'listing', l.marketplace_name, `${MARKETPLACE_META[l.marketplace_name].label} ← ${product.sku} içerik güncellemesi: ${r.message}`);
      } catch (e) {
        content[l.marketplace_name] = { ok: false, message: errorMessage(e) };
      }
    }
  }

  // Fiyat/maliyet değiştiyse bekleyen siparişlerin tahmini kârını tazele
  if ('price' in u || 'cost_price' in u || 'desi' in u) {
    const open = (must(await db().from('order_items').select('order_id, order:orders!inner(shipped_at)').eq('product_id', id).is('order.shipped_at', null)) as Array<{ order_id: string }>).map((x) => x.order_id);
    if (open.length) await computeOrderCosts(open);
  }
  return { product, stock, content };
});
