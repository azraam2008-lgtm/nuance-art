// Pazaryerlerinden gelen ürünleri tek kataloğa birleştirme kuralları (saf fonksiyonlar, test edilir).
// Aynı ürün = aynı barkod; barkod yoksa aynı stok kodu (SKU). Büyük/küçük harf ve boşluklar önemsenmez.

export const normKey = (v: string | null | undefined) => String(v ?? '').trim().replace(/\s+/g, '').toLocaleUpperCase('tr');

export interface CatalogIndex { byBarcode: Map<string, string>; bySku: Map<string, string> }

export function buildIndex(rows: Array<{ id: string; sku: string; barcode: string }>): CatalogIndex {
  const idx: CatalogIndex = { byBarcode: new Map(), bySku: new Map() };
  for (const r of rows) addToIndex(idx, r);
  return idx;
}
export function addToIndex(idx: CatalogIndex, r: { id: string; sku: string; barcode: string }) {
  const b = normKey(r.barcode); const s = normKey(r.sku);
  if (b) idx.byBarcode.set(b, r.id);
  if (s) idx.bySku.set(s, r.id);
}
/** Panelde aynı ürün var mı? Önce barkod, sonra stok kodu (barkodu boş olan pazaryerleri için) */
export function findMatch(idx: CatalogIndex, p: { sku: string; barcode: string }): string | null {
  const b = normKey(p.barcode); const s = normKey(p.sku);
  return (b && (idx.byBarcode.get(b) ?? idx.bySku.get(b))) || (s && (idx.bySku.get(s) ?? idx.byBarcode.get(s))) || null;
}

/**
 * Aynı ürün farklı pazaryerlerinde farklı stokla duruyorsa ortak havuz için:
 * sıfır olmayan en düşük değer (fazla satışı önler; bir pazaryerinde pasif/0 olması diğerini sıfırlamaz).
 */
export function mergeStock(current: number, incoming: number): number {
  const a = Math.max(0, Math.trunc(current)); const b = Math.max(0, Math.trunc(incoming));
  if (a === 0) return b;
  if (b === 0) return a;
  return Math.min(a, b);
}
