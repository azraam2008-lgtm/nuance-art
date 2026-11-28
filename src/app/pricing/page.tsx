'use client';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, Sparkles } from 'lucide-react';
import { BASE_MARKETPLACES, MARKETPLACE_META, type MarketplaceName } from '@/lib/marketplaces/meta';
import { CARRIERS_BY_MARKETPLACE } from '@/lib/fees/carriers';
import { api, useLiveData, useToast } from '@/components/live';
import { Button, Card, Field, MarketplaceBadge, cx, inputClass, tl2 } from '@/components/ui';

interface Line { code: string; label: string; group: string; gross: number; vat: number; cost: number; note?: string }
interface CostResult { netProfit: number; revenueGross: number; revenueNet: number; totals: Record<string, number>; lines: Line[]; marginOnRevenue: number; marginOnCost: number; notes: string[] }
interface Advice {
  price: number; charm: number; result: CostResult; charmResult: CostResult; targetProfit: number;
  ladder: Array<{ price: number; netProfit: number; shipping: number; meetsTarget: boolean }>;
  sets: Array<{ quantity: number; price: number | null; unitPrice: number | null; netProfit: number | null; shippingShare: number | null }>;
  messages: Array<{ kind: 'success' | 'warning' | 'info'; text: string }>;
}
interface Result { marketplace: MarketplaceName; verified: boolean; ruleDate: string; inputs: { carrier: string; sameDayTag: boolean; fastTag: boolean; handlingDays: number; commissionRate: number }; advice: Advice | null }
interface Override { commissionRate: string; carrier: string; sameDayTag: boolean; fastTag: boolean; handlingDays: string; manualShippingNet: string }

const EMPTY_OVR: Override = { commissionRate: '', carrier: '', sameDayTag: false, fastTag: false, handlingDays: '', manualShippingNet: '' };

/** Kullanıcının "Gelişmiş Fiyat Modeli" Excel'inin 8 pazaryerli, otomatik kurallı hali */
export default function PricingPage() {
  const toast = useToast();
  const { data: productData } = useLiveData<{ products: Array<{ id: string; sku: string; title: string; cost_price: number; cost_vat_rate: number | null; vat_rate: number; desi: number; packaging_cost: number; listings: Array<{ marketplace_name: string; commission_rate: number | null; carrier: string | null; same_day_tag: boolean; fast_tag: boolean; handling_days: number; manual_shipping_cost: number | null }> }> }>('/api/products');
  const [productId, setProductId] = useState('');
  const [f, setF] = useState({ unitCostNet: '14', costVatRate: '10', vatRate: '10', desi: '1', packagingNet: '0', targetType: 'margin_on_cost', targetValue: '70', adRate: '0', returnRiskRate: '0' });
  const [mps, setMps] = useState<MarketplaceName[]>([...BASE_MARKETPLACES]);
  const [ovr, setOvr] = useState<Record<string, Override>>(() => Object.fromEntries(BASE_MARKETPLACES.map((m) => [m, { ...EMPTY_OVR, carrier: m === 'trendyol' ? 'TEX' : '', sameDayTag: m === 'trendyol', handlingDays: m === 'trendyol' ? '0' : '' }])));
  const [showOvr, setShowOvr] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [selected, setSelected] = useState<MarketplaceName | null>(null);
  const [busy, setBusy] = useState(false);

  const product = useMemo(() => productData?.products.find((p) => p.id === productId), [productData, productId]);
  useEffect(() => {
    if (!product) return;
    setF((x) => ({ ...x, unitCostNet: String(product.cost_price), costVatRate: String(product.cost_vat_rate ?? product.vat_rate), vatRate: String(product.vat_rate), desi: String(product.desi), packagingNet: String(product.packaging_cost) }));
    setOvr(Object.fromEntries(BASE_MARKETPLACES.map((m) => {
      const l = product.listings.find((x) => x.marketplace_name === m);
      return [m, { commissionRate: l?.commission_rate != null ? String(l.commission_rate) : '', carrier: l?.carrier ?? '', sameDayTag: !!l?.same_day_tag, fastTag: !!l?.fast_tag, handlingDays: l ? String(l.handling_days) : '', manualShippingNet: l?.manual_shipping_cost != null ? String(l.manual_shipping_cost) : '' }];
    })));
  }, [product]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setO = (m: string, k: keyof Override, v: string | boolean) => setOvr((o) => ({ ...o, [m]: { ...o[m], [k]: v } }));

  async function calc() {
    setBusy(true);
    try {
      const r = await api<{ results: Result[] }>('/api/fees/price', {
        method: 'POST',
        body: {
          marketplaces: mps,
          unitCostNet: Number(f.unitCostNet), costVatRate: Number(f.costVatRate), vatRate: Number(f.vatRate), desi: Number(f.desi), packagingNet: Number(f.packagingNet),
          targetType: f.targetType, targetValue: Number(f.targetValue), adRate: Number(f.adRate), returnRiskRate: Number(f.returnRiskRate),
          overrides: Object.fromEntries(mps.map((m) => {
            const o = ovr[m];
            return [m, {
              commissionRate: o.commissionRate === '' ? null : Number(o.commissionRate), carrier: o.carrier || null, sameDayTag: o.sameDayTag, fastTag: o.fastTag,
              handlingDays: o.handlingDays === '' ? undefined : Number(o.handlingDays), manualShippingNet: o.manualShippingNet === '' ? null : Number(o.manualShippingNet),
            }];
          })),
        },
      });
      setResults(r.results);
      setSelected((s) => s ?? r.results[0]?.marketplace ?? null);
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { calc(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = results?.find((r) => r.marketplace === selected);
  const targetLabel = f.targetType === 'profit' ? 'Hedef net kâr (₺/adet)' : f.targetType === 'margin_on_cost' ? 'Hedef kâr (maliyet üzerinden %)' : 'Hedef marj (KDV hariç ciro %)';

  return (
    <div className="space-y-6 fade-in">
      <Card className="p-5 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="col-span-2">
            <Field label="Ürün (isteğe bağlı — maliyet ve ayarları doldurur)">
              <select className={inputClass} value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Elle gir</option>
                {productData?.products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.title}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Birim maliyet (KDV hariç ₺)"><input className={inputClass} type="number" step="0.01" value={f.unitCostNet} onChange={set('unitCostNet')} /></Field>
          <Field label="Ürün KDV oranı (%)"><input className={inputClass} type="number" value={f.vatRate} onChange={(e) => setF((x) => ({ ...x, vatRate: e.target.value, costVatRate: x.costVatRate === x.vatRate ? e.target.value : x.costVatRate }))} /></Field>
          <Field label="Maliyet KDV (%)"><input className={inputClass} type="number" value={f.costVatRate} onChange={set('costVatRate')} /></Field>
          <Field label="Desi"><input className={inputClass} type="number" step="0.5" value={f.desi} onChange={set('desi')} /></Field>
          <Field label="Ambalaj (KDV hariç ₺)"><input className={inputClass} type="number" step="0.01" value={f.packagingNet} onChange={set('packagingNet')} /></Field>
          <Field label="Hedef türü">
            <select className={inputClass} value={f.targetType} onChange={set('targetType')}>
              <option value="margin_on_cost">Maliyet üzerinden % (Excel modeli)</option>
              <option value="margin_on_revenue">Ciro üzerinden marj %</option>
              <option value="profit">Sabit net kâr ₺</option>
            </select>
          </Field>
          <Field label={targetLabel}><input className={inputClass} type="number" step="0.1" value={f.targetValue} onChange={set('targetValue')} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Reklam %"><input className={inputClass} type="number" step="0.1" value={f.adRate} onChange={set('adRate')} /></Field>
            <Field label="İade riski %"><input className={inputClass} type="number" step="0.1" value={f.returnRiskRate} onChange={set('returnRiskRate')} /></Field>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {BASE_MARKETPLACES.map((m) => (
            <label key={m} className={cx('flex items-center gap-1.5 border rounded-lg px-2 py-1 cursor-pointer text-xs', mps.includes(m) ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200')}>
              <input type="checkbox" className="accent-indigo-600" checked={mps.includes(m)} onChange={(e) => setMps((s) => (e.target.checked ? [...s, m] : s.filter((x) => x !== m)))} />
              <MarketplaceBadge name={m} size="xs" />
            </label>
          ))}
          <button className="text-xs text-indigo-600 ml-2" onClick={() => setShowOvr((v) => !v)}>{showOvr ? '− ' : '+ '}Pazaryeri ayarları (komisyon, Bugün Kargoda, termin, kargo)</button>
          <span className="flex-1" />
          <Button onClick={calc} loading={busy}><Sparkles className="w-4 h-4" /> Fiyatları Hesapla</Button>
        </div>
        {showOvr && (
          <div className="overflow-x-auto border-t border-slate-100 pt-3">
            <table className="w-full text-xs">
              <thead className="text-slate-500"><tr><th className="text-left py-1">Pazaryeri</th><th className="text-left px-1">Komisyon %</th><th className="text-left px-1">Termin</th><th className="px-1">Bugün Kargoda</th><th className="px-1">Hızlı Teslimat</th><th className="text-left px-1">Kargo firması</th><th className="text-left px-1">Elle kargo ₺</th></tr></thead>
              <tbody>
                {mps.map((m) => (
                  <tr key={m}>
                    <td className="py-1"><MarketplaceBadge name={m} size="xs" /></td>
                    <td className="px-1"><input className={`${inputClass} w-20 py-1`} placeholder="varsayılan" value={ovr[m].commissionRate} onChange={(e) => setO(m, 'commissionRate', e.target.value)} /></td>
                    <td className="px-1"><input className={`${inputClass} w-16 py-1`} placeholder="1" value={ovr[m].handlingDays} onChange={(e) => setO(m, 'handlingDays', e.target.value)} /></td>
                    <td className="px-1 text-center"><input type="checkbox" className="accent-indigo-600" checked={ovr[m].sameDayTag} onChange={(e) => setO(m, 'sameDayTag', e.target.checked)} /></td>
                    <td className="px-1 text-center"><input type="checkbox" className="accent-indigo-600" checked={ovr[m].fastTag} onChange={(e) => setO(m, 'fastTag', e.target.checked)} /></td>
                    <td className="px-1"><select className={`${inputClass} py-1`} value={ovr[m].carrier} onChange={(e) => setO(m, 'carrier', e.target.value)}><option value="">Varsayılan</option>{(CARRIERS_BY_MARKETPLACE[m] ?? []).map((c) => <option key={c}>{c}</option>)}</select></td>
                    <td className="px-1"><input className={`${inputClass} w-24 py-1`} value={ovr[m].manualShippingNet} onChange={(e) => setO(m, 'manualShippingNet', e.target.value)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!results ? <div className="flex justify-center py-16 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div> : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Pazaryeri</th>
                <th className="text-right px-4 py-3">Önerilen Fiyat</th>
                <th className="text-right px-4 py-3">Vitrin Fiyatı</th>
                <th className="text-right px-4 py-3">Net Kâr (vitrin)</th>
                <th className="text-right px-4 py-3">Komisyon</th>
                <th className="text-right px-4 py-3">Bedeller</th>
                <th className="text-right px-4 py-3">Kargo</th>
                <th className="text-right px-4 py-3">Stopaj</th>
                <th className="text-right px-4 py-3">Marj</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {results.map((r) => {
                const a = r.advice;
                const c = a?.charmResult;
                return (
                  <tr key={r.marketplace} onClick={() => setSelected(r.marketplace)} className={cx('cursor-pointer hover:bg-slate-50', selected === r.marketplace && 'bg-indigo-50/60')}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2"><MarketplaceBadge name={r.marketplace} />{!r.verified && <span title="Kural ikincil kaynaklardan; satıcı panelinden doğrulayın" className="text-[10px] text-amber-700 bg-amber-50 rounded px-1">doğrulanmadı</span>}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">%{r.inputs.commissionRate.toFixed(1)} kom. · {r.inputs.carrier}{r.inputs.sameDayTag ? ' · Bugün Kargoda' : ''}{r.inputs.handlingDays <= 1 ? ` · ${r.inputs.handlingDays} gün termin` : ''}</div>
                    </td>
                    {!a || !c ? <td colSpan={8} className="px-4 py-3 text-rose-600 text-xs">Bu hedefe ulaşan fiyat bulunamadı.</td> : (
                      <>
                        <td className="px-4 py-3 text-right tabular-nums">{tl2(a.price)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-bold">{tl2(a.charm)}</td>
                        <td className={cx('px-4 py-3 text-right tabular-nums font-semibold', c.netProfit < 0 ? 'text-rose-600' : 'text-emerald-700')}>{tl2(c.netProfit)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{tl2(c.totals.commission)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{tl2(c.totals.fee)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{tl2(c.totals.shipping)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{tl2(c.totals.tax)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">%{(c.marginOnRevenue * 100).toFixed(1)}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-100">Tutarlar kâra etkisidir (indirilebilir KDV hariç). Önerilen fiyat hedefi tutturan en düşük KDV dahil satış fiyatıdır; vitrin fiyatı x,90'a yuvarlanır.</div>
        </Card>
      )}

      {sel?.advice && <Detail r={sel} />}
    </div>
  );
}

function Detail({ r }: { r: Result }) {
  const a = r.advice!;
  const icon = { success: <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />, warning: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />, info: <Info className="w-4 h-4 text-slate-400 shrink-0" /> };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="p-5 lg:col-span-2">
        <h3 className="font-semibold mb-3 flex items-center gap-2"><MarketplaceBadge name={r.marketplace} /> {MARKETPLACE_META[r.marketplace].label} — {tl2(a.charm)} fiyatında döküm</h3>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            <tr><td className="py-1.5">Satış fiyatı (KDV dahil)</td><td className="text-right tabular-nums">{tl2(a.charmResult.revenueGross)}</td></tr>
            <tr><td className="py-1.5">Satış KDV'si</td><td className="text-right tabular-nums text-slate-500">−{tl2(a.charmResult.revenueGross - a.charmResult.revenueNet)}</td></tr>
            {a.charmResult.lines.map((l, i) => (
              <tr key={i}><td className="py-1.5">{l.label}{l.note && <div className="text-[11px] text-slate-500">{l.note}</div>}</td><td className="text-right tabular-nums text-rose-700">−{tl2(l.cost)}</td></tr>
            ))}
            <tr className="font-semibold"><td className="py-2">Net kâr</td><td className={cx('text-right tabular-nums', a.charmResult.netProfit < 0 ? 'text-rose-600' : 'text-emerald-700')}>{tl2(a.charmResult.netProfit)}</td></tr>
          </tbody>
        </table>
        <div className="text-xs text-slate-500 mt-2">Hedef net kâr: {tl2(a.targetProfit)} · Maliyet üzerinden kâr: %{(a.charmResult.marginOnCost * 100).toFixed(1)}</div>
      </Card>
      <div className="space-y-4">
        <Card className="p-5">
          <h3 className="font-semibold mb-2">Akıllı Barem Asistanı</h3>
          {a.ladder.length === 0 ? <p className="text-xs text-slate-500">Bu pazaryerinde fiyat kademesi yok.</p> : (
            <table className="w-full text-xs mb-2">
              <thead className="text-slate-500"><tr><th className="text-left">Fiyat</th><th className="text-right">Kargo</th><th className="text-right">Net kâr</th></tr></thead>
              <tbody>{a.ladder.map((l) => <tr key={l.price}><td className="py-1">{tl2(l.price)}</td><td className="text-right">{tl2(l.shipping)}</td><td className={cx('text-right font-medium', l.meetsTarget ? 'text-emerald-700' : 'text-slate-500')}>{tl2(l.netProfit)}</td></tr>)}</tbody>
            </table>
          )}
          <ul className="space-y-1.5 text-xs">{a.messages.map((m, i) => <li key={i} className="flex gap-1.5">{icon[m.kind]}<span>{m.text}</span></li>)}</ul>
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold mb-2">Çoklu Satış (Set) Analizi</h3>
          <table className="w-full text-xs">
            <thead className="text-slate-500"><tr><th className="text-left">Set</th><th className="text-right">Fiyat</th><th className="text-right">Birim</th><th className="text-right">Net kâr</th><th className="text-right">Kargo yükü</th></tr></thead>
            <tbody>{a.sets.map((s) => (
              <tr key={s.quantity}><td className="py-1">{s.quantity}'li</td><td className="text-right">{s.price != null ? tl2(s.price) : '—'}</td><td className="text-right">{s.unitPrice != null ? tl2(s.unitPrice) : '—'}</td>
                <td className="text-right text-emerald-700">{s.netProfit != null ? tl2(s.netProfit) : '—'}</td><td className={cx('text-right', (s.shippingShare ?? 0) > 0.4 && 'text-rose-600 font-medium')}>{s.shippingShare != null ? `%${Math.round(s.shippingShare * 100)}` : '—'}</td></tr>
            ))}</tbody>
          </table>
          <p className="text-[11px] text-slate-500 mt-2">Set desisi tekli paketle aynı varsayıldı.</p>
        </Card>
      </div>
    </div>
  );
}
