'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, Database, Save, ShieldCheck, Truck, Zap } from 'lucide-react';
import { MARKETPLACES, MARKETPLACE_META, type MarketplaceName } from '@/lib/marketplaces/meta';
import { api, useLive, useLiveData, useToast } from '@/components/live';
import MarketplaceConnect, { type Cred } from '@/components/MarketplaceConnect';
import { CARRIERS_BY_MARKETPLACE } from '@/lib/fees/carriers';
import { DEFAULT_COMMISSION } from '@/lib/fees/commission-defaults';
import { Button, Card, ErrorBox, MarketplaceBadge, PageLoader, cx, inputClass } from '@/components/ui';

function SettingsInner() {
  const { data, error, loading, reload } = useLiveData<{ credentials: Cred[]; demoMode: boolean; encryption: boolean }>('/api/credentials');
  const toast = useToast();
  const { bump } = useLive();
  const sp = useSearchParams();
  const [open, setOpen] = useState<MarketplaceName | null>(sp.get('etsy') ? 'etsy' : null);

  useEffect(() => {
    const e = sp.get('etsy');
    if (e === 'ok') toast('Etsy mağazanız bağlandı.');
    if (e === 'error') toast(`Etsy bağlantısı başarısız: ${sp.get('msg') ?? ''}`, 'err');
  }, [sp, toast]);

  if (loading) return <PageLoader />;
  if (error || !data) return <ErrorBox error={error ?? ''} onRetry={reload} />;
  const live = data.credentials.filter((c) => c.mode === 'live').length;

  return (
    <div className="space-y-5 fade-in max-w-4xl">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">{live} / {MARKETPLACES.length} pazaryeri bağlı</span>
        <span className={cx('flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs', data.encryption ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
          <ShieldCheck className="w-3.5 h-3.5" /> {data.encryption ? 'API Secret\'lar şifreli saklanıyor (AES-256-GCM)' : 'CREDENTIALS_ENCRYPTION_KEY tanımlı değil — secret\'lar şifresiz saklanır'}
        </span>
      </div>

      <div className="space-y-3">
        {data.credentials.map((c) => (
          <Card key={c.marketplace} className="overflow-hidden">
            <button onClick={() => setOpen(open === c.marketplace ? null : c.marketplace)} className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50">
              <MarketplaceBadge name={c.marketplace} />
              <span className="font-medium">{MARKETPLACE_META[c.marketplace].label}</span>
              <span className="flex-1" />
              <span className={cx('text-xs font-medium', c.mode === 'live' ? 'text-emerald-600' : 'text-slate-400')}>{c.mode === 'live' ? '● Bağlı' : c.mode === 'demo' ? '○ Simülasyon' : '○ Bağlı değil'}</span>
              {c.mode === 'live' && c.lastTestOk === false && <span className="text-xs text-rose-600">son test başarısız</span>}
              <ChevronDown className={cx('w-4 h-4 text-slate-400 transition', open === c.marketplace && 'rotate-180')} />
            </button>
            {open === c.marketplace && (
              <div className="px-5 pb-5 border-t border-slate-100 pt-4">
                <MarketplaceConnect key={`${c.marketplace}-${c.mode}-${c.sellerId}`} cred={c} onSaved={() => { reload(); bump(); }} />
              </div>
            )}
          </Card>
        ))}
      </div>

      <ListingDefaultsCard connected={data.credentials.filter((c) => c.mode !== 'off').map((c) => c.marketplace)} />

      {data.demoMode && <DemoTools onDone={() => { reload(); bump(); }} />}
    </div>
  );
}

type Defaults = Record<string, { carrier: string; handlingDays: number; sameDayTag: boolean; fastTag: boolean; commissionRate: string }>;

/** Yeni ürün eklerken otomatik gelen kargo / termin / komisyon değerleri (pazaryeri başına) */
function ListingDefaultsCard({ connected }: { connected: MarketplaceName[] }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || defaults) return;
    api<{ listingDefaults: Record<string, Partial<Defaults[string]> & { commissionRate?: number | null }> }>('/api/onboarding').then((r) => {
      setDefaults(Object.fromEntries(MARKETPLACES.map((m) => {
        const d = r.listingDefaults?.[m] ?? {};
        return [m, {
          carrier: d.carrier ?? CARRIERS_BY_MARKETPLACE[m]?.[0] ?? '', handlingDays: d.handlingDays ?? 1, sameDayTag: d.sameDayTag ?? false, fastTag: d.fastTag ?? false,
          commissionRate: d.commissionRate != null ? String(d.commissionRate) : String(DEFAULT_COMMISSION[m] ?? ''),
        }];
      })));
    }).catch((e: Error) => toast(e.message, 'err'));
  }, [open, defaults, toast]);

  async function save() {
    if (!defaults) return;
    setBusy(true);
    try {
      await api('/api/onboarding', { method: 'POST', body: { listingDefaults: Object.fromEntries(Object.entries(defaults).map(([m, d]) => [m, { ...d, commissionRate: d.commissionRate === '' ? null : Number(d.commissionRate.replace(',', '.')) }])) } });
      toast('Varsayılanlar kaydedildi.');
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }

  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen((x) => !x)} className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50">
        <Truck className="w-4 h-4 text-slate-500" />
        <span className="font-medium">Kargo, termin ve komisyon varsayılanları</span>
        <span className="flex-1" />
        <ChevronDown className={cx('w-4 h-4 text-slate-400 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-slate-100 pt-4 space-y-3">
          <p className="text-sm text-slate-600">Yeni ürün eklerken bu değerler otomatik gelir; ürün bazında değiştirebilirsiniz. Kâr hesabı bunlara göre yapılır.</p>
          {!defaults ? <PageLoader /> : !connected.length ? <p className="text-sm text-amber-700">Önce bir pazaryeri bağlayın.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500"><tr><th className="text-left py-2">Pazaryeri</th><th className="text-left px-1">Kargo firması</th><th className="text-left px-1">Kargoya teslim (gün)</th><th className="px-1">Bugün Kargoda</th><th className="px-1">Hızlı Teslimat</th><th className="text-left px-1">Komisyon %</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {connected.map((m) => {
                    const d = defaults[m];
                    const set = (patch: Partial<Defaults[string]>) => setDefaults((x) => (x ? { ...x, [m]: { ...x[m], ...patch } } : x));
                    return (
                      <tr key={m}>
                        <td className="py-2"><MarketplaceBadge name={m} /></td>
                        <td className="px-1"><select className={`${inputClass} py-1`} value={d.carrier} onChange={(e) => set({ carrier: e.target.value })}>{(CARRIERS_BY_MARKETPLACE[m] ?? []).map((c) => <option key={c}>{c}</option>)}</select></td>
                        <td className="px-1"><input className={`${inputClass} py-1 w-16`} type="number" min={0} value={d.handlingDays} onChange={(e) => set({ handlingDays: Number(e.target.value) })} /></td>
                        <td className="px-1 text-center"><input type="checkbox" className="accent-indigo-600" checked={d.sameDayTag} onChange={(e) => set({ sameDayTag: e.target.checked, handlingDays: e.target.checked ? 0 : d.handlingDays })} /></td>
                        <td className="px-1 text-center"><input type="checkbox" className="accent-indigo-600" checked={d.fastTag} onChange={(e) => set({ fastTag: e.target.checked })} /></td>
                        <td className="px-1"><input className={`${inputClass} py-1 w-20`} inputMode="decimal" value={d.commissionRate} onChange={(e) => set({ commissionRate: e.target.value })} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {defaults && connected.length > 0 && <div className="flex justify-end"><Button loading={busy} onClick={save}><Save className="w-4 h-4" /> Kaydet</Button></div>}
        </div>
      )}
    </Card>
  );
}

function DemoTools({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Card className="p-5 bg-amber-50 border-amber-200">
      <div className="flex items-center gap-2 font-semibold text-amber-900"><Zap className="w-4 h-4" /> Geliştirici araçları (DEMO_MODE=true)</div>
      <p className="text-sm text-amber-800 mt-1">Canlı kurulumda bu bölüm görünmez.</p>
      <Button className="mt-3" variant="secondary" loading={busy} onClick={async () => {
        if (!window.confirm('Tüm ürün, sipariş ve stok hareketleri silinip demo verisi üretilecek. Devam edilsin mi?')) return;
        setBusy(true);
        try { const r = await api<{ orders: number }>('/api/demo/seed', { method: 'POST' }); toast(`Demo verisi: ${r.orders} sipariş.`); onDone(); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
      }}><Database className="w-4 h-4" /> Demo verisini yükle</Button>
    </Card>
  );
}

export default function SettingsPage() {
  return <Suspense><SettingsInner /></Suspense>;
}
