// Aynı pazaryerinde ikinci mağaza: kurallar ana pazaryerinden, katalog ortak
import assert from 'node:assert/strict';

async function main() {
  const meta = await import('../src/lib/marketplaces/meta');
  assert.equal(meta.baseOf('trendyol_2'), 'trendyol');
  assert.equal(meta.MARKETPLACE_META.trendyol_2.label, 'Trendyol 2');
  assert.equal(meta.ORDER_PREFIX.trendyol_2, 'TY2');
  assert.ok(meta.isMarketplace('n11_2'));
  const { GUIDES } = await import('../src/lib/marketplaces/guides');
  assert.deepEqual(GUIDES.trendyol_2.needs, GUIDES.trendyol.needs);
  const { DEFAULT_COMMISSION } = await import('../src/lib/fees/commission-defaults');
  const { CARRIERS_BY_MARKETPLACE } = await import('../src/lib/fees/carriers');
  assert.equal(DEFAULT_COMMISSION.trendyol_2, DEFAULT_COMMISSION.trendyol);
  assert.deepEqual(CARRIERS_BY_MARKETPLACE.hepsiburada_2, CARRIERS_BY_MARKETPLACE.hepsiburada);
  const { pickRule } = await import('../src/lib/fees/service');
  assert.equal(pickRule([], 'trendyol_2', '2026-11-28').marketplace, 'trendyol', 'ikinci mağaza Trendyol komisyon kuralını kullanır');

  // Katalog: iki Trendyol mağazasında aynı ürün → tek ürün, iki ilan; ortak stok
  const { tables } = await import('./fakes/supabase-server');
  const { importCatalogStep } = await import('../src/lib/sync/catalog-import');
  const base = { description: '', category: '', brand: '', vatRate: 20, listPrice: 0, costPrice: 0, images: [] as string[], attributes: {} };
  const nisa = [{ ...base, externalId: 'n1', sku: 'NEV-01', barcode: '868001', title: 'Nevresim', price: 500, stock: 12 }];
  const berra = [{ ...base, externalId: 'b1', sku: 'NEV-01', barcode: '868001', title: 'Nevresim', price: 520, stock: 10 },
    { ...base, externalId: 'b2', sku: 'YST-02', barcode: '868002', title: 'Yastık', price: 150, stock: 4 }];
  const adapters = new Map<string, unknown>([
    ['trendyol', { adapter: { fetchProducts: async (p: number) => (p ? [] : nisa) }, row: {} }],
    ['trendyol_2', { adapter: { fetchProducts: async (p: number) => (p ? [] : berra) }, row: {} }],
  ]);
  const step = await importCatalogStep(null, 30_000, { loadAdapters: async () => adapters as never });
  assert.equal(step.cursor, null);
  const nev = tables.products.find((p) => p.sku === 'NEV-01')!;
  assert.equal(tables.products.length, 2);
  assert.equal(nev.total_stock, 10, 'ortak stok: en düşük');
  const ls = tables.marketplace_listings.filter((l) => l.product_id === nev.id);
  assert.deepEqual(ls.map((l) => l.marketplace_name).sort(), ['trendyol', 'trendyol_2']);
  assert.equal(ls.find((l) => l.marketplace_name === 'trendyol_2')!.price_override, 520, 'Berezza fiyatı korunur');
  console.log('second-account.test.ts: tüm kontroller geçti');
}
main().catch((e) => { console.error(e); process.exit(1); });
