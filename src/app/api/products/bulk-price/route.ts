import { handle, HttpError, readJson } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { log, pushStock } from '@/lib/sync/engine';
import { priceWarnings } from '@/lib/fees/guard';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Mode = 'percent' | 'add' | 'set';
const newPrice = (cur: number, mode: Mode, v: number, round: boolean) => {
  let p = mode === 'percent' ? cur * (1 + v / 100) : mode === 'add' ? cur + v : v;
  if (round) p = Math.max(0.9, Math.ceil(p) - 0.1); // ör. 347,3 → 347,90
  return Math.max(0, Math.round(p * 100) / 100);
};

/**
 * Toplu fiyat güncelleme. dryRun=true: yeni fiyatları ve zarar/düşük marj uyarılarını gösterir, kaydetmez.
 * Uygulanınca ortak satış fiyatı değişir ve tüm aktif ilanlara gönderilir (pazaryerine özel fiyat girilmiş ilanlar o fiyatı korur).
 */
export const POST = handle(async (req: Request) => {
  const b = await readJson<{ ids?: unknown[]; mode?: Mode; value?: unknown; round?: boolean; dryRun?: boolean }>(req);
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500);
  if (!ids.length) throw new HttpError(400, 'Ürün seçilmedi.');
  const mode: Mode = b.mode === 'add' || b.mode === 'set' ? b.mode : 'percent';
  const value = Number(String(b.value ?? '').replace(',', '.'));
  if (!Number.isFinite(value) || (mode === 'set' && value <= 0) || (mode === 'percent' && value <= -90)) throw new HttpError(400, 'Geçerli bir değer girin.');

  const current = new Map<string, { sku: string; price: number }>();
  for (let i = 0; i < ids.length; i += 100) {
    for (const p of must(await db().from('products').select('id, sku, price').in('id', ids.slice(i, i + 100))) as Array<{ id: string; sku: string; price: number }>) current.set(p.id, { sku: p.sku, price: Number(p.price) });
  }
  const plan = [...current.entries()].map(([id, p]) => ({ id, sku: p.sku, from: p.price, to: newPrice(p.price, mode, value, !!b.round) }));
  const warnings = await priceWarnings(plan.map((x) => x.id), (id, cur) => plan.find((x) => x.id === id)?.to ?? cur);
  if (b.dryRun) return { plan, warnings };

  for (const x of plan) {
    must(await db().from('products').update({ price: x.to, list_price: null }).eq('id', x.id).select('id'));
  }
  await log('info', 'system', null, `Toplu fiyat güncellemesi: ${plan.length} ürün (${mode === 'percent' ? `%${value}` : mode === 'add' ? `${value} ₺` : `${value} ₺ sabit`}).`);
  const sync = await pushStock(plan.map((x) => x.id), null);
  return { plan, warnings, sync };
});
