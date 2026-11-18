import { handle, HttpError, readJson } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { isMarketplace, type MarketplaceName } from '@/lib/marketplaces/meta';
import type { RemoteProduct } from '@/lib/marketplaces/types';
import { getAdapter, log, publishProduct, type ProductRow } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Trendyol mağazasındaki onaylı ürünleri listeler; panelde zaten olanları işaretler
export const GET = handle(async (req: Request) => {
  const page = Math.max(0, Number(new URL(req.url).searchParams.get('page') ?? 0));
  const adapter = await getAdapter('trendyol');
  const remote = await adapter.fetchProducts(page, 50);
  const existing = must(await db().from('products').select('sku, barcode')) as Array<{ sku: string; barcode: string }>;
  const skus = new Set(existing.map((e) => e.sku));
  const barcodes = new Set(existing.map((e) => e.barcode));
  return {
    mode: adapter.mode,
    products: remote.map((p) => ({ ...p, alreadyImported: skus.has(p.sku) || barcodes.has(p.barcode) })),
  };
});

// Seçilen Trendyol ürünlerini içe aktar ve diğer pazaryerlerine dağıt
export const POST = handle(async (req: Request) => {
  const b = await readJson<{ products?: RemoteProduct[]; marketplaces?: unknown[] }>(req);
  const targets = ((b.marketplaces ?? ['hepsiburada', 'n11', 'ciceksepeti']).filter(isMarketplace) as MarketplaceName[])
    .filter((m) => m !== 'trendyol');
  if (!b.products?.length) throw new HttpError(400, 'İçe aktarılacak ürün seçilmedi.');

  const results: Array<{ sku: string; ok: boolean; message: string; publish?: unknown }> = [];
  for (const rp of b.products.slice(0, 50)) {
    const { data, error } = await db().from('products').insert({
      sku: rp.sku, barcode: rp.barcode, title: rp.title, description: rp.description ?? '', category: rp.category ?? '',
      brand: rp.brand ?? '', vat_rate: rp.vatRate ?? 20, price: rp.price, list_price: rp.listPrice ?? rp.price,
      cost_price: rp.costPrice ?? 0, total_stock: Math.max(0, Math.trunc(rp.stock ?? 0)), low_stock_threshold: 5,
      image_url: rp.images?.[0] ?? null, images: rp.images ?? [],
      marketplace_attributes: { trendyol: rp.attributes ?? {} },
    }).select('*').single();
    if (error) {
      results.push({ sku: rp.sku, ok: false, message: error.code === '23505' ? 'Zaten panelde kayıtlı.' : error.message });
      continue;
    }
    const product = data as ProductRow;
    await db().from('marketplace_listings').insert({
      product_id: product.id, marketplace_name: 'trendyol', external_product_id: rp.externalId,
      listing_status: 'active', last_synced_at: new Date().toISOString(), last_pushed_stock: product.total_stock,
    });
    await log('info', 'listing', 'trendyol', `Trendyol → içe aktarıldı: ${product.sku} (stok ${product.total_stock})`);
    const publish = targets.length ? await publishProduct(product.id, targets) : {};
    results.push({ sku: rp.sku, ok: true, message: 'Aktarıldı ve dağıtıldı.', publish });
  }
  return { results };
});
