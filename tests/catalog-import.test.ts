// Uçtan uca: 3 pazaryeri → tek katalog (bellek içi sahte veritabanıyla)
import assert from 'node:assert/strict';

async function main() {
  const { tables } = await import('./fakes/supabase-server');
  const { importCatalogStep } = await import('../src/lib/sync/catalog-import');
  const base = { description: '', category: '', brand: '', vatRate: 20, listPrice: 0, costPrice: 0, images: [] as string[], attributes: {} };
  const mk = (externalId: string, sku: string, barcode: string, price: number, stock: number) => ({ ...base, externalId, sku, barcode, title: `Ürün ${sku}`, price, stock });
  // Trendyol: 5 ürün (biri yalnızca burada). N11: aynı 4 ürün (biri farklı stok, biri farklı fiyat). Hepsiburada: barkod yok, SKU ile eşleşir.
  const catalogs: Record<string, ReturnType<typeof mk>[]> = {
    trendyol: [mk('t1', 'A', '111', 100, 10), mk('t2', 'B', '222', 50, 5), mk('t3', 'C', '333', 70, 0), mk('t4', 'D', '444', 30, 8), mk('t5', 'E', '555', 20, 3)],
    n11: [mk('n1', 'a-n11', '111', 100, 7), mk('n2', 'B', '222', 55, 5), mk('n3', 'C', '333', 70, 6), mk('n4', 'D', '444', 30, 8)],
    hepsiburada: [mk('h1', 'A', '', 100, 10), mk('h9', 'Z', '', 99, 1)],
  };
  const adapters = new Map(Object.entries(catalogs).map(([m, list]) => [m, { adapter: { fetchProducts: async (page: number) => (page === 0 ? list : []) }, row: {} }]));
  const deps = { loadAdapters: async () => adapters as never };

  let step = await importCatalogStep(null, 30_000, deps);
  assert.equal(step.cursor, null, 'tek çağrıda bitti');
  const P = tables.products; const L = tables.marketplace_listings;
  assert.equal(P.length, 6, 'A,B,C,D,E (Trendyol) + Z (yalnızca Hepsiburada) = 6 tekil ürün');
  assert.equal(L.length, 11, 'her pazaryeri ilanı bağlandı');
  assert.equal(step.created, 6); assert.equal(step.linked, 11);
  const A = P.find((p) => p.sku === 'A')!;
  assert.equal(A.total_stock, 7, 'farklı stok → sıfır olmayan en düşük');
  const C = P.find((p) => p.sku === 'C')!;
  assert.equal(C.total_stock, 6, "Trendyol'da 0 olması N11'deki 6'yı sıfırlamaz");
  const nB = L.find((l) => l.marketplace_name === 'n11' && l.product_id === P.find((p) => p.sku === 'B')!.id)!;
  assert.equal(nB.price_override, 55, "N11'deki farklı fiyat korunur");
  const tB = L.find((l) => l.marketplace_name === 'trendyol' && l.product_id === nB.product_id)!;
  assert.equal(tB.price_override, null);
  assert.equal(L.filter((l) => l.product_id === A.id).length, 3, 'A: Trendyol + N11 (barkod) + Hepsiburada (SKU)');
  assert.ok(step.notes.some((n) => n.startsWith('A:')), 'stok farkı raporlandı');

  // Tekrar çalıştırma: hiçbir şey çoğalmaz
  step = await importCatalogStep(null, 30_000, deps);
  assert.equal(P.length, 6); assert.equal(L.length, 11);
  assert.equal(step.created, 0); assert.equal(step.linked, 0); assert.equal(step.already, 11);

  // Pazaryerinde yeni ürün açıldı → yalnızca o eklenir; mevcut ürünün stoğuna dokunulmaz
  catalogs.trendyol.push(mk('t6', 'F', '666', 40, 2));
  catalogs.trendyol[0].stock = 99;
  step = await importCatalogStep(null, 30_000, deps);
  assert.equal(P.length, 7); assert.equal(step.created, 1); assert.equal(P.find((p) => p.sku === 'A')!.total_stock, 7, 'panel ortak stoğu korunur');

  // Zaman dolunca kaldığı yerden devam eder
  const big = Array.from({ length: 120 }, (_, i) => mk(`k${i}`, `K${i}`, `9${i}`, 10, 1));
  const pageAdapters = new Map([['koctas', { adapter: { fetchProducts: async (page: number) => big.slice(page * 50, page * 50 + 50) }, row: {} }]]);
  let cur = await importCatalogStep(null, 0, { loadAdapters: async () => pageAdapters as never });
  let calls = 1;
  while (cur.cursor) { cur = await importCatalogStep(cur.cursor, 0, { loadAdapters: async () => pageAdapters as never }); calls++; }
  assert.equal(P.filter((p) => p.sku.startsWith('K')).length, 120); assert.ok(calls >= 3, 'birden çok adımda tamamlandı');
  console.log('catalog-import.test.ts: tüm kontroller geçti');
}
main().catch((e) => { console.error(e); process.exit(1); });
