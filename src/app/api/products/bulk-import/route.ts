import { handle, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/supabase/server';
import { log } from '@/lib/sync/engine';

import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface Row { title?: string; sku?: string; barcode?: string; price?: string; cost?: string; stock?: string; category?: string; brand?: string; description?: string; vat?: string; desi?: string; group?: string; variant?: string }
const num = (v: unknown, def: number | null = null) => {
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(/₺|TL/gi, '');
  if (!s) return def;
  const n = Number(s.includes(',') && s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Excel/CSV'den toplu ürün yükleme. Ürünler stok havuzuna eklenir (pazaryerine gönderilmez);
 * fotoğraf ve pazaryeri kategorisi ürün sayfasından eklenip yayınlanır. Var olan SKU/barkod atlanır.
 */
export const POST = handle(async (req: Request) => {
  const b = await readJson<{ rows?: Row[] }>(req);
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, 1000) : [];
  if (!rows.length) throw new HttpError(400, 'Dosyada ürün bulunamadı.');
  const results: Array<{ line: number; sku: string; ok: boolean; message: string }> = [];
  const valid: Array<Record<string, unknown> & { sku: string }> = [];
  rows.forEach((r, i) => {
    const line = i + 2; // 1. satır başlık
    const title = String(r.title ?? '').trim();
    const sku = String(r.sku ?? '').trim();
    const barcode = String(r.barcode ?? '').trim() || sku;
    const price = num(r.price), cost = num(r.cost, 0), stock = num(r.stock, 0), vat = num(r.vat, 20), desi = num(r.desi, 1);
    const problems = [
      !title && 'ürün adı boş', !sku && 'SKU boş', !(price && price > 0) && 'fiyat geçersiz',
      Number.isNaN(cost) && 'maliyet geçersiz', (Number.isNaN(stock) || !Number.isInteger(stock)) && 'stok tam sayı olmalı', Number.isNaN(vat) && 'KDV geçersiz',
    ].filter(Boolean);
    if (problems.length) { results.push({ line, sku, ok: false, message: problems.join(', ') }); return; }
    const variant = String(r.variant ?? '').trim();
    const attrs = variant ? Object.fromEntries(variant.split(/[;|]/).map((p) => p.split(/[:=]/).map((x) => x.trim())).filter((p) => p.length === 2 && p[0] && p[1])) : {};
    valid.push({
      title: title.slice(0, 200), sku: sku.slice(0, 64), barcode: barcode.slice(0, 64), price, list_price: price, cost_price: cost, total_stock: stock,
      vat_rate: vat, desi, category: String(r.category ?? '').trim().slice(0, 120) || 'Genel', brand: String(r.brand ?? '').trim().slice(0, 100),
      description: String(r.description ?? '').slice(0, 30000), group_code: String(r.group ?? '').trim() || null, variant_attrs: attrs,
      images: [], image_url: null, marketplace_attributes: {},
    });
  });

  // Var olanları atla (SKU veya barkod)
  const existing = new Set<string>();
  for (let i = 0; i < valid.length; i += 100) {
    const part = valid.slice(i, i + 100);
    const { data } = await db().from('products').select('sku, barcode').or(`sku.in.(${part.map((p) => `"${p.sku.replace(/"/g, '')}"`).join(',')}),barcode.in.(${part.map((p) => `"${String(p.barcode).replace(/"/g, '')}"`).join(',')})`);
    for (const x of (data ?? []) as Array<{ sku: string; barcode: string }>) { existing.add(x.sku); existing.add(x.barcode); }
  }
  const seen = new Set<string>();
  const toInsert = valid.filter((p) => {
    const dup = existing.has(p.sku) || existing.has(String(p.barcode)) || seen.has(p.sku) || seen.has(String(p.barcode));
    seen.add(p.sku); seen.add(String(p.barcode));
    if (dup) results.push({ line: rows.findIndex((r) => String(r.sku ?? '').trim() === p.sku) + 2, sku: p.sku, ok: false, message: 'Bu SKU veya barkod zaten kayıtlı / dosyada tekrar ediyor; atlandı.' });
    return !dup;
  });
  for (let i = 0; i < toInsert.length; i += 200) {
    const part = toInsert.slice(i, i + 200);
    const { error } = await db().from('products').insert(part);
    for (const p of part) results.push({ line: rows.findIndex((r) => String(r.sku ?? '').trim() === p.sku) + 2, sku: p.sku, ok: !error, message: error ? error.message : 'Eklendi' });
  }
  const added = results.filter((r) => r.ok).length;
  if (added) await log('info', 'system', null, `Excel/CSV'den ${added} ürün stok havuzuna eklendi.`);
  if (added) await audit('Toplu ürün yükleme', `${added} ürün`);
  return { added, results: results.sort((a, b) => a.line - b.line) };
});
