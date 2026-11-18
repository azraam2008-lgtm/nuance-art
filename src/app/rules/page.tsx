'use client';
import { useEffect, useState } from 'react';
import { BadgeCheck, ExternalLink, FileWarning, RefreshCw, RotateCcw, Save, Upload } from 'lucide-react';
import { MARKETPLACES, MARKETPLACE_META, type MarketplaceName } from '@/lib/marketplaces/meta';
import type { FeeRule, FeeRuleConfig } from '@/lib/fees/types';
import { api, useLive, useLiveData, useToast } from '@/components/live';
import { Button, Card, ErrorBox, Field, MarketplaceBadge, PageLoader, cx, inputClass } from '@/components/ui';

interface RulesResp { rules: FeeRule[]; tables: Record<string, Array<{ carrier: string; effectiveFrom: string; maxDesi: number; sample: number[] }>>; carriers: Record<string, string[]> }

const TABS = [['rules', 'Pazaryeri Kuralları'], ['rates', 'Kargo Tarifeleri'], ['general', 'Genel Ayarlar & Kur']] as const;

export default function RulesPage() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('rules');
  const { data, error, loading, reload } = useLiveData<RulesResp>('/api/fees/rules');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { bump } = useLive();

  async function recompute() {
    setBusy(true);
    try {
      const r = await api<{ count: number }>('/api/fees/recompute', { method: 'POST', body: {} });
      toast(`${r.count} siparişin kârlılığı yeniden hesaplandı.`);
      bump();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5 fade-in">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex bg-white border border-slate-200 rounded-lg p-0.5 text-sm">
          {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={cx('px-3 py-1.5 rounded-md', tab === k && 'bg-indigo-600 text-white')}>{l}</button>)}
        </div>
        <span className="flex-1" />
        <Button variant="secondary" loading={busy} onClick={recompute}><RefreshCw className="w-4 h-4" /> Tüm siparişleri yeniden hesapla</Button>
      </div>
      <div className="text-xs bg-indigo-50 border border-indigo-100 text-indigo-900 rounded-lg p-3">
        Kurallar her siparişte otomatik uygulanır: sipariş geldiğinde tahmini kâr, kargoya verildiğinde (Bugün Kargoda / termin kontrolüyle) kesin kâr hesaplanır.
        Bir pazaryeri tarifesini değiştirdiğinde <b>yeni yürürlük tarihiyle</b> kaydedin; eski siparişler kendi tarihindeki kuralla hesaplanmaya devam eder.
      </div>
      {loading ? <PageLoader /> : error || !data ? <ErrorBox error={error ?? ''} onRetry={reload} /> : (
        tab === 'rules' ? <RulesTab data={data} /> : tab === 'rates' ? <RatesTab data={data} /> : <GeneralTab />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Kurallar
function RulesTab({ data }: { data: RulesResp }) {
  const [mp, setMp] = useState<MarketplaceName>('trendyol');
  const history = data.rules.filter((r) => r.marketplace === mp).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  const current = history[0];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <Card className="p-2 h-fit">
        {MARKETPLACES.map((m) => {
          const r = data.rules.filter((x) => x.marketplace === m).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
          return (
            <button key={m} onClick={() => setMp(m)} className={cx('w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm', mp === m ? 'bg-slate-100' : 'hover:bg-slate-50')}>
              <MarketplaceBadge name={m} />
              <span className="flex-1" />
              {r?.verified ? <BadgeCheck className="w-4 h-4 text-emerald-600" aria-label="Doğrulandı" /> : <FileWarning className="w-4 h-4 text-amber-500" aria-label="Doğrulanmadı" />}
            </button>
          );
        })}
      </Card>
      <div className="lg:col-span-3">{current ? <RuleEditor key={`${mp}-${current.effectiveFrom}`} rule={current} history={history} carriers={data.carriers[mp] ?? []} /> : <Card className="p-6 text-sm">Kural yok.</Card>}</div>
    </div>
  );
}

function RuleEditor({ rule, history, carriers }: { rule: FeeRule; history: FeeRule[]; carriers: string[] }) {
  const toast = useToast();
  const { bump } = useLive();
  const [cfg, setCfg] = useState<FeeRuleConfig>(structuredClone(rule.config));
  const [date, setDate] = useState(rule.effectiveFrom);
  const [verified, setVerified] = useState(rule.verified);
  const [json, setJson] = useState('');
  const [showJson, setShowJson] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setJson(JSON.stringify(cfg, null, 2)); }, [cfg]);

  const upd = (fn: (c: FeeRuleConfig) => void) => setCfg((c) => { const n = structuredClone(c); fn(n); return n; });
  const pct = (v: number) => Math.round(v * 10000) / 100;

  async function save() {
    let config = cfg;
    if (showJson) {
      try { config = JSON.parse(json); } catch { toast('JSON geçersiz.', 'err'); return; }
    }
    setBusy(true);
    try {
      await api('/api/fees/rules', { method: 'PUT', body: { marketplace: rule.marketplace, effectiveFrom: date, config, verified, notes: rule.notes } });
      toast(`Kural kaydedildi (yürürlük ${date}). Etkilenen siparişler için "Tüm siparişleri yeniden hesapla"yı çalıştırın.`);
      bump();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  async function reset() {
    if (!window.confirm('Bu pazaryeri kuralı sistemdeki varsayılana döndürülsün mü?')) return;
    try { await api('/api/fees/rules', { method: 'POST', body: { marketplace: rule.marketplace, action: 'reset' } }); toast('Varsayılana döndürüldü.'); bump(); } catch (e) { toast((e as Error).message, 'err'); }
  }

  const tiers = cfg.shipping.barem?.tiers ?? [];
  const tierCarriers = [...new Set(tiers.flatMap((t) => [...Object.keys(t.fast ?? {}), ...Object.keys(t.standard ?? {})]))];

  return (
    <Card className="p-5 space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <MarketplaceBadge name={rule.marketplace} />
        <h3 className="font-semibold">{MARKETPLACE_META[rule.marketplace as MarketplaceName]?.label} maliyet kuralı</h3>
        <span className={cx('text-xs rounded-full px-2 py-0.5', rule.verified ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{rule.verified ? 'Resmi/kullanıcı belgesiyle doğrulandı' : 'İkincil kaynak — panelden doğrulayın'}</span>
        {history.length > 1 && <span className="text-xs text-slate-500">Tarihçe: {history.map((h) => h.effectiveFrom).join(' · ')}</span>}
      </div>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Varsayılan komisyon %"><input className={inputClass} type="number" step="0.1" value={pct(cfg.commission.defaultRate)} onChange={(e) => upd((c) => { c.commission.defaultRate = Number(e.target.value) / 100; })} /></Field>
        <Field label="Komisyon matrahı">
          <select className={inputClass} value={cfg.commission.basis} onChange={(e) => upd((c) => { c.commission.basis = e.target.value as FeeRuleConfig['commission']['basis']; })}>
            <option value="gross">KDV dahil satış</option><option value="net">KDV hariç satış</option><option value="gross_plus_shipping">KDV dahil satış + kargo</option><option value="net_plus_shipping">KDV hariç satış + kargo</option>
          </select>
        </Field>
        <Field label="Komisyon KDV'si">
          <select className={inputClass} value={cfg.commission.vat} onChange={(e) => upd((c) => { c.commission.vat = e.target.value as FeeRuleConfig['commission']['vat']; })}>
            <option value="included">Oran KDV dahil</option><option value="added">+%20 KDV eklenir</option><option value="none">KDV yok</option>
          </select>
        </Field>
        <Field label="E-ticaret stopajı %"><input className={inputClass} type="number" step="0.1" value={pct(cfg.stopaj.rate)} onChange={(e) => upd((c) => { c.stopaj.rate = Number(e.target.value) / 100; })} /></Field>
        <Field label="Komisyon indirimi %" hint="Yeni mağaza / kampanya (ör. 50)">
          <input className={inputClass} type="number" step="1" value={cfg.commission.discount ? pct(cfg.commission.discount.rate) : ''} placeholder="yok"
            onChange={(e) => upd((c) => { c.commission.discount = e.target.value === '' ? null : { rate: Number(e.target.value) / 100, label: c.commission.discount?.label ?? `%${e.target.value} komisyon indirimi`, until: c.commission.discount?.until }; })} />
        </Field>
        <Field label="İndirim bitiş tarihi">
          <input className={inputClass} type="date" disabled={!cfg.commission.discount} value={cfg.commission.discount?.until ?? ''} onChange={(e) => upd((c) => { if (c.commission.discount) c.commission.discount.until = e.target.value || undefined; })} />
        </Field>
        <Field label="Varsayılan kargo firması">
          <select className={inputClass} value={cfg.shipping.defaultCarrier} onChange={(e) => upd((c) => { c.shipping.defaultCarrier = e.target.value; })}>
            {[...new Set([cfg.shipping.defaultCarrier, ...carriers])].map((x) => <option key={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Tarife yoksa paket başı kargo ₺" hint="KDV hariç">
          <input className={inputClass} type="number" step="0.01" value={cfg.shipping.fallbackFlat ?? ''} placeholder="yok" onChange={(e) => upd((c) => { c.shipping.fallbackFlat = e.target.value === '' ? undefined : Number(e.target.value); })} />
        </Field>
        {cfg.sameDay && (
          <Field label="Bugün Kargoda kesim saati"><input className={inputClass} type="number" min={0} max={23} value={cfg.sameDay.cutoffHour} onChange={(e) => upd((c) => { c.sameDay = { cutoffHour: Number(e.target.value) }; })} /></Field>
        )}
      </section>

      <section>
        <h4 className="text-sm font-semibold mb-2">Platform / hizmet bedelleri</h4>
        {!cfg.fees.length && <p className="text-xs text-slate-500">Bu pazaryerinde sabit/yüzdesel ek bedel tanımlı değil.</p>}
        <div className="space-y-2">
          {cfg.fees.map((f, i) => (
            <div key={f.code} className={cx('grid grid-cols-12 gap-2 items-center text-xs border rounded-lg p-2', f.disabled ? 'border-slate-200 opacity-60' : 'border-slate-200')}>
              <label className="col-span-4 flex items-center gap-2"><input type="checkbox" className="accent-indigo-600" checked={!f.disabled} onChange={(e) => upd((c) => { c.fees[i].disabled = !e.target.checked; })} /><span className="font-medium">{f.label}</span></label>
              <div className="col-span-2">
                {f.kind === 'fixed'
                  ? <input className={`${inputClass} py-1`} type="number" step="0.01" value={f.amount ?? 0} onChange={(e) => upd((c) => { c.fees[i].amount = Number(e.target.value); })} title={`Tutar (${f.currency ?? 'TRY'})`} />
                  : <input className={`${inputClass} py-1`} type="number" step="0.01" value={pct(f.rate ?? 0)} onChange={(e) => upd((c) => { c.fees[i].rate = Number(e.target.value) / 100; })} title="Oran %" />}
              </div>
              <div className="col-span-2 text-slate-500">{f.kind === 'fixed' ? `${f.currency ?? 'TRY'} · ${f.per === 'package' ? 'paket' : f.per === 'order' ? 'sipariş' : f.per === 'unit' ? 'adet' : 'ay/SKU'}` : '%'} · {f.vat === 'added' ? '+KDV' : f.vat === 'included' ? 'KDV dahil' : 'KDV yok'}</div>
              {f.alt ? (
                <div className="col-span-4 flex items-center gap-1">
                  <span className="text-slate-500 truncate" title={f.alt.label}>Aynı gün:</span>
                  <input className={`${inputClass} py-1 w-24`} type="number" step="0.01" value={f.alt.amount} onChange={(e) => upd((c) => { c.fees[i].alt!.amount = Number(e.target.value); })} />
                </div>
              ) : <div className="col-span-4 text-slate-500 truncate" title={f.note}>{f.note}</div>}
            </div>
          ))}
        </div>
      </section>

      {cfg.shipping.barem && (
        <section>
          <h4 className="text-sm font-semibold mb-2">Barem altı kargo fiyatları (KDV hariç)</h4>
          <div className="flex flex-wrap gap-3 text-xs mb-2">
            <label className="flex items-center gap-1">Barem desi sınırı <input className={`${inputClass} py-1 w-16`} type="number" value={cfg.shipping.barem.maxDesi ?? ''} placeholder="yok" onChange={(e) => upd((c) => { c.shipping.barem!.maxDesi = e.target.value === '' ? undefined : Number(e.target.value); })} /></label>
            <label className="flex items-center gap-1"><input type="checkbox" className="accent-indigo-600" checked={!!cfg.shipping.barem.requiresFast} onChange={(e) => upd((c) => { c.shipping.barem!.requiresFast = e.target.checked; })} /> Hızlı gönderim (0–1 gün) şart</label>
            <label className="flex items-center gap-1"><input type="checkbox" className="accent-indigo-600" checked={cfg.shipping.barem.splitPolicy === 'cheapest_one'} onChange={(e) => upd((c) => { c.shipping.barem!.splitPolicy = e.target.checked ? 'cheapest_one' : 'all'; })} /> Paket bölmede yalnızca en düşük desili paket</label>
          </div>
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead className="text-slate-500"><tr><th className="text-left py-1">Firma</th>{tiers.map((t, i) => <th key={i} colSpan={2} className="px-1">Sipariş &lt; <input className={`${inputClass} py-0.5 w-20 inline`} type="number" value={t.upTo} onChange={(e) => upd((c) => { c.shipping.barem!.tiers[i].upTo = Number(e.target.value); })} /> ₺</th>)}</tr>
                <tr><th />{tiers.flatMap((_, i) => [<th key={`f${i}`} className="px-1 font-normal">Hızlı</th>, <th key={`s${i}`} className="px-1 font-normal">Standart</th>])}</tr></thead>
              <tbody>
                {tierCarriers.map((car) => (
                  <tr key={car}>
                    <td className="py-1 pr-2 font-medium">{car}</td>
                    {tiers.map((t, i) => (['fast', 'standard'] as const).map((kind) => (
                      <td key={`${i}${kind}`} className="px-1">
                        <input className={`${inputClass} py-0.5 w-20`} type="number" step="0.01" placeholder="—" value={t[kind]?.[car] ?? ''}
                          onChange={(e) => upd((c) => {
                            const tier = c.shipping.barem!.tiers[i];
                            const m = { ...(tier[kind] ?? {}) };
                            if (e.target.value === '') delete m[car]; else m[car] = Number(e.target.value);
                            tier[kind] = m;
                          })} />
                      </td>
                    )))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <div>
          <h4 className="text-sm font-semibold mb-1">Notlar</h4>
          <ul className="list-disc pl-4 space-y-1 text-slate-600">{rule.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-1">Kaynaklar</h4>
          <ul className="space-y-1">
            {rule.sources.map((s, i) => (
              <li key={i} className="flex gap-1.5">
                <span className={cx('shrink-0 rounded px-1', s.kind === 'official' ? 'bg-emerald-50 text-emerald-700' : s.kind === 'user_file' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600')}>{s.kind === 'official' ? 'resmi' : s.kind === 'user_file' ? 'sizin belgeniz' : 'ikincil'}</span>
                {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{s.title} <ExternalLink className="inline w-3 h-3" /></a> : <span>{s.title}</span>}
                {s.date && <span className="text-slate-400">({s.date})</span>}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div>
        <button className="text-xs text-indigo-600" onClick={() => setShowJson((v) => !v)}>{showJson ? '− ' : '+ '}Gelişmiş: tüm kuralı JSON olarak düzenle</button>
        {showJson && <textarea className={`${inputClass} font-mono text-[11px] mt-2`} rows={18} value={json} onChange={(e) => setJson(e.target.value)} />}
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
        <Field label="Yürürlük tarihi" hint="Yeni tarih = yeni tarife sürümü"><input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" className="accent-emerald-600" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> Satıcı panelimden doğruladım</label>
        <span className="flex-1" />
        <Button variant="ghost" onClick={reset}><RotateCcw className="w-4 h-4" /> Varsayılana dön</Button>
        <Button loading={busy} onClick={save}><Save className="w-4 h-4" /> Kaydet</Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Kargo tarifeleri
function RatesTab({ data }: { data: RulesResp }) {
  const toast = useToast();
  const { bump } = useLive();
  const [form, setForm] = useState({ table: 'hepsiburada', carrier: 'HepsiJET', effectiveFrom: new Date().toISOString().slice(0, 10), text: '' });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = await api<{ maxDesi: number }>('/api/fees/rates', { method: 'PUT', body: form });
      toast(`Tarife kaydedildi (0–${r.maxDesi} desi). Kuralda "desiTable": "${form.table}" tanımlı olmalı.`);
      setForm((f) => ({ ...f, text: '' }));
      bump();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  const tables = Object.entries(data.tables);
  const usedBy = (t: string) => data.rules.filter((r) => r.config.shipping.desiTable === t).map((r) => r.marketplace);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-5 space-y-3">
        <h3 className="font-semibold">Yüklü tarifeler</h3>
        {tables.map(([t, rows]) => (
          <div key={t} className="border border-slate-200 rounded-lg">
            <div className="px-3 py-2 bg-slate-50 text-sm font-medium flex items-center gap-2">{t} <span className="text-xs text-slate-500 font-normal">kullanan: {usedBy(t).map((m) => MARKETPLACE_META[m as MarketplaceName]?.label ?? m).join(', ') || '—'}</span></div>
            <table className="w-full text-xs">
              <thead className="text-slate-500"><tr><th className="text-left px-3 py-1">Firma</th><th className="text-left px-3">Yürürlük</th><th className="text-right px-3">Desi</th><th className="text-right px-3">0 · 1 · 2 · 3 · 4 · 5 desi</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.carrier + r.effectiveFrom}><td className="px-3 py-1">{r.carrier}</td><td className="px-3">{r.effectiveFrom}</td><td className="px-3 text-right">0–{r.maxDesi}</td><td className="px-3 text-right tabular-nums text-slate-600">{r.sample.map((x) => x.toFixed(2)).join(' · ')}</td></tr>)}</tbody>
            </table>
          </div>
        ))}
        <p className="text-xs text-slate-500">Trendyol (5 Ekim 2026, 9 firma, 0–500 desi) yüklediğiniz PDF'ten; idefix (28.01.2026) resmi listeden alındı. Hepsiburada, N11, Çiçeksepeti, Pazarama ve Koçtaş desi tablolarını panelinizden yapıştırarak ekleyin.</p>
      </Card>
      <Card className="p-5 space-y-3">
        <h3 className="font-semibold flex items-center gap-2"><Upload className="w-4 h-4" /> Tarife yapıştır</h3>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Tablo adı"><input className={inputClass} value={form.table} onChange={(e) => setForm({ ...form, table: e.target.value })} /></Field>
          <Field label="Kargo firması"><input className={inputClass} value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} /></Field>
          <Field label="Yürürlük"><input className={inputClass} type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></Field>
        </div>
        <Field label="Desi ; fiyat (KDV hariç) — her satıra bir desi" hint="Excel/PDF'ten iki sütunu kopyalayıp yapıştırabilirsiniz. Örn: Dosya;81,82 · 1;81,82 · 2;86,92">
          <textarea className={`${inputClass} font-mono text-xs`} rows={12} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder={'0;81,99\n1;81,99\n2;81,99\n3;99,99\n...'} />
        </Field>
        <p className="text-xs text-slate-500">Kaydettikten sonra ilgili pazaryeri kuralının JSON'unda <code>shipping.desiTable</code> alanına tablo adını yazın (Hepsiburada için "hepsiburada").</p>
        <div className="flex justify-end"><Button loading={busy} onClick={save}><Save className="w-4 h-4" /> Tarifeyi kaydet</Button></div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Genel
function GeneralTab() {
  const toast = useToast();
  const { data, reload } = useLiveData<{ settings: { adRate: number; returnRiskRate: number; stopajAsCost: boolean; exportCostVatRecoverable: boolean; fx: Record<string, number> }; fxUpdatedAt: string | null; fxSource: string }>('/api/fees/settings');
  const [f, setF] = useState<{ adRate: string; returnRiskRate: string; stopajAsCost: boolean; exportCostVatRecoverable: boolean; fx: Record<string, string> } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data && !f) setF({ adRate: String(data.settings.adRate * 100), returnRiskRate: String(data.settings.returnRiskRate * 100), stopajAsCost: data.settings.stopajAsCost, exportCostVatRecoverable: data.settings.exportCostVatRecoverable, fx: Object.fromEntries(Object.entries(data.settings.fx).map(([k, v]) => [k, String(v)])) });
  }, [data, f]);
  if (!f || !data) return <PageLoader />;
  async function save() {
    setBusy(true);
    try {
      await api('/api/fees/settings', { method: 'PUT', body: { adRate: Number(f!.adRate) / 100, returnRiskRate: Number(f!.returnRiskRate) / 100, stopajAsCost: f!.stopajAsCost, exportCostVatRecoverable: f!.exportCostVatRecoverable, fx: Object.fromEntries(Object.entries(f!.fx).map(([k, v]) => [k, Number(v)])) } });
      toast('Ayarlar kaydedildi. Siparişleri yeniden hesaplayın.');
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  async function tcmb() {
    try { await api('/api/fees/settings', { method: 'POST', body: {} }); toast('TCMB kurları alındı.'); setF(null); reload(); } catch (e) { toast((e as Error).message, 'err'); }
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-5 space-y-3">
        <h3 className="font-semibold">Tüm siparişlere uygulanan giderler</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reklam gideri (satışın %'si)"><input className={inputClass} type="number" step="0.1" value={f.adRate} onChange={(e) => setF({ ...f, adRate: e.target.value })} /></Field>
          <Field label="İade / ceza riski (satışın %'si)"><input className={inputClass} type="number" step="0.1" value={f.returnRiskRate} onChange={(e) => setF({ ...f, returnRiskRate: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-indigo-600" checked={f.stopajAsCost} onChange={(e) => setF({ ...f, stopajAsCost: e.target.checked })} /> %1 e-ticaret stopajını gider say (Excel modelindeki gibi; aslında gelir/kurumlar vergisinden mahsup edilebilir)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-indigo-600" checked={f.exportCostVatRecoverable} onChange={(e) => setF({ ...f, exportCostVatRecoverable: e.target.checked })} /> Etsy (ihracat) satışlarında alış KDV'sini iade alıyorum</label>
      </Card>
      <Card className="p-5 space-y-3">
        <h3 className="font-semibold">Döviz kurları (Etsy ve USD bedeller)</h3>
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(f.fx).map(([k, v]) => <Field key={k} label={`${k}/TRY`}><input className={inputClass} type="number" step="0.0001" value={v} onChange={(e) => setF({ ...f, fx: { ...f.fx, [k]: e.target.value } })} /></Field>)}
        </div>
        <p className="text-xs text-slate-500">Kaynak: {data.fxSource}{data.fxUpdatedAt ? ` · ${new Date(data.fxUpdatedAt).toLocaleString('tr-TR')}` : ''}. Zamanlanmış senkron her çalıştığında TCMB döviz satış kurları otomatik güncellenir.</p>
        <Button variant="secondary" onClick={tcmb}><RefreshCw className="w-4 h-4" /> TCMB'den şimdi al</Button>
      </Card>
      <div className="lg:col-span-2 flex justify-end"><Button loading={busy} onClick={save}><Save className="w-4 h-4" /> Kaydet</Button></div>
    </div>
  );
}
