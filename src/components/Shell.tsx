'use client';
import { RoleProvider, STAFF_HIDDEN, type Role } from '@/components/role';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BarChart3, Boxes, ChevronDown, Lightbulb, ListChecks, Receipt, Calculator, LayoutDashboard, LogOut, Megaphone, Menu, Package, Plus, PlusCircle, Scale, Settings, ShoppingCart, TrendingUp, UserCog, X, Zap, Store, type LucideIcon } from 'lucide-react';
import StoreSwitcher from './StoreSwitcher';
import { accentVars } from '@/lib/theme';
import { BASE_MARKETPLACES, MARKETPLACE_META, type MarketplaceName } from '@/lib/marketplaces/meta';
import { LiveProvider, ToastProvider, api, useLive, useLiveData, useToast } from './live';
import { Button, MarketplaceBadge, cx } from './ui';

type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean; hint?: string };
type NavGroup = { label: string; icon: LucideIcon; href?: string; exact?: boolean; items?: NavItem[] };

/** Üst menü: az ve gruplu. Ayrıntılar açılır menülerde. */
const GROUPS: NavGroup[] = [
  { label: 'Ana Sayfa', icon: LayoutDashboard, href: '/' },
  { label: 'Ürünler', icon: Package, items: [
    { href: '/products', label: 'Ürünlerim', icon: Package, hint: 'Tüm ürünler ve ilanlar' },
    { href: '/products/new', label: 'Yeni Ürün Ekle', icon: PlusCircle, exact: true, hint: 'Tüm pazaryerlerine tek seferde' },
    { href: '/stock', label: 'Stok', icon: Boxes, hint: 'Ortak stok havuzu' },
  ] },
  { label: 'Siparişler', icon: ShoppingCart, href: '/orders' },
  { label: 'Raporlar', icon: BarChart3, items: [
    { href: '/profit', label: 'Kârlılık', icon: TrendingUp, hint: 'Ciro, kâr, pazaryeri karşılaştırması' },
    { href: '/insights', label: 'Öneriler', icon: Lightbulb, hint: 'Stok, satış ve iade analizleri' },
    { href: '/expenses', label: 'Giderler', icon: Receipt, hint: 'Kira, maaş gibi işletme giderleri' },
    { href: '/ads', label: 'Reklam', icon: Megaphone, hint: 'Reklam harcamaları' },
    { href: '/pricing', label: 'Fiyat Hesaplayıcı', icon: Calculator, hint: 'Hangi fiyatla ne kazanırım?' },
    { href: '/rules', label: 'Maliyet Kuralları', icon: Scale, hint: 'Komisyon ve kargo bedelleri' },
    { href: '/operations', label: 'İşlem Merkezi', icon: ListChecks, hint: 'Gönderilemeyen işlemler' },
  ] },
];
/** Sağ üstteki hesap menüsü */
const ACCOUNT: NavItem[] = [
  { href: '/settings', label: 'API Bağlantıları', icon: Settings },
  { href: '/stores', label: 'Mağazalarım', icon: Store },
  { href: '/account', label: 'Hesabım', icon: UserCog },
];
const ALL_ITEMS: NavItem[] = [...GROUPS.flatMap((g) => g.items ?? [{ href: g.href!, label: g.label, icon: g.icon }]), ...ACCOUNT];
const BARE = ['/orders/labels', '/login', '/setup', '/signup', '/forgot', '/reset', '/onboarding', '/invite', '/welcome', '/legal/terms', '/legal/privacy', '/legal/kvkk'];
const isActive = (path: string, n: { href: string; exact?: boolean }) =>
  n.href === '/' ? path === '/' : n.exact ? path === n.href : path.startsWith(n.href) && !(n.href === '/products' && path === '/products/new');

interface Status { accent?: string; user: { email: string; name: string; role?: string } | null; onboarded: boolean; companyName: string | null; demoMode: boolean }

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const bare = BARE.includes(path);
  const [status, setStatus] = useState<Status | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [path]);
  // Giriş yapınca tarayıcı sekmesinde de firmanın adı görünür
  useEffect(() => {
    if (!bare && status?.user) document.title = status.companyName || 'Mağazam';
  }, [bare, status, path]);

  useEffect(() => {
    if (bare) return;
    fetch('/api/auth/status').then((r) => r.json()).then((s: Status) => {
      setStatus(s);
      // Mağazanın rengi: tüm vurgu renkleri (düğmeler, seçili menü…) buna döner
      if (s.accent) for (const [k, v] of Object.entries(accentVars(s.accent))) document.documentElement.style.setProperty(k, v);
      if (!s.user) router.replace('/login');
      else if (!s.onboarded) router.replace('/onboarding');
    }).catch(() => {});
  }, [bare, router, status === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Panel açıkken 3 dakikada bir otomatik senkron (sipariş çekme + stok eşitleme)
  const ready = !bare && !!status?.user && !!status.onboarded;
  useEffect(() => {
    if (!ready) return;
    const tick = () => { if (document.visibilityState === 'visible') fetch('/api/sync', { method: 'POST' }).catch(() => {}); };
    // İlk senkron sayfa açıldıktan biraz sonra: açılışta sayfa verileriyle yarışıp yavaşlatmasın
    const first = setTimeout(tick, 20_000);
    const t = setInterval(tick, 180_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [ready]);

  if (bare) return <ToastProvider>{children}</ToastProvider>;
  if (!status?.user || !status.onboarded) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">Yükleniyor…</div>;
  }
  return (
    <ToastProvider>
      <RoleProvider value={roleOf(status)}>
      <LiveProvider>
        <div className="min-h-screen flex flex-col">
          <TopBar status={status} onMenu={() => setMenuOpen(true)} />
          {/* Telefon/tablet: soldan açılan menü */}
          {menuOpen && (
            <div className="lg:hidden fixed inset-0 z-50 flex">
              <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMenuOpen(false)} />
              <div className="relative h-full shadow-2xl fade-in"><Drawer status={status} onClose={() => setMenuOpen(false)} /></div>
            </div>
          )}
          {status.demoMode && (
            <div className="bg-amber-400 text-amber-950 text-xs sm:text-sm px-3 sm:px-6 py-1.5 flex items-center gap-2">
              <b>Deneme mağazası</b><span className="hidden sm:inline">— ürünler ve siparişler örnektir, hiçbir pazaryerine gönderilmez.</span>
              <DemoSimulate />
              <Link href="/account" className="ml-auto underline whitespace-nowrap">Kapat</Link>
            </div>
          )}
          <main className="flex-1 min-w-0 w-full max-w-[1440px] mx-auto p-3 sm:p-6 pb-24 lg:pb-8">{children}</main>
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
    { href: '/', label: 'Ana Sayfa', icon: LayoutDashboard },
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

const visibleFor = (role: Role) => (n: { href?: string }) => role !== 'staff' || !n.href || !STAFF_HIDDEN.includes(n.href);
const groupActive = (path: string, g: NavGroup) => (g.href ? isActive(path, { href: g.href, exact: g.exact }) : (g.items ?? []).some((i) => isActive(path, i)));

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

/** Tıklayınca açılan küçük menü; dışarı tıklayınca ve sayfa değişince kapanır */
function Dropdown({ button, children, align = 'left', className }: { button: (open: boolean) => ReactNode; children: ReactNode; align?: 'left' | 'right'; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const path = usePathname();
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, []);
  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((o) => !o)}>{button(open)}</div>
      {open && (
        <div role="menu" onClick={() => setOpen(false)} className={cx('absolute z-50 top-full mt-2 rounded-xl bg-white shadow-xl ring-1 ring-slate-200 p-1.5 fade-in', align === 'right' ? 'right-0' : 'left-0', className)}>
          {children}
        </div>
      )}
    </div>
  );
}

function MenuLink({ n, active }: { n: NavItem; active: boolean }) {
  const Icon = n.icon;
  return (
    <Link href={n.href} className={cx('flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-sm', active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50')}>
      <Icon className={cx('w-4 h-4 mt-0.5 shrink-0', active ? 'text-indigo-600' : 'text-slate-400')} />
      <span className="min-w-0"><span className="block font-medium leading-tight">{n.label}</span>{n.hint && <span className="block text-[11px] text-slate-400 leading-tight mt-0.5">{n.hint}</span>}</span>
    </Link>
  );
}

/** Üst çubuk: solda mağaza, ortada az sayıda ana başlık, sağda Yeni Ürün ve hesap menüsü */
function TopBar({ status, onMenu }: { status: Status; onMenu: () => void }) {
  const path = usePathname();
  const role = roleOf(status);
  const show = visibleFor(role);
  const title = path.startsWith('/products/') && path !== '/products/new' ? 'Ürün Detayı' : ALL_ITEMS.find((n) => isActive(path, n))?.label ?? '';
  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
      <div className="max-w-[1440px] mx-auto h-14 sm:h-16 px-3 sm:px-6 flex items-center gap-2 lg:gap-6">
        <button onClick={onMenu} className="lg:hidden p-2 -ml-1 rounded-lg hover:bg-slate-100" aria-label="Menüyü aç"><Menu className="w-5 h-5" /></button>
        <div className="hidden lg:flex shrink-0 w-60"><StoreSwitcher name={status.companyName || 'Mağazam'} /></div>
        <h1 className="lg:hidden text-base font-semibold truncate flex-1 min-w-0">{title}</h1>
        <nav className="hidden lg:flex items-center gap-1 flex-1 min-w-0">
          {GROUPS.map((g) => {
            const items = (g.items ?? []).filter(show);
            const active = groupActive(path, g);
            const cls = cx('flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors', active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900');
            if (g.href) return <Link key={g.label} href={g.href} className={cls}>{g.label}</Link>;
            if (!items.length) return null;
            return (
              <Dropdown key={g.label} className="w-72" button={(open) => (
                <button className={cls} aria-haspopup="menu" aria-expanded={open}>{g.label}<ChevronDown className={cx('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} /></button>
              )}>
                {items.map((n) => <MenuLink key={n.href} n={n} active={isActive(path, n)} />)}
              </Dropdown>
            );
          })}
        </nav>
        <div className="flex items-center gap-2 shrink-0">
          {path !== '/products/new' && <Link href="/products/new" className="hidden sm:inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700"><PlusCircle className="w-4 h-4" /> Yeni Ürün</Link>}
          <div className="hidden lg:block"><AccountMenu status={status} /></div>
        </div>
      </div>
    </header>
  );
}

function ConnectedInfo({ demo }: { demo: boolean }) {
  const { data } = useLiveData<{ credentials: Array<{ marketplace: string; mode: string }> }>('/api/credentials');
  const live = data?.credentials.filter((c) => c.mode === 'live') ?? [];
  return (
    <Link href="/settings" className="block px-2.5 py-2 text-xs text-slate-600 hover:bg-slate-50 rounded-lg">
      {live.length > 0 ? (
        <>
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500" />{live.length} pazaryeri bağlı</div>
          <div className="flex flex-wrap gap-1 mt-1.5">{live.map((c) => <MarketplaceBadge key={c.marketplace} name={c.marketplace} size="xs" />)}</div>
        </>
      ) : (
        <div className="flex items-center gap-2 text-amber-700"><span className="w-2 h-2 rounded-full bg-amber-400" />Henüz pazaryeri bağlı değil</div>
      )}
      {demo && <div className="text-[11px] text-amber-700 mt-1">Deneme mağazası — tüm pazaryerleri simülasyon</div>}
    </Link>
  );
}

/** API Bağlantıları, Mağazalarım, Hesabım ve çıkış tek yerde */
function AccountMenu({ status }: { status: Status }) {
  const path = usePathname();
  const show = visibleFor(roleOf(status));
  const u = status.user!;
  return (
    <Dropdown align="right" className="w-72" button={(open) => (
      <button className={cx('flex items-center gap-2 rounded-full pl-1 pr-2 py-1 hover:bg-slate-50', open && 'bg-slate-50')} aria-haspopup="menu" aria-expanded={open} title="Hesap ve ayarlar">
        <span className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold">{u.name.slice(0, 1).toUpperCase()}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>
    )}>
      <div className="px-2.5 py-2 border-b border-slate-100 mb-1">
        <div className="text-sm font-medium text-slate-800 truncate">{u.name}</div>
        <div className="text-[11px] text-slate-400 truncate">{u.email}</div>
      </div>
      {ACCOUNT.filter(show).map((n) => <MenuLink key={n.href} n={n} active={isActive(path, n)} />)}
      <div className="border-t border-slate-100 mt-1 pt-1"><ConnectedInfo demo={status.demoMode} /></div>
      <button onClick={logout} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-50"><LogOut className="w-4 h-4 text-slate-400" /> Çıkış yap</button>
    </Dropdown>
  );
}

/** Telefonda soldan açılan menü: aynı gruplar başlıklarıyla */
function Drawer({ status, onClose }: { status: Status; onClose: () => void }) {
  const path = usePathname();
  const show = visibleFor(roleOf(status));
  const sections: Array<{ title: string; items: NavItem[] }> = [
    { title: '', items: GROUPS.filter((g) => g.href).map((g) => ({ href: g.href!, label: g.label, icon: g.icon })) },
    ...GROUPS.filter((g) => g.items).map((g) => ({ title: g.label, items: g.items! })),
    { title: 'Hesap', items: ACCOUNT },
  ];
  return (
    <aside className="w-72 bg-white text-slate-600 flex flex-col h-full overflow-y-auto">
      <div className="px-4 py-4 border-b border-slate-100 flex items-center gap-3 bg-indigo-50/60">
        <StoreSwitcher name={status.companyName || 'Mağazam'} />
        <button onClick={onClose} className="ml-auto p-1.5 rounded hover:bg-slate-100" aria-label="Menüyü kapat"><X className="w-5 h-5" /></button>
      </div>
      <nav className="flex-1 p-3 space-y-3">
        {sections.map((sec) => {
          const items = sec.items.filter(show);
          if (!items.length) return null;
          return (
            <div key={sec.title || 'main'}>
              {sec.title && <div className="px-3 pb-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{sec.title}</div>}
              <div className="space-y-0.5">
                {items.map((n) => {
                  const active = isActive(path, n);
                  const Icon = n.icon;
                  return (
                    <Link key={n.href} href={n.href} className={cx('flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm', active ? 'bg-indigo-50 text-indigo-700 font-medium' : 'hover:bg-slate-50 hover:text-slate-900')}>
                      <Icon className={cx('w-4 h-4', active ? 'text-indigo-600' : 'text-slate-400')} />{n.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="p-3 border-t border-slate-100 space-y-1">
        <ConnectedInfo demo={status.demoMode} />
        <button onClick={logout} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm hover:bg-slate-50"><LogOut className="w-4 h-4 text-slate-400" /> Çıkış yap ({status.user!.name})</button>
      </div>
    </aside>
  );
}

/** Deneme mağazasında örnek sipariş üretme (yalnızca deneme şeridinde) */
function DemoSimulate() {
  const toast = useToast();
  const { bump } = useLive();
  const [mp, setMp] = useState<MarketplaceName>('trendyol');
  const [busy, setBusy] = useState(false);
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
    <span className="hidden md:flex items-center gap-1.5 ml-3">
      <select value={mp} onChange={(e) => setMp(e.target.value as MarketplaceName)} className="text-xs border border-amber-600/40 rounded px-1.5 py-0.5 bg-amber-50">
        {BASE_MARKETPLACES.map((m) => <option key={m} value={m}>{MARKETPLACE_META[m].label}</option>)}
      </select>
      <button onClick={simulate} disabled={busy} className="inline-flex items-center gap-1 text-xs font-medium bg-amber-950/10 hover:bg-amber-950/20 rounded px-2 py-0.5"><Zap className="w-3 h-3" />{busy ? 'Ekleniyor…' : 'Örnek sipariş ekle'}</button>
    </span>
  );
}
