'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, CircleSlash, Rocket } from 'lucide-react';
import { MARKETPLACES, MARKETPLACE_META, type MarketplaceName } from '@/lib/marketplaces/meta';
import { CARRIERS_BY_MARKETPLACE } from '@/lib/fees/carriers';
import { DEFAULT_COMMISSION } from '@/lib/fees/commission-defaults';
import { api, useToast } from '@/components/live';
import { BrandMark, BrandName } from '@/components/Brand';
import MarketplaceConnect, { type Cred } from '@/components/MarketplaceConnect';
import { Button, Field, MarketplaceBadge, PageLoader, cx, inputClass } from '@/components/ui';

type Step = 'welcome' | MarketplaceName | 'defaults' | 'done';
const STEPS: Step[] = ['welcome', ...MARKETPLACES, 'defaults', 'done'];
type Defaults = Record<string, { carrier: string; handlingDays: number; sameDayTag: boolean; fastTag: boolean; commissionRate: string }>;

function Wizard() {
  const toast = useToast();
  const sp = useSearchParams();
  const [step, setStep] = useState<Step>(() => (sp.get('etsy') ? 'etsy' : 'welcome'));
  const [creds, setCreds] = useState<Cred[] | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [company, setCompany] = useState({ name: '', email: '', phone: '' });
  const [defaults, setDefaults] = useState<Defaults>({});
  const [busy, setBusy] = useState(false);

  const loadCreds = useCallback(async () => {
    const r = await api<{ credentials: Cred[] }>('/api/credentials');
    setCreds(r.credentials);
    return r.credentials;
  }, []);

  useEffect(() => {
    loadCreds().catch((e: Error) => toast(e.message, 'err'));
    api<{ company: { name?: string; email?: string; phone?: string } | null; listingDefaults: Record<string, Partial<Defaults[string]> & { commissionRate?: number | null }> }>('/api/onboarding').then((r) => {
      if (r.company) setCompany({ name: r.company.name ?? '', email: r.company.email ?? '', phone: r.company.phone ?? '' });
      setDefaults(Object.fromEntries(MARKETPLACES.map((m) => {
        const d = r.listingDefaults?.[m] ?? {};
        return [m, {
          carrier: d.carrier ?? CARRIERS_BY_MARKETPLACE[m]?.[0] ?? '', handlingDays: d.handlingDays ?? 1, sameDayTag: d.sameDayTag ?? false, fastTag: d.fastTag ?? false,
          commissionRate: d.commissionRate != null ? String(d.commissionRate) : String(DEFAULT_COMMISSION[m] ?? ''),
        }];
      })));
    }).catch(() => {});
    const e = sp.get('etsy');
    if (e === 'ok') toast('Etsy mağazanız bağlandı.');
    if (e === 'error') toast(`Etsy bağlantısı başarısız: ${sp.get('msg') ?? ''}`, 'err');
  }, [loadCreds, sp, toast]);

  const idx = STEPS.indexOf(step);
  const go = (d: 1 | -1) => setStep(STEPS[Math.min(STEPS.length - 1, Math.max(0, idx + d))]);
  const connected = (creds ?? []).filter((c) => c.mode === 'live').map((c) => c.marketplace);

  async function saveCompany() {
    if (!company.name.trim()) { toast('Mağaza adını girin.', 'err'); return; }
    setBusy(true);
    try { await api('/api/onboarding', { method: 'POST', body: { company } }); go(1); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }

  async function saveDefaults() {
    setBusy(true);
    try {
      await api('/api/onboarding', {
        method: 'POST',
        body: { listingDefaults: Object.fromEntries(Object.entries(defaults).map(([m, d]) => [m, { ...d, commissionRate: d.commissionRate === '' ? null : Number(d.commissionRate) }])) },
      });
      go(1);
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }

  async function finish() {
    setBusy(true);
    try { await api('/api/onboarding', { method: 'POST', body: { complete: true } }); window.location.href = '/products/new'; } catch (e) { toast((e as Error).message, 'err'); setBusy(false); }
  }

  const stepLabel = (s: Step) => s === 'welcome' ? 'Mağaza bilgileri' : s === 'defaults' ? 'Kargo & termin' : s === 'done' ? 'Hazır' : MARKETPLACE_META[s].label;

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside className="w-72 shrink-0 bg-slate-900 text-slate-300 p-6 hidden md:flex flex-col">
        <div className="flex items-center gap-3 mb-8"><BrandMark size={36} /><BrandName light /></div>
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">Kurulum adımları</div>
        <ol className="space-y-1">
          {STEPS.map((s, i) => {
            const isMp = (MARKETPLACES as readonly string[]).includes(s);
            const done = i < idx || (isMp && connected.includes(s as MarketplaceName));
            return (
              <li key={s}>
                <button onClick={() => setStep(s)} className={cx('w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left', s === step ? 'bg-slate-800 text-white' : 'hover:bg-slate-800/60')}>
                  <span className={cx('w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0', done ? 'bg-emerald-500 text-white' : skipped.has(s) ? 'bg-slate-700 text-slate-400' : 'border border-slate-600')}>
                    {done ? <Check className="w-3 h-3" /> : skipped.has(s) ? '–' : i + 1}
                  </span>
                  <span className="flex-1">{stepLabel(s)}</span>
                  {isMp && connected.includes(s as MarketplaceName) && <span className="text-[10px] text-emerald-400">bağlı</span>}
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-auto text-xs text-slate-500">Tüm adımlar daha sonra Ayarlar'dan değiştirilebilir.</p>
      </aside>

      <main className="flex-1 flex items-start justify-center p-6 md:p-12">
        <div className="w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-sm p-8 fade-in" key={step}>
          <div className="text-xs text-slate-400 mb-1">Adım {idx + 1} / {STEPS.length}</div>

          {step === 'welcome' && (
            <div className="space-y-5">
              <h1 className="text-2xl font-semibold">Mağazanızı kuralım</h1>
              <p className="text-slate-600 text-sm">Sırayla satış yaptığınız pazaryerlerinin API bilgilerini isteyeceğiz. Her adımda bilgiyi nereden alacağınız yazıyor; satış yapmadığınız pazaryerini <b>atlayabilirsiniz</b>. Bağlanan pazaryerlerine ürünleriniz, fotoğraflarınız ve stoklarınız otomatik gönderilir.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-3"><Field label="Mağaza / firma adı *"><input className={inputClass} value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} /></Field></div>
                <div className="sm:col-span-2"><Field label="İletişim e-postası"><input className={inputClass} type="email" value={company.email} onChange={(e) => setCompany({ ...company, email: e.target.value })} /></Field></div>
                <Field label="Telefon"><input className={inputClass} value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} /></Field>
              </div>
              <div className="flex flex-wrap gap-1.5">{MARKETPLACES.map((m) => <MarketplaceBadge key={m} name={m} size="xs" />)}</div>
              <div className="flex justify-end"><Button loading={busy} onClick={saveCompany}>Pazaryeri bağlantılarına geç <ArrowRight className="w-4 h-4" /></Button></div>
            </div>
          )}

          {(MARKETPLACES as readonly string[]).includes(step) && (() => {
            const mp = step as MarketplaceName;
            const c = creds?.find((x) => x.marketplace === mp);
            return (
              <div className="space-y-5">
                <h1 className="text-2xl font-semibold">{MARKETPLACE_META[mp].label} bağlantısı</h1>
                <p className="text-sm text-slate-600">{MARKETPLACE_META[mp].at} satış yapıyorsanız aşağıdaki adımlarla API bilgilerinizi girin. Yapmıyorsanız bu adımı atlayın.</p>
                {!c ? <PageLoader /> : <MarketplaceConnect key={`${mp}-${c.mode}-${c.sellerId}`} cred={c} back="onboarding" onSaved={async (ok) => { await loadCreds(); if (ok) { setSkipped((s) => { const n = new Set(s); n.delete(mp); return n; }); go(1); } }} />}
                <div className="flex justify-between border-t border-slate-100 pt-4">
                  <Button variant="ghost" onClick={() => go(-1)}><ArrowLeft className="w-4 h-4" /> Geri</Button>
                  {c?.mode === 'live'
                    ? <Button onClick={() => go(1)}>Devam <ArrowRight className="w-4 h-4" /></Button>
                    : <Button variant="secondary" onClick={() => { setSkipped((s) => new Set(s).add(mp)); go(1); }}><CircleSlash className="w-4 h-4" /> {MARKETPLACE_META[mp].at} satış yapmıyorum, atla</Button>}
                </div>
              </div>
            );
          })()}

          {step === 'defaults' && (
            <div className="space-y-5">
              <h1 className="text-2xl font-semibold">Kargo, termin ve komisyon varsayılanları</h1>
              <p className="text-sm text-slate-600">Yeni ürün eklerken bu değerler otomatik gelir; ürün bazında değiştirebilirsiniz. Kâr hesabı (kargo barem fiyatları, Bugün Kargoda indirimi, komisyon) bunlara göre yapılır.</p>
              {!connected.length && <div className="text-sm bg-amber-50 text-amber-800 rounded-lg p-3">Henüz bağlı pazaryeri yok. Geri dönüp en az bir pazaryeri bağlayın ya da daha sonra Ayarlar'dan bağlayın.</div>}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-500"><tr><th className="text-left py-2">Pazaryeri</th><th className="text-left px-1">Kargo firması</th><th className="text-left px-1">Termin (gün)</th><th className="px-1">Bugün Kargoda</th><th className="px-1">Hızlı Teslimat</th><th className="text-left px-1">Komisyon %</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {connected.map((m) => {
                      const d = defaults[m];
                      if (!d) return null;
                      const set = (patch: Partial<Defaults[string]>) => setDefaults((x) => ({ ...x, [m]: { ...x[m], ...patch } }));
                      return (
                        <tr key={m}>
                          <td className="py-2"><MarketplaceBadge name={m} /></td>
                          <td className="px-1"><select className={`${inputClass} py-1`} value={d.carrier} onChange={(e) => set({ carrier: e.target.value })}>{(CARRIERS_BY_MARKETPLACE[m] ?? []).map((c) => <option key={c}>{c}</option>)}</select></td>
                          <td className="px-1"><input className={`${inputClass} py-1 w-16`} type="number" min={0} value={d.handlingDays} onChange={(e) => set({ handlingDays: Number(e.target.value) })} /></td>
                          <td className="px-1 text-center"><input type="checkbox" className="accent-indigo-600" checked={d.sameDayTag} onChange={(e) => set({ sameDayTag: e.target.checked, handlingDays: e.target.checked ? 0 : d.handlingDays })} /></td>
                          <td className="px-1 text-center"><input type="checkbox" className="accent-indigo-600" checked={d.fastTag} onChange={(e) => set({ fastTag: e.target.checked })} /></td>
                          <td className="px-1"><input className={`${inputClass} py-1 w-20`} type="number" step="0.1" value={d.commissionRate} onChange={(e) => set({ commissionRate: e.target.value })} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500">Komisyon oranı kategoriye göre değişir; ürün eklerken ürünün kategorisine göre düzeltin. Trendyol'da "Bugün Kargoda" + aynı gün kargoya verilen siparişte platform hizmet bedeli 10,99 yerine 4,99 TL + KDV olur.</p>
              <div className="flex justify-between border-t border-slate-100 pt-4">
                <Button variant="ghost" onClick={() => go(-1)}><ArrowLeft className="w-4 h-4" /> Geri</Button>
                <Button loading={busy} onClick={saveDefaults}>Kaydet ve devam <ArrowRight className="w-4 h-4" /></Button>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="space-y-5 text-center">
              <div className="mx-auto w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center"><Rocket className="w-7 h-7" /></div>
              <h1 className="text-2xl font-semibold">Kurulum tamam!</h1>
              <p className="text-sm text-slate-600">{connected.length ? `${connected.length} pazaryeri bağlandı.` : 'Henüz pazaryeri bağlanmadı; Ayarlar > API Bağlantıları\'ndan istediğiniz zaman bağlayabilirsiniz.'} Şimdi ilk ürününüzü fotoğraflarıyla ekleyip tüm bağlı pazaryerlerinde aynı anda yayınlayabilirsiniz.</p>
              <div className="flex flex-wrap justify-center gap-1.5">{connected.map((m) => <MarketplaceBadge key={m} name={m} />)}</div>
              <div className="flex justify-center gap-2 pt-2">
                <Button variant="secondary" onClick={() => go(-1)}><ArrowLeft className="w-4 h-4" /> Geri</Button>
                <Button loading={busy} onClick={finish}>İlk ürünümü ekle <ArrowRight className="w-4 h-4" /></Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function OnboardingPage() {
  return <Suspense><Wizard /></Suspense>;
}
