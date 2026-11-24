'use client';
import { RoleProvider, STAFF_HIDDEN, type Role } from '@/components/role';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Activity, Boxes, Lightbulb, ListChecks, Receipt, Calculator, LayoutDashboard, LogOut, Megaphone, Menu, Package, Plus, PlusCircle, Scale, Settings, ShoppingCart, TrendingUp, UserCog, X, Zap, Radio } from 'lucide-react';
import { BrandMark } from './Brand';
import { MARKETPLACES, MARKETPLACE_META, type MarketplaceName } from '@/lib/marketplaces/meta';
import { LiveProvider, ToastProvider, api, useLive, useLiveData, useToast } from './live';
import { Button, MarketplaceBadge, cx } from './ui';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/insights', label: 'Öneriler', icon: Lightbulb },
  { href: '/products/new', label: 'Yeni Ürün Ekle', icon: PlusCircle, exact: true },
  { href: '/products', label: 'Ürünler', icon: Package },
  { href: '/stock', label: 'Stok', icon: Boxes },
  { href: '/orders', label: 'Siparişler', icon: ShoppingCart },
  { href: '/operations', label: 'İşlem Merkezi', icon: ListChecks },
  { href: '/profit', label: 'Kârlılık', icon: TrendingUp },
  { href: '/pricing', label: 'Fiyat Hesaplayıcı', icon: Calculator },
  { href: '/rules', label: 'Maliyet Kuralları', icon: Scale },
  { href: '/ads', label: 'Reklam', icon: Megaphone },
  { href: '/expenses', label: 'Giderler', icon: Receipt },
  { href: '/settings', label: 'API Bağlantıları', icon: Settings },
  { href: '/account', label: 'Hesabım', icon: UserCog },
];
const BARE = ['/login', '/setup', '/signup', '/forgot', '/reset', '/onboarding', '/invite', '/welcome', '/legal/terms', '/legal/privacy', '/legal/kvkk'];
const isActive = (path: string, n: { href: string; exact?: boolean }) =>
  n.href === '/' ? path === '/' : n.exact ? path === n.href : path.startsWith(n.href) && !(n.href === '/products' && path === '/products/new');

interface Status { user: { email: string; name: string; role?: string } | null; onboarded: boolean; companyName: string | null; demoMode: boolean }

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const bare = BARE.includes(path);
  const [status, setStatus] = useState<Status | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [path]);

  useEffect(() => {
    if (bare) return;
    fetch('/api/auth/status').then((r) => r.json()).then((s: Status) => {
      setStatus(s);
      if (!s.user) router.replace('/login');
      else if (!s.onboarded) router.replace('/onboarding');
    }).catch(() => {});
  }, [bare, router, path]);

  // Panel açıkken 3 dakikada bir otomatik senkron (sipariş çekme + stok eşitleme)
  const ready = !bare && !!status?.user && !!status.onboarded;
  useEffect(() => {
    if (!ready) return;
    const tick = () => { if (document.visibilityState === 'visible') fetch('/api/sync', { method: 'POST' }).catch(() => {}); };
    tick();
    const t = setInterval(tick, 180_000);
    return () => clearInterval(t);
  }, [ready]);

  if (bare) return <ToastProvider>{children}</ToastProvider>;
  if (!status?.user || !status.onboarded) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">Yükleniyor…</div>;
  }
  return (
    <ToastProvider>
      <RoleProvider value={roleOf(status)}>
      <LiveProvider>
        <div className="flex min-h-screen">
          {/* Masaüstü: sabit yan menü */}
          <div className="hidden lg:flex sticky top-0 h-screen"><Sidebar status={status} /></div>
          {/* Telefon/tablet: soldan açılan menü */}
          {menuOpen && (
            <div className="lg:hidden fixed inset-0 z-50 flex">
              <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMenuOpen(false)} />
              <div className="relative h-full shadow-2xl fade-in"><Sidebar status={status} onClose={() => setMenuOpen(false)} /></div>
            </div>
          )}
          <main className="flex-1 min-w-0 flex flex-col">
            <Header demo={status.demoMode} onMenu={() => setMenuOpen(true)} />
            {status.demoMode && (
              <div className="bg-amber-400 text-amber-950 text-xs sm:text-sm px-3 sm:px-6 py-1.5 flex items-center gap-2">
                <b>Deneme mağazası</b><span className="hidden sm:inline">— ürünler ve siparişler örnektir, hiçbir pazaryerine gönderilmez.</span>
                <Link href="/account" className="ml-auto underline whitespace-nowrap">Kapat</Link>
              </div>
            )}
            <div className="flex flex-1 min-h-0">
              <section className="flex-1 min-w-0 p-3 sm:p-6 pb-24 lg:pb-6">{children}</section>
              <LiveFeed />
            </div>
          </main>
          <BottomNav onMenu={() => setMenuOpen(true)} />
        </div>
      </LiveProvider>
      </RoleProvider>
    </ToastProvider>
  );
}

const roleOf = (s: Status | null): Role => (s?.user?.role === 'staff' || s?.user?.role === 'admin' ? s.user.role : 'owner');

/** Telefonda alt sekme çubuğu: en sık kullanılan ekranlar tek dokunuşla */
function BottomNav({ onMenu }: { onMenu: () => void }) {
  const path = usePathname();
  const items = [
    { href: '/', label: 'Panel', icon: LayoutDashboard },
    { href: '/products', label: 'Ürünler', icon: Package },
    { href: '/products/new', label: 'Ekle', icon: Plus, exact: true, primary: true },
    { href: '/orders', label: 'Siparişler', icon: ShoppingCart },
  ];
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 grid grid-cols-5" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {items.map((n) => {
        const active = isActive(path, n);
        const Icon = n.icon;
        return n.primary ? (
          <Link key={n.href} href={n.href} className="flex flex-col items-center justify-center py-1.5">
            <span className="w-11 h-11 -mt-5 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-lg"><Icon className="w-5 h-5" /></span>
            <span className="text-[10px] text-slate-600 mt-0.5">{n.label}</span>
          </Link>
        ) : (
          <Link key={n.href} href={n.href} className={cx('flex flex-col items-center justify-center py-2 text-[10px]', active ? 'text-indigo-600' : 'text-slate-500')}>
            <Icon className="w-5 h-5 mb-0.5" />{n.label}
          </Link>
        );
      })}
      <button onClick={onMenu} className="flex flex-col items-center justify-center py-2 text-[10px] text-slate-500"><Menu className="w-5 h-5 mb-0.5" />Menü</button>
    </nav>
  );
}

function Sidebar({ status, onClose }: { status: Status; onClose?: () => void }) {
  const path = usePathname();
  const { data } = useLiveData<{ credentials: Array<{ marketplace: string; mode: string }> }>('/api/credentials');
  const live = data?.credentials.filter((c) => c.mode === 'live') ?? [];
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }
  return (
    <aside className="w-64 lg:w-60 shrink-0 bg-slate-900 text-slate-300 flex flex-col h-full overflow-y-auto">
      <div className="px-5 py-5 border-b border-slate-800 flex items-center gap-3">
        <BrandMark size={34} />
        <div className="leading-tight min-w-0">
          <div className="text-white font-semibold truncate">{status.companyName || 'Mağazam'}</div>
          <div className="text-xs text-slate-400 truncate">Pazaryeri Yönetim Paneli</div>
        </div>
        {onClose && <button onClick={onClose} className="ml-auto p-1.5 rounded hover:bg-slate-800" aria-label="Menüyü kapat"><X className="w-5 h-5" /></button>}
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {NAV.filter((n) => roleOf(status) !== 'staff' || !STAFF_HIDDEN.includes(n.href)).map((n) => {
          const active = isActive(path, n);
          const Icon = n.icon;
          return (
            <Link key={n.href} href={n.href}
              className={cx('flex items-center gap-2.5 px-3 py-2.5 lg:py-2 rounded-lg text-sm hover:bg-slate-800 hover:text-white', active && 'bg-slate-800 text-white',
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
          {status.demoMode && <div className="text-[11px] text-amber-400 mt-1">Deneme mağazası — tüm pazaryerleri simülasyon</div>}
        </Link>
        <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
          <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-white text-[11px] font-semibold">{status.user!.name.slice(0, 1).toUpperCase()}</div>
          <Link href="/account" title="Hesabım" className="flex-1 min-w-0 hover:text-white"><div className="text-slate-200 truncate">{status.user!.name}</div><div className="text-[10px] text-slate-500 truncate">{status.user!.email}</div></Link>
          <button onClick={logout} title="Çıkış yap" className="p-1.5 rounded hover:bg-slate-800 hover:text-white"><LogOut className="w-4 h-4" /></button>
        </div>
      </div>
    </aside>
  );
}

function Header({ demo, onMenu }: { demo: boolean; onMenu: () => void }) {
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
    <header className="h-14 sm:h-16 bg-white border-b border-slate-200 flex items-center justify-between gap-2 px-3 sm:px-6 shrink-0 sticky top-0 z-30">
      <div className="flex items-center gap-2 min-w-0">
        <button onClick={onMenu} className="lg:hidden p-2 -ml-1 rounded-lg hover:bg-slate-100" aria-label="Menüyü aç"><Menu className="w-5 h-5" /></button>
        <h1 className="text-base sm:text-lg font-semibold truncate">{title}</h1>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {demo && (
          <>
            <select value={mp} onChange={(e) => setMp(e.target.value as MarketplaceName)} className="hidden sm:block text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white">
              {MARKETPLACES.map((m) => <option key={m} value={m}>{MARKETPLACE_META[m].label}</option>)}
            </select>
            <Button variant="secondary" onClick={simulate} loading={busy} className="hidden sm:inline-flex"><Zap className="w-4 h-4" /> Sipariş simüle et</Button>
          </>
        )}
        {path !== '/products/new' && <Link href="/products/new" className="hidden lg:inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium bg-slate-900 text-white hover:bg-slate-800"><PlusCircle className="w-4 h-4" /> Yeni Ürün</Link>}
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
    <aside className="w-80 shrink-0 border-l border-slate-200 bg-white hidden xl:flex flex-col sticky top-16 h-[calc(100vh-4rem)]">
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
