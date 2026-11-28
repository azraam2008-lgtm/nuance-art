'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AlarmClock, AlertTriangle, ArrowRight, Boxes, ClipboardList, FileText, Inbox, PackagePlus, RotateCcw, Timer, Truck } from 'lucide-react';
import { MARKETPLACE_META, type OrderStatus } from '@/lib/marketplaces/meta';
import { useUnnamedTwins } from '@/components/useMarketplaces';
import { useLiveData } from '@/components/live';
import { Card, ErrorBox, MarketplaceBadge, PageLoader, ProductImage, StatusBadge, cx, fmtDate, tl2 } from '@/components/ui';

interface Dashboard {
  actions: { statusCounts: Record<string, number>; late: number; dueToday: number; returns30: number; invoiceMissing: number | null; criticalCount: number };
  health: { products: number; outOfStock: number; pending: number; errors: number; unsynced: number; jobsFailed?: number };
  critical: Array<{ id: string; sku: string; title: string; image_url: string | null; total_stock: number; low_stock_threshold: number }>;
  recent: Array<{
    id: string; external_order_id: string; marketplace_name: string; customer_name: string; total_amount: number; status: OrderStatus; order_date: string;
    cost: { deadline: string | null } | Array<{ deadline: string | null }> | null;
    items: Array<{ product_title: string; quantity: number; product: { image_url: string | null } | null }>;
  }>;
  top: Array<{ id: string; sku: string; title: string; image_url: string | null; total_stock: number; units: number; revenue: number }>;
}

const OPEN = ['new', 'approved', 'preparing', 'invoiced'];

/** Ana sayfa: Trendyol satıcı paneli gibi önce "yapılacaklar" — siparişler ve kritik stok. Ciro ve kâr Raporlar › Kârlılık'ta. */
export default function DashboardPage() {
  const { data, error, loading, reload } = useLiveData<Dashboard>('/api/dashboard');
  const unnamed = useUnnamedTwins();
  if (loading) return <PageLoader />;
  if (error || !data) return <ErrorBox error={error ?? 'Bilinmeyen hata'} onRetry={reload} />;
  const a = data.actions;
  const c = a.statusCounts;
  const h = data.health;
  const processing = (c.approved ?? 0) + (c.preparing ?? 0) + (c.invoiced ?? 0);

  const alerts = [
    (h.jobsFailed ?? 0) > 0 && { href: '/operations', text: `${h.jobsFailed} işlem pazaryerine gönderilemedi — İşlem Merkezi'nde nedenini görün.` },
    h.unsynced + h.errors > 0 && { href: '/stock', text: `${h.unsynced + h.errors} ilanda stok/yayın sorunu var — Stok sayfasından "Tümünü eşitle".` },
    h.pending > 0 && { href: '/products', text: `${h.pending} ilan pazaryeri onayı bekliyor.` },
    ...unnamed.map((m) => ({ href: '/settings', text: `${MARKETPLACE_META[m].label}'da iki mağazanız var — ikisine de adını verin (API Bağlantıları).` })),
  ].filter(Boolean) as Array<{ href: string; text: string }>;

  return (
    <div className="space-y-5 sm:space-y-6 fade-in">
      {h.products === 0 && (
        <Card className="p-5 sm:p-6 flex flex-wrap items-center gap-4 bg-gradient-to-r from-indigo-700 to-indigo-500 text-white border-0">
          <PackagePlus className="w-8 h-8 text-amber-300" />
          <div className="flex-1 min-w-[220px]"><div className="font-semibold">Ürünlerinizi panele alın</div><div className="text-sm text-white/80">Pazaryerlerinde zaten ürünleriniz varsa tek tuşla hepsini çekin; aynı ürünler birleştirilir.</div></div>
          <Link href="/products?catalog=1" className="rounded-lg bg-amber-400 text-slate-900 font-medium px-4 py-2 text-sm">Pazaryerlerinden çek</Link>
          <Link href="/products/new" className="rounded-lg border border-white/50 text-white font-medium px-4 py-2 text-sm">Yeni Ürün Ekle</Link>
        </Card>
      )}

      {/* Aksiyonlar */}
      <section>
        <SectionTitle title="Aksiyonlar" hint="Bugün ilgilenmeniz gerekenler" />
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <Action href="/orders?tab=new" icon={<Inbox className="w-5 h-5" />} label="Yeni Siparişler" value={c.new ?? 0} tone="indigo" />
          <Action href="/orders?tab=processing" icon={<ClipboardList className="w-5 h-5" />} label="İşleme Alınanlar" value={processing} tone="sky" />
          <Action href="/orders?deadline=today" icon={<Timer className="w-5 h-5" />} label="Bugün Kargolanmalı" value={a.dueToday} tone="amber" />
          <Action href="/orders?deadline=late" icon={<AlarmClock className="w-5 h-5" />} label="Kargo Süresi Geçen" value={a.late} tone="rose" />
          {a.invoiceMissing !== null
            ? <Action href="/orders?invoice=missing" icon={<FileText className="w-5 h-5" />} label="Kesilmesi Gereken Fatura" value={a.invoiceMissing} tone="violet" />
            : <Action href="/orders?tab=shipped" icon={<Truck className="w-5 h-5" />} label="Kargodaki Siparişler" value={c.shipped ?? 0} tone="violet" />}
          <Action href="/orders?tab=closed" icon={<RotateCcw className="w-5 h-5" />} label="İadeler (30 gün)" value={a.returns30} tone="fuchsia" />
        </div>
      </section>

      {(alerts.length > 0 || h.outOfStock > 0) && (
        <div className="flex flex-wrap gap-2">
          {h.outOfStock > 0 && <Link href="/stock" className="inline-flex items-center gap-1.5 text-xs sm:text-sm rounded-full bg-rose-50 border border-rose-200 text-rose-800 px-3 py-1.5"><AlertTriangle className="w-3.5 h-3.5" />{h.outOfStock} ürün tükendi</Link>}
          {alerts.map((x) => <Link key={x.text} href={x.href} className="inline-flex items-center gap-1.5 text-xs sm:text-sm rounded-full bg-amber-50 border border-amber-200 text-amber-800 px-3 py-1.5"><AlertTriangle className="w-3.5 h-3.5" />{x.text}</Link>)}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        {/* Son siparişler */}
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHead title="Son Siparişler" href="/orders" link="Tüm siparişler" />
          {!data.recent.length && <p className="px-5 py-10 text-sm text-slate-500 text-center">Henüz sipariş yok.</p>}
          <ul className="divide-y divide-slate-100">
            {data.recent.map((o) => {
              const first = o.items[0];
              const deadline = (Array.isArray(o.cost) ? o.cost[0] : o.cost)?.deadline;
              const left = OPEN.includes(o.status) && deadline ? leftText(deadline) : null;
              return (
                <li key={o.id}>
                  <Link href={`/orders?orderNo=${encodeURIComponent(o.external_order_id.split('/')[0])}`} className="flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-slate-50">
                    <Thumb src={first?.product?.image_url} more={o.items.length - 1} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <MarketplaceBadge name={o.marketplace_name} size="xs" />
                        <span className="text-[11px] text-slate-400 font-mono truncate">#{o.external_order_id.split('/')[0]}</span>
                      </div>
                      <div className="text-sm font-medium text-slate-800 line-clamp-2 mt-0.5">{first ? `${first.quantity > 1 ? `${first.quantity}× ` : ''}${first.product_title}` : '—'}</div>
                      <div className="text-[11px] text-slate-400 truncate">{o.customer_name} · {fmtDate(o.order_date)}</div>
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      <div className="text-sm font-semibold tabular-nums">{tl2(o.total_amount)}</div>
                      {left ? <span className={cx('inline-block text-[10px] font-medium rounded-full px-1.5 py-0.5', left.cls)}>{left.text}</span> : <StatusBadge status={o.status} />}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        {/* Kritik stok */}
        <Card className="overflow-hidden">
          <CardHead title={`Kritik Stok${a.criticalCount ? ` (${a.criticalCount})` : ''}`} href="/stock" link="Stok" />
          {!data.critical.length && <p className="px-5 py-10 text-sm text-emerald-700 text-center">Kritik seviyede ürün yok. 👍</p>}
          <ul className="divide-y divide-slate-100">
            {data.critical.map((p) => (
              <li key={p.id}>
                <Link href={`/products/${p.id}`} className="flex items-center gap-3 px-4 sm:px-5 py-2.5 hover:bg-slate-50">
                  <Thumb src={p.image_url} small />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{p.title}</div>
                    <div className="text-[11px] text-slate-400 font-mono truncate">{p.sku} · eşik {p.low_stock_threshold}</div>
                  </div>
                  <span className={cx('text-xs font-bold rounded-full px-2 py-0.5', p.total_stock <= 0 ? 'bg-rose-600 text-white' : 'bg-amber-100 text-amber-800')}>{p.total_stock <= 0 ? 'Tükendi' : p.total_stock}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Ürün performansım */}
      <section>
        <SectionTitle title="Ürün Performansım" hint="Son 30 günde en çok satanlar" href="/products" link="Ürünler" />
        {!data.top.length ? (
          <Card className="px-5 py-8 text-sm text-slate-500 text-center">Son 30 günde satış yok.</Card>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {data.top.map((p, i) => (
              <Link key={p.id} href={`/products/${p.id}`} className="group bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-md transition-shadow">
                <div className="relative">
                  <ProductImage src={p.image_url} px={400} className="aspect-[3/4] w-full" />
                  <span className="absolute top-2 left-2 w-6 h-6 rounded-full bg-white/90 text-slate-800 text-xs font-bold flex items-center justify-center shadow-sm">{i + 1}</span>
                </div>
                <div className="p-2.5">
                  <div className="text-xs font-medium text-slate-800 line-clamp-2 min-h-[2rem]">{p.title}</div>
                  <div className="flex items-center justify-between mt-1.5 text-[11px]">
                    <span className="text-indigo-700 font-semibold">{p.units} satış</span>
                    <span className={cx('inline-flex items-center gap-0.5', p.total_stock <= 0 ? 'text-rose-600' : 'text-slate-500')}><Boxes className="w-3 h-3" />{p.total_stock}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function leftText(deadline: string): { text: string; cls: string } {
  const ms = new Date(deadline).getTime() - Date.now();
  const hours = Math.floor(Math.abs(ms) / 3_600_000);
  const span = hours >= 24 ? `${Math.floor(hours / 24)} gün ${hours % 24} sa` : `${Math.max(1, hours)} sa`;
  if (ms < 0) return { text: `${span} gecikti`, cls: 'bg-rose-100 text-rose-700' };
  return { text: `${span} kaldı`, cls: ms < 24 * 3_600_000 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700' };
}

const TONES = {
  indigo: 'bg-indigo-50 text-indigo-600',
  sky: 'bg-sky-50 text-sky-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  violet: 'bg-violet-50 text-violet-600',
  fuchsia: 'bg-fuchsia-50 text-fuchsia-600',
};

function Action({ href, icon, label, value, tone }: { href: string; icon: ReactNode; label: string; value: number; tone: keyof typeof TONES }) {
  const urgent = value > 0 && tone === 'rose';
  return (
    <Link href={href} className={cx('group bg-white rounded-xl border p-3 sm:p-4 flex flex-col gap-2 hover:shadow-md hover:-translate-y-0.5 transition-all', urgent ? 'border-rose-300' : 'border-slate-200')}>
      <div className="flex items-center justify-between">
        <span className={cx('w-9 h-9 rounded-lg flex items-center justify-center', TONES[tone])}>{icon}</span>
        <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500" />
      </div>
      <div className={cx('text-2xl font-bold tabular-nums', urgent ? 'text-rose-600' : value ? 'text-slate-900' : 'text-slate-300')}>{value.toLocaleString('tr-TR')}</div>
      <div className="text-xs sm:text-sm text-slate-600 leading-tight">{label}</div>
    </Link>
  );
}

function SectionTitle({ title, hint, href, link }: { title: string; hint?: string; href?: string; link?: string }) {
  return (
    <div className="flex items-end justify-between gap-2 mb-2.5">
      <div><h2 className="font-semibold text-slate-900">{title}</h2>{hint && <p className="text-xs text-slate-500">{hint}</p>}</div>
      {href && <Link href={href} className="text-sm text-indigo-600 whitespace-nowrap">{link} →</Link>}
    </div>
  );
}

function CardHead({ title, href, link }: { title: string; href: string; link: string }) {
  return (
    <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
      <h3 className="font-semibold">{title}</h3>
      <Link href={href} className="text-sm text-indigo-600">{link} →</Link>
    </div>
  );
}

function Thumb({ src, more = 0, small }: { src?: string | null; more?: number; small?: boolean }) {
  return (
    <span className="relative shrink-0">
      <ProductImage src={src} px={small ? 160 : 240} className={cx('rounded-lg border border-slate-200', small ? 'w-14 h-[72px]' : 'w-[72px] h-24')} />
      {more > 0 && <span className="absolute bottom-0 right-0 bg-slate-900/70 text-white text-[10px] font-semibold px-1 rounded-tl rounded-br-lg">+{more}</span>}
    </span>
  );
}
