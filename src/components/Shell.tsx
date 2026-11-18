'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Activity, Boxes, Calculator, LayoutDashboard, LogOut, Package, PlusCircle, Scale, Settings, ShoppingCart, TrendingUp, Zap, Radio } from 'lucide-react';
import { BrandMark } from './Brand';
import { MARKETPLACES, MARKETPLACE_META, type MarketplaceName } from '@/lib/marketplaces/meta';
import { LiveProvider, ToastProvider, api, useLive, useLiveData, useToast } from './live';
import { Button, MarketplaceBadge, cx } from './ui';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/products/new', label: 'Yeni Ürün Ekle', icon: PlusCircle, exact: true },
  { href: '/products', label: 'Ürünler', icon: Package },
  { href: '/stock', label: 'Stok', icon: Boxes },
  { href: '/orders', label: 'Siparişler', icon: ShoppingCart },
  { href: '/profit', label: 'Kârlılık', icon: TrendingUp },
  { href: '/pricing', label: 'Fiyat Hesaplayıcı', icon: Calculator },
  { href: '/rules', label: 'Maliyet Kuralları', icon: Scale },
  { href: '/settings', label: 'API Bağlantıları', icon: Settings },
];
const BARE = ['/login', '/setup', '/onboarding'];
const isActive = (path: string, n: { href: string; exact?: boolean }) =>
  n.href === '/' ? path === '/' : n.exact ? path === n.href : path.startsWith(n.href) && !(n.href === '/products' && path === '/products/new');

interface Status { hasUser: boolean; user: { email: string; name: string } | null; onboarded: boolean; companyName: string | null; demoMode: boolean }

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const bare = BARE.includes(path);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    if (bare) return;
    fetch('/api/auth/status').then((r) => r.json()).then((s: Status) => {
      setStatus(s);
      if (!s.user) router.replace('/login');
      else if (!s.onboarded) router.replace('/onboarding');
    }).catch(() => {});
  }, [bare, router, path]);

  if (bare) return <ToastProvider>{children}</ToastProvider>;
  if (!status?.user || !status.onboarded) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">Yükleniyor…</div>;
  }
  return (
    <ToastProvider>
      <LiveProvider>
        <div className="flex min-h-screen">
          <Sidebar status={status} />
          <main className="flex-1 min-w-0 flex flex-col">
            <Header demo={status.demoMode} />
            <div className="flex flex-1 min-h-0">
              <section className="flex-1 min-w-0 p-6">{children}</section>
              <LiveFeed />
            </div>
          </main>
        </div>
      </LiveProvider>
    </ToastProvider>
  );
}

function Sidebar({ status }: { status: Status }) {
  const path = usePathname();
  const { data } = useLiveData<{ credentials: Array<{ marketplace: string; mode: string }> }>('/api/credentials');
  const live = data?.credentials.filter((c) => c.mode === 'live') ?? [];
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }
  return (
    <aside className="w-60 shrink-0 bg-slate-900 text-slate-300 flex flex-col">
      <div className="px-5 py-5 border-b border-slate-800 flex items-center gap-3">
        <BrandMark size={34} />
        <div className="leading-tight min-w-0">
          <div className="text-white font-semibold">Nuance Art</div>
          <div className="text-xs text-slate-400 truncate">{status.companyName ?? 'Pazaryeri Yönetim Paneli'}</div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {NAV.map((n) => {
          const active = isActive(path, n);
          const Icon = n.icon;
          return (
            <Link key={n.href} href={n.href}
              className={cx('flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm hover:bg-slate-800 hover:text-white', active && 'bg-slate-800 text-white',
                n.href === '/products/new' && !active && 'text-amber-200')}>
              <Icon className={cx('w-4 h-4', active && 'text-amber-300')} />{n.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-slate-800 text-xs space-y-3">
        <Link href="/settings" className="block hover:text-white">
          {live.length > 0 ? (
            <>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-400" />{live.length} pazaryeri bağlı</div>
              <div className="flex flex-wrap gap-1 mt-1.5">{live.map((c) => <MarketplaceBadge key={c.marketplace} name={c.marketplace} size="xs" />)}</div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-amber-300"><span className="w-2 h-2 rounded-full bg-amber-400" />Henüz pazaryeri bağlı değil</div>
          )}
          {status.demoMode && <div className="text-[11px] text-amber-400 mt-1">DEMO_MODE açık (geliştirme)</div>}
        </Link>
        <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
          <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-white text-[11px] font-semibold">{status.user!.name.slice(0, 1).toUpperCase()}</div>
          <div className="flex-1 min-w-0"><div className="text-slate-200 truncate">{status.user!.name}</div><div className="text-[10px] text-slate-500 truncate">{status.user!.email}</div></div>
          <button onClick={logout} title="Çıkış yap" className="p-1.5 rounded hover:bg-slate-800 hover:text-white"><LogOut className="w-4 h-4" /></button>
        </div>
      </div>
    </aside>
  );
}

function Header({ demo }: { demo: boolean }) {
  const path = usePathname();
  const toast = useToast();
  const { bump } = useLive();
  const [mp, setMp] = useState<MarketplaceName>('trendyol');
  const [busy, setBusy] = useState(false);
  const title = path.startsWith('/products/') && path !== '/products/new' ? 'Ürün Detayı' : NAV.find((n) => isActive(path, n))?.label ?? '';

  async function simulate() {
    setBusy(true);
    try {
      const r = await api<{ sku: string; quantity: number; externalOrderId: string }>('/api/simulate', { method: 'POST', body: { marketplace: mp } });
      toast(`${MARKETPLACE_META[mp].label}: #${r.externalOrderId} — ${r.quantity} x ${r.sku}.`);
      bump();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="flex items-center gap-2">
        {demo && (
          <>
            <select value={mp} onChange={(e) => setMp(e.target.value as MarketplaceName)} className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white">
              {MARKETPLACES.map((m) => <option key={m} value={m}>{MARKETPLACE_META[m].label}</option>)}
            </select>
            <Button variant="secondary" onClick={simulate} loading={busy}><Zap className="w-4 h-4" /> Sipariş simüle et</Button>
          </>
        )}
        {path !== '/products/new' && <Link href="/products/new" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium bg-slate-900 text-white hover:bg-slate-800"><PlusCircle className="w-4 h-4" /> Yeni Ürün</Link>}
      </div>
    </header>
  );
}

type Log = { id: number; level: 'info' | 'success' | 'warning' | 'error'; kind: string; marketplace_name: string | null; message: string; created_at: string };

function LiveFeed() {
  const { connected } = useLive();
  const { data } = useLiveData<{ logs: Log[] }>('/api/logs');
  const border = { info: 'border-slate-300', success: 'border-emerald-400', warning: 'border-amber-400', error: 'border-rose-400' };
  return (
    <aside className="w-80 shrink-0 border-l border-slate-200 bg-white hidden xl:flex flex-col sticky top-0 h-[calc(100vh-4rem)]">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <div className="font-semibold text-sm flex items-center gap-1.5"><Activity className="w-4 h-4" /> Canlı Senkron Akışı</div>
        <span title={connected ? 'Supabase Realtime bağlı' : 'Realtime yok — 15 sn yoklama'} className={cx('flex items-center gap-1 text-[11px]', connected ? 'text-emerald-600' : 'text-slate-400')}>
          <Radio className="w-3 h-3" />{connected ? 'canlı' : 'yoklama'}
        </span>
      </div>
      <ul className="flex-1 overflow-y-auto scroll-thin p-3 space-y-2 text-xs">
        {!data?.logs.length && <li className="text-slate-400 text-center py-8">Henüz hareket yok.<br />Bir sipariş simüle edin.</li>}
        {data?.logs.map((l) => (
          <li key={l.id} className={cx('border-l-2 pl-2 py-1', border[l.level])}>
            <div className="text-slate-400">{new Date(l.created_at).toLocaleTimeString('tr-TR')}</div>
            <div className="text-slate-700 break-words">{l.message}</div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
