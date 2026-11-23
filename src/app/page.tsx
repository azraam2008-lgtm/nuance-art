'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, PackagePlus, PiggyBank, ShoppingCart, Trophy, Wallet } from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { MARKETPLACES, MARKETPLACE_META, type MarketplaceName, type OrderStatus } from '@/lib/marketplaces/meta';
import { useLiveData } from '@/components/live';
import { Card, ErrorBox, MarketplaceBadge, PageLoader, StatusBadge, cx, fmtDate, tl, tl2 } from '@/components/ui';

interface Dashboard {
  health: { products: number; outOfStock: number; pending: number; errors: number; unsynced: number };
  kpis: { monthRevenue: number; monthOrders: number; topMarketplace: MarketplaceName | null; topMarketplaceRevenue: number; criticalCount: number; monthNetProfit: number; monthEstimates: number };
  distribution: Array<{ marketplace: MarketplaceName; revenue: number; share: number }>;
  monthly: Array<Record<string, number | string>>;
  daily: Array<Record<string, number | string>>;
  critical: Array<{ id: string; sku: string; title: string; total_stock: number; low_stock_threshold: number }>;
  recent: Array<{ id: string; external_order_id: string; marketplace_name: string; customer_name: string; total_amount: number; status: OrderStatus; order_date: string; items: Array<{ product_title: string; quantity: number }> }>;
}

const compact = (v: number) => new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 1 }).format(v) + ' ₺';

export default function DashboardPage() {
  const { data, error, loading, reload } = useLiveData<Dashboard>('/api/dashboard');
  const [range, setRange] = useState<'monthly' | 'daily'>('monthly');
  if (loading) return <PageLoader />;
  if (error || !data) return <ErrorBox error={error ?? 'Bilinmeyen hata'} onRetry={reload} />;
  const { kpis } = data;
  const monthName = new Date().toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });

  const h = data.health;
  // Yalnızca satışı olan pazaryerleri grafikte gösterilir
  const active = MARKETPLACES.filter((m) => [...data.monthly, ...data.daily].some((r) => Number(r[m] ?? 0) > 0));
  const dist = data.distribution.filter((d) => d.revenue > 0);
  const alerts = [
    h.outOfStock > 0 && { href: '/stock', cls: 'bg-rose-50 text-rose-800 border-rose-200', text: `${h.outOfStock} ürün tükendi — tüm pazaryerlerinde stok 0.` },
    h.unsynced + h.errors > 0 && { href: '/stock', cls: 'bg-rose-50 text-rose-800 border-rose-200', text: `${h.unsynced + h.errors} ilanda stok/yayın sorunu var — Stok sayfasından "Tümünü eşitle".` },
    h.pending > 0 && { href: '/products', cls: 'bg-amber-50 text-amber-800 border-amber-200', text: `${h.pending} ilan pazaryeri onayı bekliyor (otomatik kontrol ediliyor).` },
  ].filter(Boolean) as Array<{ href: string; cls: string; text: string }>;

  return (
    <div className="space-y-4 sm:space-y-6 fade-in">
      {h.products === 0 && (
        <Card className="p-6 flex flex-wrap items-center gap-4 bg-gradient-to-r from-slate-900 to-slate-800 text-white">
          <PackagePlus className="w-8 h-8 text-amber-300" />
          <div className="flex-1"><div className="font-semibold">İlk ürününüzü ekleyin</div><div className="text-sm text-slate-300">Fotoğraf, açıklama ve fiyatı bir kez girin; bağlı tüm pazaryerlerine aynı sırayla gönderilsin. Kâr ve kesintiler otomatik hesaplanır.</div></div>
          <Link href="/products/new" className="rounded-lg bg-amber-400 text-slate-900 font-medium px-4 py-2 text-sm">Yeni Ürün Ekle</Link>
        </Card>
      )}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a) => <Link key={a.text} href={a.href} className={cx('flex items-center gap-2 border rounded-xl px-4 py-2.5 text-sm', a.cls)}><AlertTriangle className="w-4 h-4" />{a.text}</Link>)}
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <Kpi icon={<Wallet className="w-4 h-4" />} accent="bg-indigo-50 text-indigo-600" label="Bu Ayki Toplam Ciro" value={tl(kpis.monthRevenue)} sub={monthName} />
        <Link href="/profit" className="block h-full"><Kpi icon={<PiggyBank className="w-4 h-4" />} accent={kpis.monthNetProfit < 0 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'} label="Bu Ayki Net Kâr"
          value={tl(kpis.monthNetProfit)} sub={kpis.monthRevenue ? `Marj ~%${((kpis.monthNetProfit / (kpis.monthRevenue / 1.2)) * 100).toFixed(1)} · ${kpis.monthEstimates} tahmini` : 'Komisyon, kargo, bedeller sonrası'} /></Link>
        <Kpi icon={<ShoppingCart className="w-4 h-4" />} accent="bg-blue-50 text-blue-600" label="Toplam Sipariş Sayısı" value={kpis.monthOrders.toLocaleString('tr-TR')} sub="Bu ay, iptaller hariç" />
        <Kpi icon={<Trophy className="w-4 h-4" />} accent="bg-orange-50 text-orange-600" label="En Çok Satan Pazaryeri"
          value={kpis.topMarketplace ? MARKETPLACE_META[kpis.topMarketplace].label : '—'} sub={kpis.topMarketplace ? `${tl(kpis.topMarketplaceRevenue)} bu ay` : 'Bu ay satış yok'} />
        <Kpi wide icon={<AlertTriangle className="w-4 h-4" />} accent={kpis.criticalCount ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}
          label="Kritik Stoktaki Ürün" value={String(kpis.criticalCount)} sub={kpis.criticalCount ? 'Eşik altında — tedarik gerekli' : 'Tüm ürünler güvende'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="font-semibold">Ciro Trendi (Pazaryeri Kırılımlı)</h3>
            <div className="inline-flex bg-slate-100 rounded-lg p-0.5 text-xs">
              {(['monthly', 'daily'] as const).map((r) => (
                <button key={r} onClick={() => setRange(r)} className={cx('px-3 py-1 rounded-md', range === r && 'bg-white shadow-sm')}>
                  {r === 'monthly' ? 'Aylık (12 ay)' : 'Günlük (30 gün)'}
                </button>
              ))}
            </div>
          </div>
          <div className="h-60 sm:h-72">
            <ResponsiveContainer width="100%" height="100%">
              {range === 'monthly' ? (
                <BarChart data={data.monthly}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} width={56} />
                  <Tooltip formatter={(v: number, n: string) => [tl2(v), MARKETPLACE_META[n as MarketplaceName]?.label ?? n]} />
                  <Legend formatter={(v: string) => MARKETPLACE_META[v as MarketplaceName]?.label ?? v} wrapperStyle={{ fontSize: 12 }} />
                  {active.map((m) => <Bar key={m} dataKey={m} stackId="a" fill={MARKETPLACE_META[m].color} />)}
                </BarChart>
              ) : (
                <LineChart data={data.daily}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={3} />
                  <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} width={56} />
                  <Tooltip formatter={(v: number, n: string) => [tl2(v), MARKETPLACE_META[n as MarketplaceName]?.label ?? n]} />
                  <Legend formatter={(v: string) => MARKETPLACE_META[v as MarketplaceName]?.label ?? v} wrapperStyle={{ fontSize: 12 }} />
                  {active.map((m) => <Line key={m} type="monotone" dataKey={m} stroke={MARKETPLACE_META[m].color} strokeWidth={2} dot={false} />)}
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold mb-3">Ciro Dağılımı (Bu Ay)</h3>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={dist} dataKey="revenue" nameKey="marketplace" innerRadius="60%" outerRadius="90%" paddingAngle={2}>
                  {dist.map((d) => <Cell key={d.marketplace} fill={MARKETPLACE_META[d.marketplace].color} />)}
                </Pie>
                <Tooltip formatter={(v: number, n: string) => [tl2(v), MARKETPLACE_META[n as MarketplaceName]?.label ?? n]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-4 space-y-1.5 text-sm">
            {!dist.length && <p className="text-sm text-slate-500 text-center">Bu ay henüz satış yok.</p>}
            {dist.map((d) => (
              <li key={d.marketplace} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: MARKETPLACE_META[d.marketplace].color }} />
                <span className="flex-1">{MARKETPLACE_META[d.marketplace].label}</span>
                <span className="text-slate-500">{tl(d.revenue)}</span>
                <span className="w-14 text-right font-medium">%{(d.share * 100).toFixed(1)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold">Son Siparişler</h3>
            <Link href="/orders" className="text-sm text-indigo-600">Tümünü gör →</Link>
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {data.recent.map((o) => (
              <li key={o.id}>
                <Link href="/orders" className="flex items-center gap-3 px-4 sm:px-5 py-2.5 hover:bg-slate-50">
                  <MarketplaceBadge name={o.marketplace_name} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{o.customer_name}</div>
                    <div className="text-xs text-slate-500 truncate">{o.items.map((i) => `${i.quantity}x ${i.product_title}`).join(', ')}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-medium tabular-nums">{tl2(o.total_amount)}</div>
                    <div className="text-[11px] text-slate-500 whitespace-nowrap sm:hidden">{new Date(o.order_date).toLocaleDateString('tr-TR')}</div>
                  </div>
                  <span className="shrink-0"><StatusBadge status={o.status} /></span>
                  <span className="hidden sm:block text-xs text-slate-500 whitespace-nowrap w-28 text-right">{fmtDate(o.order_date)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold">Kritik Stok</h3>
            <Link href="/stock" className="text-sm text-indigo-600">Stok havuzu →</Link>
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {!data.critical.length && <li className="px-5 py-6 text-slate-500 text-center">Kritik seviyede ürün yok.</li>}
            {data.critical.map((p) => (
              <li key={p.id} className="px-5 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0"><div className="truncate">{p.title}</div><div className="text-xs text-slate-500 font-mono">{p.sku} · eşik {p.low_stock_threshold}</div></div>
                <span className="bg-rose-600 text-white text-xs font-bold rounded-full px-2 py-0.5">{p.total_stock}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ icon, accent, label, value, sub, wide }: { icon: React.ReactNode; accent: string; label: string; value: string; sub: string; wide?: boolean }) {
  return (
    <Card className={cx('p-3 sm:p-5 h-full', wide && 'col-span-2 lg:col-span-1')}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs sm:text-sm text-slate-500 leading-tight">{label}</span>
        <span className={cx('w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center shrink-0', accent)}>{icon}</span>
      </div>
      <div className="text-lg sm:text-2xl font-bold mt-1 sm:mt-2 truncate">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{sub}</div>
    </Card>
  );
}
