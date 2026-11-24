import { handle, HttpError, istanbulDate, readJson } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { EXPENSE_CATEGORIES, expenseShare, type ExpenseRow } from '@/lib/finance/expenses';

import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** İşletme giderleri: liste + seçili aralıktaki (varsayılan bu ay) kategori toplamları */
export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const today = istanbulDate();
  const from = sp.get('from') ?? `${today.slice(0, 7)}-01`;
  const to = sp.get('to') ?? today;
  const rows = must(await db().from('expenses').select('id, category, amount, expense_date, monthly, end_date, note, created_at').order('expense_date', { ascending: false }).limit(500)) as Array<ExpenseRow & { id: string; note: string }>;
  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const v = expenseShare(r, from, to);
    if (!v) continue;
    byCategory[r.category] = Math.round(((byCategory[r.category] ?? 0) + v) * 100) / 100;
    total += v;
  }
  return { range: { from, to }, rows, byCategory, total: Math.round(total * 100) / 100, categories: EXPENSE_CATEGORIES };
});

export const POST = handle(async (req: Request) => {
  const b = await readJson<{ category?: string; amount?: unknown; date?: string; monthly?: boolean; endDate?: string; note?: string }>(req);
  const amount = Number(String(b.amount ?? '').replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) throw new HttpError(400, 'Geçerli bir tutar girin.');
  const date = String(b.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Tarih seçin.');
  const end = b.endDate && /^\d{4}-\d{2}-\d{2}$/.test(b.endDate) ? b.endDate : null;
  const category = (EXPENSE_CATEGORIES as readonly string[]).includes(String(b.category)) ? String(b.category) : 'Diğer';
  await audit('Gider eklendi', `${category}: ${amount} ₺${b.monthly ? ' / ay' : ''}`);
  return must(await db().from('expenses').insert({ category, amount, expense_date: date, monthly: !!b.monthly, end_date: b.monthly ? end : null, note: String(b.note ?? '').slice(0, 200) }).select('id').single());
});

/** Aylık gideri bitir (bugünden itibaren durdur) veya kaydı sil */
export const DELETE = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const id = sp.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Geçersiz kayıt.');
  if (sp.get('stop') === '1') {
    must(await db().from('expenses').update({ end_date: istanbulDate() }).eq('id', id).eq('monthly', true).select('id'));
  } else {
    must(await db().from('expenses').delete().eq('id', id).select('id'));
  }
  return { ok: true };
});
