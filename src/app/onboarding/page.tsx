'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Clock, Rocket } from 'lucide-react';
import { MARKETPLACES, MARKETPLACE_META, type MarketplaceName } from '@/lib/marketplaces/meta';
import { api, useToast } from '@/components/live';
import { BrandMark, BrandName } from '@/components/Brand';
import MarketplaceConnect, { type Cred } from '@/components/MarketplaceConnect';
import { Button, MarketplaceBadge, PageLoader, cx } from '@/components/ui';

/**
 * İlk kurulum — kısa ve sade:
 *  1) Hangi pazaryerlerinde satış yapıyorsunuz? (yalnızca seçilenler sorulur)
 *  2) Seçilen her pazaryeri için yalnızca gerekli anahtar(lar)
 *  3) Hazır. Kargo/komisyon varsayılanları otomatik gelir; Ayarlar'dan değiştirilebilir.
 */
type Step = 'pick' | MarketplaceName | 'done';
const PICK_KEY = 'na_onboarding_pick';

function Wizard() {
  const toast = useToast();
  const sp = useSearchParams();
  const [picked, setPicked] = useState<MarketplaceName[]>([]);
  const [step, setStep] = useState<Step>('pick');
  const [creds, setCreds] = useState<Cred[] | null>(null);
  const [busy, setBusy] = useState(false);

  const loadCreds = useCallback(async () => {
    const r = await api<{ credentials: Cred[] }>('/api/credentials');
    setCreds(r.credentials);
    return r.credentials;
  }, []);

  useEffect(() => {
    loadCreds().catch((e: Error) => toast(e.message, 'err'));
    // Etsy izninden dönüşte seçim kaybolmasın
    try {
      const saved = JSON.parse(sessionStorage.getItem(PICK_KEY) ?? '[]') as MarketplaceName[];
      if (Array.isArray(saved) && saved.length) setPicked(saved.filter((m) => (MARKETPLACES as readonly string[]).includes(m)));
    } catch { /* yok say */ }
    const e = sp.get('etsy');
    if (e) setStep('etsy');
    if (e === 'ok') toast('Etsy mağazanız bağlandı.');
    if (e === 'error') toast(`Etsy bağlantısı başarısız: ${sp.get('msg') ?? ''}`, 'err');
  }, [loadCreds, sp, toast]);

  useEffect(() => {
    try { sessionStorage.setItem(PICK_KEY, JSON.stringify(picked)); } catch { /* yok say */ }
  }, [picked]);

  const order = MARKETPLACES.filter((m) => picked.includes(m));
  const steps: Step[] = ['pick', ...order, 'done'];
  const idx = Math.max(0, steps.indexOf(step));
  const go = (d: 1 | -1) => setStep(steps[Math.min(steps.length - 1, Math.max(0, idx + d))]);
  const connected = (creds ?? []).filter((c) => c.mode === 'live').map((c) => c.marketplace);
  const toggle = (m: MarketplaceName) => setPicked((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m]));

  async function finish() {
    setBusy(true);
    try {
      await api('/api/onboarding', { method: 'POST', body: { complete: true } });
      try { sessionStorage.removeItem(PICK_KEY); } catch { /* yok say */ }
      window.location.href = connected.length ? '/products/new' : '/';
    } catch (e) { toast((e as Error).message, 'err'); setBusy(false); }
  }

  const stepLabel = (s: Step) => s === 'pick' ? 'Pazaryerlerinizi seçin' : s === 'done' ? 'Hazır' : MARKETPLACE_META[s].label;

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside className="w-72 shrink-0 bg-slate-900 text-slate-300 p-6 hidden md:flex flex-col">
        <div className="flex items-center gap-3 mb-8"><BrandMark size={36} /><BrandName light /></div>
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">Kurulum</div>
        <ol className="space-y-1">
          {steps.map((s, i) => {
            const isMp = (MARKETPLACES as readonly string[]).includes(s);
            const done = isMp ? connected.includes(s as MarketplaceName) : i < idx;
            return (
              <li key={s}>
                <button onClick={() => setStep(s)} className={cx('w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left', s === step ? 'bg-slate-800 text-white' : 'hover:bg-slate-800/60')}>
                  <span className={cx('w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0', done ? 'bg-emerald-500 text-white' : 'border border-slate-600')}>
                    {done ? <Check className="w-3 h-3" /> : i + 1}
                  </span>
                  <span className="flex-1">{stepLabel(s)}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-auto text-xs text-slate-500">Her şeyi sonradan "API Bağlantıları" sayfasından değiştirebilirsiniz.</p>
      </aside>

      <main className="flex-1 flex items-start justify-center p-4 md:p-12">
        <div className="w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-sm p-6 md:p-8 fade-in" key={step}>
          <div className="text-xs text-slate-400 mb-1">Adım {idx + 1} / {steps.length}</div>

          {step === 'pick' && (
            <div className="space-y-5">
              <h1 className="text-2xl font-semibold">Hangi pazaryerlerinde satış yapıyorsunuz?</h1>
              <p className="text-slate-600 text-sm">Seçtiklerinizi sırayla bağlayacağız. Her biri için yalnızca gerekli anahtarı isteyeceğiz ve nereden alacağınızı adım adım göstereceğiz.</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {MARKETPLACES.map((m) => {
                  const on = picked.includes(m);
                  const isLive = connected.includes(m);
                  return (
                    <button key={m} type="button" onClick={() => toggle(m)}
                      className={cx('relative rounded-xl border-2 p-4 flex flex-col items-center gap-2 transition', on ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300')}>
                      {on && <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center"><Check className="w-3 h-3" /></span>}
                      <MarketplaceBadge name={m} />
                      {isLive && <span className="text-[10px] text-emerald-600">bağlı</span>}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap justify-between gap-2 pt-2">
                <Button variant="ghost" onClick={() => setStep('done')}><Clock className="w-4 h-4" /> Şimdilik atla</Button>
                <Button disabled={!picked.length} onClick={() => go(1)}>{picked.length ? `${picked.length} pazaryerini bağla` : 'Pazaryeri seçin'} <ArrowRight className="w-4 h-4" /></Button>
              </div>
            </div>
          )}

          {(MARKETPLACES as readonly string[]).includes(step) && (() => {
            const mp = step as MarketplaceName;
            const c = creds?.find((x) => x.marketplace === mp);
            return (
              <div className="space-y-5">
                <h1 className="text-2xl font-semibold">{MARKETPLACE_META[mp].label} bağlantısı</h1>
                {!c ? <PageLoader /> : <MarketplaceConnect key={`${mp}-${c.mode}-${c.sellerId}`} cred={c} back="onboarding" onSaved={async (ok) => { await loadCreds(); if (ok) go(1); }} />}
                <div className="flex justify-between border-t border-slate-100 pt-4">
                  <Button variant="ghost" onClick={() => go(-1)}><ArrowLeft className="w-4 h-4" /> Geri</Button>
                  {c?.mode === 'live'
                    ? <Button onClick={() => go(1)}>Devam <ArrowRight className="w-4 h-4" /></Button>
                    : <Button variant="secondary" onClick={() => go(1)}><Clock className="w-4 h-4" /> Bunu sonra yapacağım</Button>}
                </div>
              </div>
            );
          })()}

          {step === 'done' && (
            <div className="space-y-5 text-center">
              <div className="mx-auto w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center"><Rocket className="w-7 h-7" /></div>
              <h1 className="text-2xl font-semibold">Hazırsınız!</h1>
              <p className="text-sm text-slate-600">
                {connected.length ? `${connected.length} pazaryeri bağlandı.` : 'Henüz pazaryeri bağlanmadı; "API Bağlantıları" sayfasından istediğiniz zaman bağlayabilirsiniz.'}{' '}
                Şimdi ilk ürününüzü fotoğraflarıyla ekleyip bağlı pazaryerlerinin hepsinde aynı anda yayınlayabilirsiniz.
              </p>
              <div className="flex flex-wrap justify-center gap-1.5">{connected.map((m) => <MarketplaceBadge key={m} name={m} />)}</div>
              <p className="text-xs text-slate-500">Kargo firması, kargoya teslim süresi ve komisyon oranları her pazaryeri için hazır değerlerle gelir; "API Bağlantıları" sayfasından değiştirebilirsiniz.</p>
              <div className="flex justify-center gap-2 pt-2">
                <Button variant="secondary" onClick={() => go(-1)}><ArrowLeft className="w-4 h-4" /> Geri</Button>
                <Button loading={busy} onClick={finish}>Panele geç <ArrowRight className="w-4 h-4" /></Button>
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
