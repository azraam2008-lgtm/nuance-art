import { handle, HttpError, readJson } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { isMarketplace } from '@/lib/marketplaces/meta';
import { CARRIERS_BY_MARKETPLACE, defaultRule } from '@/lib/fees/defaults';
import { loadRates, loadRules } from '@/lib/fees/service';
import type { FeeRuleConfig } from '@/lib/fees/types';
import { log } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';

// Tüm pazaryeri kuralları (tarihçe dahil) + kargo tablosu özetleri
export const GET = handle(async () => {
  const [rules, rates] = await Promise.all([loadRules(), loadRates()]);
  const tables: Record<string, Array<{ carrier: string; effectiveFrom: string; maxDesi: number; sample: number[] }>> = {};
  for (const r of rates) {
    (tables[r.rate_table] ??= []).push({ carrier: r.carrier, effectiveFrom: r.effective_from, maxDesi: r.prices.length - 1, sample: r.prices.slice(0, 6) });
  }
  return { rules, tables, carriers: CARRIERS_BY_MARKETPLACE };
});

function validate(c: FeeRuleConfig) {
  if (!c || typeof c !== 'object') throw new HttpError(400, 'Kural yapılandırması geçersiz.');
  if (!c.commission || typeof c.commission.defaultRate !== 'number' || c.commission.defaultRate < 0 || c.commission.defaultRate > 1) {
    throw new HttpError(400, 'commission.defaultRate 0–1 arasında olmalı (0.2 = %20).');
  }
  if (!['gross', 'net', 'gross_plus_shipping', 'net_plus_shipping'].includes(c.commission.basis)) throw new HttpError(400, 'commission.basis geçersiz.');
  if (!['included', 'added', 'none'].includes(c.commission.vat)) throw new HttpError(400, 'commission.vat geçersiz.');
  if (!c.stopaj || typeof c.stopaj.rate !== 'number') throw new HttpError(400, 'stopaj.rate gerekli.');
  if (!Array.isArray(c.fees)) throw new HttpError(400, 'fees bir dizi olmalı.');
  for (const f of c.fees) {
    if (!f.code || !f.label || !['fixed', 'percent'].includes(f.kind)) throw new HttpError(400, `Bedel tanımı geçersiz: ${f.code ?? '?'}`);
  }
  if (!c.shipping || !['seller', 'buyer'].includes(c.shipping.payer) || !c.shipping.defaultCarrier) throw new HttpError(400, 'shipping.payer ve defaultCarrier gerekli.');
  for (const t of c.shipping.barem?.tiers ?? []) if (typeof t.upTo !== 'number') throw new HttpError(400, 'Barem kademelerinde upTo sayısal olmalı.');
}

// Kural ekle/güncelle (aynı yürürlük tarihi varsa üzerine yazar; yeni tarih = yeni tarife)
export const PUT = handle(async (req: Request) => {
  const b = await readJson<{ marketplace?: string; effectiveFrom?: string; config?: FeeRuleConfig; verified?: boolean; notes?: string[] }>(req);
  if (!isMarketplace(b.marketplace)) throw new HttpError(400, 'Geçersiz pazaryeri.');
  if (!b.effectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(b.effectiveFrom)) throw new HttpError(400, 'Yürürlük tarihi YYYY-AA-GG olmalı.');
  validate(b.config as FeeRuleConfig);
  const existing = must(await db().from('fee_rules').select('sources').eq('marketplace_name', b.marketplace).eq('effective_from', b.effectiveFrom).maybeSingle()) as { sources: unknown } | null;
  must(await db().from('fee_rules').upsert({
    marketplace_name: b.marketplace, effective_from: b.effectiveFrom, config: b.config, verified: !!b.verified,
    notes: b.notes ?? [], sources: existing?.sources ?? [{ kind: 'user_file', title: 'Kullanıcı tarafından düzenlendi', date: new Date().toISOString().slice(0, 10) }],
    updated_at: new Date().toISOString(),
  }, { onConflict: 'marketplace_name,effective_from' }));
  await log('info', 'system', b.marketplace, `Maliyet kuralı güncellendi (yürürlük ${b.effectiveFrom}). Siparişleri yeniden hesaplamayı unutmayın.`);
  return { ok: true };
});

// Varsayılana dön
export const POST = handle(async (req: Request) => {
  const b = await readJson<{ marketplace?: string; action?: string }>(req);
  if (b.action !== 'reset' || !isMarketplace(b.marketplace)) throw new HttpError(400, 'Geçersiz istek.');
  const d = defaultRule(b.marketplace);
  if (!d) throw new HttpError(404, 'Varsayılan kural yok.');
  must(await db().from('fee_rules').upsert({
    marketplace_name: d.marketplace, effective_from: d.effectiveFrom, config: d.config, verified: d.verified, notes: d.notes, sources: d.sources, updated_at: new Date().toISOString(),
  }, { onConflict: 'marketplace_name,effective_from' }));
  return { ok: true };
});
