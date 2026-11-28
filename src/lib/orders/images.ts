import 'server-only';
import { db, must } from '@/lib/supabase/server';

// Sipariş satırlarının ürün fotoğrafı.
// Ürünler panele sonradan aktarıldıysa eski siparişlerin satırları hiçbir ürüne bağlı değildir (product_id boş).
// Burada stok kodu / barkod ile ürün bulunur, satır kalıcı olarak bağlanır (bir kez) ve fotoğraf yoksa
// ürünün diğer fotoğrafı ya da aynı ürünün başka seçeneğinin fotoğrafı kullanılır.

export type ItemProduct = { id: string; image_url: string | null; barcode: string | null; variant_attrs: Record<string, string> | null };
type Item = { id?: string; sku: string; product?: ItemProduct | null } & Record<string, unknown>;
type Order = { id: string; items?: Item[] } & Record<string, unknown>;
type Prod = { id: string; sku: string; barcode: string; image_url: string | null; images: string[] | null; group_code: string | null; variant_attrs: Record<string, string> | null };

const chunks = <T,>(a: T[], n = 100) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const SKU_KEYS = ['merchantSku', 'sku', 'stockCode', 'merchantSKU', 'stock_code', 'productCode'];

/** Ham sipariş verisindeki satırlardan stok kodu → barkod eşleşmesi (Trendyol "lines", diğerleri benzer) */
function barcodeMap(raw: unknown, out: Map<string, string>, depth = 3) {
  if (!raw || typeof raw !== 'object' || depth < 0) return;
  if (Array.isArray(raw)) { for (const x of raw) barcodeMap(x, out, depth - 1); return; }
  const o = raw as Record<string, unknown>;
  const bc = typeof o.barcode === 'string' || typeof o.barcode === 'number' ? String(o.barcode) : '';
  if (bc) for (const k of SKU_KEYS) { const v = o[k]; if (typeof v === 'string' && v) out.set(v, bc); }
  for (const v of Object.values(o)) if (v && typeof v === 'object') barcodeMap(v, out, depth - 1);
}

async function productsBy(col: 'sku' | 'barcode', values: string[]): Promise<Prod[]> {
  const out: Prod[] = [];
  for (const part of chunks([...new Set(values.filter(Boolean))])) {
    out.push(...(must(await db().from('products').select('id, sku, barcode, image_url, images, group_code, variant_attrs').in(col, part)) as Prod[]));
  }
  return out;
}

export async function withProductImages<T extends Order>(orders: T[]): Promise<T[]> {
  const items = orders.flatMap((o) => (o.items ?? []).map((i) => ({ o, i })));
  if (!items.length) return orders;

  // 1) Bağlı olmayan satırları stok kodu / barkod ile ürüne bağla
  const loose = items.filter(({ i }) => !i.product && i.sku);
  if (loose.length) {
    const bySku = await productsBy('sku', loose.map(({ i }) => i.sku));
    const codes = new Map<string, string>();
    const needRaw = [...new Set(loose.filter(({ i }) => !bySku.some((p) => p.sku === i.sku)).map(({ o }) => o.id))];
    for (const part of chunks(needRaw)) {
      const rows = (await db().from('orders').select('id, raw').in('id', part)).data as Array<{ raw: unknown }> | null;
      for (const r of rows ?? []) barcodeMap(r.raw, codes);
    }
    const byBarcode = await productsBy('barcode', [...loose.map(({ i }) => i.sku), ...loose.map(({ i }) => codes.get(i.sku) ?? '')]);
    for (const { o, i } of loose) {
      const p = bySku.find((x) => x.sku === i.sku) ?? byBarcode.find((x) => x.barcode === (codes.get(i.sku) ?? i.sku));
      if (!p) continue;
      i.product = { id: p.id, image_url: p.image_url, barcode: p.barcode, variant_attrs: p.variant_attrs };
      // Kalıcı bağla (stok değişmez; yalnızca satırın hangi ürün olduğu kaydedilir)
      if (i.id) await db().from('order_items').update({ product_id: p.id }).eq('id', i.id).is('product_id', null);
      else await db().from('order_items').update({ product_id: p.id }).eq('order_id', o.id).eq('sku', i.sku).is('product_id', null);
    }
  }

  // 2) Fotoğrafı olmayan ürünler: ürünün diğer fotoğrafları, yoksa aynı ürünün başka seçeneği
  const noImg = [...new Set(items.filter(({ i }) => i.product && !i.product.image_url).map(({ i }) => i.product!.id))];
  if (noImg.length) {
    const prods: Prod[] = [];
    for (const part of chunks(noImg)) prods.push(...(must(await db().from('products').select('id, sku, barcode, image_url, images, group_code, variant_attrs').in('id', part)) as Prod[]));
    const groups = [...new Set(prods.map((p) => p.group_code).filter(Boolean))] as string[];
    const sibs: Prod[] = [];
    for (const part of chunks(groups)) sibs.push(...(must(await db().from('products').select('id, sku, barcode, image_url, images, group_code, variant_attrs').in('group_code', part).not('image_url', 'is', null)) as Prod[]));
    const img = new Map<string, string>();
    for (const p of prods) {
      const own = p.images?.find(Boolean);
      const sib = p.group_code ? sibs.find((s) => s.group_code === p.group_code && s.image_url) : null;
      const u = own ?? sib?.image_url ?? sib?.images?.find(Boolean);
      if (u) img.set(p.id, u);
    }
    for (const { i } of items) if (i.product && !i.product.image_url && img.has(i.product.id)) i.product = { ...i.product, image_url: img.get(i.product.id)! };
  }
  return orders;
}
