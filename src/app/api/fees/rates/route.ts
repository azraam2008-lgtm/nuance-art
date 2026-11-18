import { handle, HttpError, readJson } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { log } from '@/lib/sync/engine';
import { parseRateText } from '@/lib/fees/rates';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const table = sp.get('table');
  if (!table) throw new HttpError(400, 'table parametresi gerekli.');
  const rows = must(await db().from('carrier_rates').select('carrier, effective_from, prices, source').eq('rate_table', table).order('carrier').order('effective_from', { ascending: false }));
  return { rows };
});

export const PUT = handle(async (req: Request) => {
  const b = await readJson<{ table?: string; carrier?: string; effectiveFrom?: string; text?: string; source?: string }>(req);
  const table = (b.table ?? '').trim().toLowerCase();
  const carrier = (b.carrier ?? '').trim();
  if (!/^[a-z0-9_-]{2,32}$/.test(table)) throw new HttpError(400, 'Tablo adı geçersiz (ör. hepsiburada).');
  if (!carrier) throw new HttpError(400, 'Kargo firması gerekli.');
  if (!b.effectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(b.effectiveFrom)) throw new HttpError(400, 'Yürürlük tarihi YYYY-AA-GG olmalı.');
  let prices: number[];
  try { prices = parseRateText(b.text ?? ''); } catch (e) { throw new HttpError(400, (e as Error).message); }
  must(await db().from('carrier_rates').upsert({ rate_table: table, carrier, effective_from: b.effectiveFrom, prices, source: b.source ?? 'Elle girildi', updated_at: new Date().toISOString() },
    { onConflict: 'rate_table,carrier,effective_from' }));
  await log('info', 'system', null, `Kargo tarifesi kaydedildi: ${table} / ${carrier} (0–${prices.length - 1} desi, yürürlük ${b.effectiveFrom}).`);
  return { ok: true, maxDesi: prices.length - 1, sample: prices.slice(0, 6) };
});
