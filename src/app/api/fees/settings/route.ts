import { handle, HttpError, readJson } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { loadSettings, refreshFx } from '@/lib/fees/service';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  const s = await loadSettings();
  const fxRow = must(await db().from('app_settings').select('value').eq('key', 'fx').maybeSingle()) as { value: { updatedAt?: string; source?: string } } | null;
  return { settings: s, fxUpdatedAt: fxRow?.value.updatedAt ?? null, fxSource: fxRow?.value.source ?? 'varsayılan' };
});

export const PUT = handle(async (req: Request) => {
  const b = await readJson<{ adRate?: number; returnRiskRate?: number; stopajAsCost?: boolean; exportCostVatRecoverable?: boolean; fx?: Record<string, number> }>(req);
  const rate = (v: unknown, name: string) => {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n) || n < 0 || n > 1) throw new HttpError(400, `${name} 0–1 arasında olmalı (0.05 = %5).`);
    return n;
  };
  must(await db().from('app_settings').upsert({
    key: 'cost',
    value: { adRate: rate(b.adRate, 'Reklam oranı'), returnRiskRate: rate(b.returnRiskRate, 'İade riski'), stopajAsCost: b.stopajAsCost !== false, exportCostVatRecoverable: !!b.exportCostVatRecoverable },
    updated_at: new Date().toISOString(),
  }));
  if (b.fx && Object.keys(b.fx).length) {
    const rates = Object.fromEntries(Object.entries(b.fx).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k.toUpperCase(), Number(v)]));
    must(await db().from('app_settings').upsert({ key: 'fx', value: { rates, source: 'Elle girildi', updatedAt: new Date().toISOString() }, updated_at: new Date().toISOString() }));
  }
  return { ok: true };
});

// TCMB'den kurları hemen çek
export const POST = handle(async () => {
  const rates = await refreshFx();
  if (!rates) throw new HttpError(502, 'TCMB kurlarına ulaşılamadı; kurları elle girebilirsiniz.');
  return { rates };
});
