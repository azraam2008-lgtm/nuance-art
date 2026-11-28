// Sipariş satırı → ürün bağlama ve fotoğraf yedekleri (bellek içi sahte veritabanıyla)
import assert from 'node:assert/strict';

async function main() {
  const { tables } = await import('./fakes/supabase-server');
  const { withProductImages } = await import('../src/lib/orders/images');
  tables.products = [
    { id: 'p1', sku: 'NYKKK001-50', barcode: '8690001', image_url: 'https://x/1.jpg', images: ['https://x/1.jpg'], group_code: 'NYKKK001', variant_attrs: {} },
    { id: 'p2', sku: 'NYKKK001-43', barcode: '8690002', image_url: null, images: [], group_code: 'NYKKK001', variant_attrs: {} },
    { id: 'p3', sku: 'NADKK700-45', barcode: '8690003', image_url: null, images: ['https://x/3b.jpg'], group_code: null, variant_attrs: {} },
    { id: 'p4', sku: 'URUN-BARKOD', barcode: '8690004', image_url: 'https://x/4.jpg', images: [], group_code: null, variant_attrs: {} },
  ];
  // Ürünler sonradan aktarıldığı için satırlar bağlı değil (product_id boş)
  tables.orders = [{ id: 'o1', raw: { lines: [{ merchantSku: 'PAZARYERI-KODU', barcode: '8690004' }] } }];
  tables.order_items = [
    { id: 'i1', order_id: 'o1', sku: 'NYKKK001-43', product_id: null },
    { id: 'i2', order_id: 'o1', sku: 'NADKK700-45', product_id: null },
    { id: 'i3', order_id: 'o1', sku: 'PAZARYERI-KODU', product_id: null },
    { id: 'i4', order_id: 'o1', sku: 'HIC-YOK', product_id: null },
  ];
  const orders = [{ id: 'o1', items: tables.order_items.map((r: any) => ({ id: r.id, sku: r.sku, product: null })) }];
  await withProductImages(orders as any);
  const [a, b, c, d] = orders[0].items as any[];
  assert.equal(a.product.id, 'p2', 'stok koduyla bağlandı');
  assert.equal(a.product.image_url, 'https://x/1.jpg', 'fotoğrafı yok → aynı ürünün diğer seçeneğinin fotoğrafı');
  assert.equal(b.product.image_url, 'https://x/3b.jpg', 'kapak boş → ürünün diğer fotoğrafı');
  assert.equal(c.product.id, 'p4', 'stok kodu tutmadı → sipariş verisindeki barkodla bağlandı');
  assert.equal(d.product, null, 'panelde olmayan ürün boş kalır');
  assert.deepEqual(tables.order_items.map((r: any) => r.product_id), ['p2', 'p3', 'p4', null], 'bağlantı kalıcı yazıldı');
  console.log('order-images.test.ts: tüm kontroller geçti');
}
main().catch((e) => { console.error(e); process.exit(1); });
