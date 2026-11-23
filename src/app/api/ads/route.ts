import { handle, HttpError, istanbulDate, readJson } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { isMarketplace, MARKETPLACE_META } from '@/lib/marketplaces/meta';
import { log } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';

interface Row { id: string; marketplace_name: string; spend_date: string; amount: number; note: string; created_at: string }

/** Reklam harcamaları (varsayılan: bu ay) ve pazaryeri bazında toplamlar */
export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const today = istanbulDate();
  const from = sp.get('from') ?? `${today.slice(0, 7)}-01`;
  const to = sp.get('to') ?? today;
  const rows = must(await db().from('ad_spend').select('id, marketplace_name, spend_date, amount, note, created_at')
    .gte('spend_date', from).lte('spend_date', to).order('spend_date', { ascending: false }).limit(500)) as Row[];
  const byMarketplace: Record<string, number> = {};
  for (const r of rows) byMarketplace[r.marketplace_name] = Math.round(((byMarketplace[r.marketplace_name] ?? 0) + Number(r.amount)) * 100) / 100;
  const total = Math.round(rows.reduce((s, r) => s + Number(r.amount), 0) * 100) / 100;
  return { range: { from, to }, rows, byMarketplace, total };
});

/** Reklam harcaması ekle (KDV dahil TL) */
export const POST = handle(async (req: Request) => {
  const b = await readJson<{ marketplace?: string; date?: string; amount?: unknown; note?: string }>(req);
  if (!isMarketplace(b.marketplace)) throw new HttpError(400, 'Pazaryeri seçin.');
  const date = String(b.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Tarih seçin.');
  const amount = Number(String(b.amount ?? '').replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) throw new HttpError(400, 'Geçerli bir tutar girin.');
  const row = must(await db().from('ad_spend').insert({ marketplace_name: b.marketplace, spend_date: date, amount, note: String(b.note ?? '').slice(0, 200) }).select('id').single());
  await log('info', 'system', b.marketplace, `${MARKETPLACE_META[b.marketplace].label} reklam harcaması eklendi: ${amount.toLocaleString('tr-TR')} ₺ (${date})`);
  return row;
});

export const DELETE = handle(async (req: Request) => {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Geçersiz kayıt.');
  must(await db().from('ad_spend').delete().eq('id', id).select('id'));
  return { ok: true };
});
