'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, Database, ShieldCheck, Zap } from 'lucide-react';
import { MARKETPLACES, MARKETPLACE_META, type MarketplaceName } from '@/lib/marketplaces/meta';
import { api, useLive, useLiveData, useToast } from '@/components/live';
import MarketplaceConnect, { type Cred } from '@/components/MarketplaceConnect';
import { Button, Card, ErrorBox, MarketplaceBadge, PageLoader, cx } from '@/components/ui';

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

      {data.demoMode && <DemoTools onDone={() => { reload(); bump(); }} />}
    </div>
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
