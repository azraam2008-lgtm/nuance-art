import { handle, HttpError, readJson, requireNumber, requireString } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { isMarketplace, type MarketplaceName } from '@/lib/marketplaces/meta';
import { profitsFor } from '@/lib/fees/listing-profit';
import { log, publishProduct, type ProductRow } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Ürün listesi + pazaryeri ilan durumları
export const GET = handle(async () => {
  const products = must(await db()
    .from('products')
    .select('*, listings:marketplace_listings(marketplace_name, listing_status, external_product_id, sync_error_message, last_synced_at, last_pushed_stock, commission_rate, handling_days, same_day_tag, fast_tag, carrier, manual_shipping_cost, price_override)')
    .order('created_at', { ascending: false }));
  return { products: await profitsFor(products as Parameters<typeof profitsFor>[0]) };
});

// Tek formdan ürün oluştur + seçili pazaryerlerinde yayınla
export const POST = handle(async (req: Request) => {
  const b = await readJson<Record<string, unknown>>(req);
  const marketplaces = (Array.isArray(b.marketplaces) ? b.marketplaces : []).filter(isMarketplace) as MarketplaceName[];
  const images = (Array.isArray(b.images) ? b.images : String(b.images ?? '').split(/\s*[\n,]\s*/))
    .map((s) => String(s).trim()).filter((s) => /^https?:\/\//.test(s)).slice(0, 10);
  if (marketplaces.length && !images.length) throw new HttpError(400, 'Pazaryerinde yayınlamak için en az bir fotoğraf ekleyin.');
  const price = requireNumber(b.price, 'Satış fiyatı');

  const row = {
    title: requireString(b.title, 'Ürün adı', 200),
    sku: requireString(b.sku, 'SKU', 64),
    barcode: requireString(b.barcode, 'Barkod', 64),
    description: typeof b.description === 'string' ? b.description : '',
    category: requireString(b.category, 'Kategori', 120),
    brand: typeof b.brand === 'string' ? b.brand : '',
    vat_rate: requireNumber(b.vatRate ?? 20, 'KDV oranı'),
    price,
    list_price: b.listPrice ? requireNumber(b.listPrice, 'Liste fiyatı') : price,
    cost_price: requireNumber(b.costPrice ?? 0, 'Maliyet'),
    total_stock: requireNumber(b.stock, 'Başlangıç stoğu', { int: true }),
    low_stock_threshold: requireNumber(b.lowStockThreshold ?? 5, 'Kritik stok eşiği', { int: true }),
    image_url: images[0] ?? null,
    images,
    desi: b.desi !== undefined && b.desi !== '' ? requireNumber(b.desi, 'Desi') : 1,
    cost_vat_rate: b.costVatRate !== undefined && b.costVatRate !== '' ? requireNumber(b.costVatRate, 'Maliyet KDV oranı') : null,
    packaging_cost: b.packagingCost !== undefined && b.packagingCost !== '' ? requireNumber(b.packagingCost, 'Ambalaj maliyeti') : 0,
    marketplace_attributes: typeof b.marketplaceAttributes === 'object' && b.marketplaceAttributes ? b.marketplaceAttributes : {},
  };

  const { data, error } = await db().from('products').insert(row).select('*').single();
  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'Bu SKU veya barkod zaten kayıtlı.');
    throw new Error(error.message);
  }
  const product = data as ProductRow;
  await log('info', 'system', null, `Ana veritabanına kaydedildi: ${product.sku} (başlangıç stoğu ${product.total_stock})`);

  // Pazaryeri bazlı ayarlar YAYINDAN ÖNCE kaydedilir: pazaryerine özel fiyat, termin, Bugün Kargoda, komisyon, kargo firması
  const settings = (typeof b.listingSettings === 'object' && b.listingSettings ? b.listingSettings : {}) as Record<string, Record<string, unknown>>;
  const defaults = ((await db().from('app_settings').select('value').eq('key', 'listing_defaults').maybeSingle()).data?.value ?? {}) as Record<string, Record<string, unknown>>;
  const numOrNull = (v: unknown) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  for (const mp of new Set([...Object.keys(settings), ...marketplaces])) {
    if (!isMarketplace(mp)) continue;
    const ls = { ...(defaults[mp] ?? {}), ...(settings[mp] ?? {}) };
    const override = numOrNull(ls.priceOverride);
    must(await db().from('marketplace_listings').upsert({
      product_id: product.id, marketplace_name: mp,
      listing_status: marketplaces.includes(mp) ? 'pending' : 'passive',
      commission_rate: numOrNull(ls.commissionRate),
      handling_days: numOrNull(ls.handlingDays) ?? 1,
      same_day_tag: !!ls.sameDayTag, fast_tag: !!ls.fastTag, carrier: (ls.carrier as string) || null,
      manual_shipping_cost: numOrNull(ls.manualShippingCost),
      price_override: override != null && Math.abs(override - price) > 0.001 ? override : null,
    }, { onConflict: 'product_id,marketplace_name' }));
  }
  const results = marketplaces.length ? await publishProduct(product.id, marketplaces) : {};
  return { product, results };
});
