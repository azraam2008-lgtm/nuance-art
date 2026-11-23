'use client';
import Link from 'next/link';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Lightbulb, PackageX, RotateCcw, Timer, TrendingDown, Trophy, Users } from 'lucide-react';
import { useLiveData } from '@/components/live';
import { Card, Empty, ErrorBox, MarketplaceBadge, PageLoader, cx, tl, tl2 } from '@/components/ui';
import { variantText } from '@/components/product-shared';

type V = Record<string, string> | null;
interface Data {
  actions: Array<{ level: 'high' | 'medium' | 'info'; text: string; href: string }>;
  forecast: Array<{ id: string; sku: string; title: string; variant: V; stock: number; perDay: number; daysLeft: number | null; suggest: number }>;
  trend: { totalCurrent: number; totalPrevious: number; totalChange: number;
    rising: Array<{ id: string; sku: string; title: string; variant: V; current: number; previous: number; change: number }>;
    falling: Array<{ id: string; sku: string; title: string; variant: V; current: number; previous: number; change: number }>;
    stale: Array<{ id: string; sku: string; title: string; variant: V; stock: number }> };
  economics: { losing: Econ[]; thin: Econ[]; best: Econ[]; highReturn: Econ[]; reasons: Array<{ reason: string; count: number }>; returnRate: number };
  comparison: { marketplaces: Array<{ marketplace: string; orders: number; netProfit: number; revenue: number; returns: number; margin: number }>; customers: number; repeatCustomers: number; repeatRate: number };
}
interface Econ { id: string | null; sku: string; title: string; units: number; orders: number; returns: number; netProfit: number; revenue: number; margin: number; returnRate: number; reasons: Record<string, number> }

const pct = (x: number) => `%${(x * 100).toFixed(0)}`;
const Name = ({ id, title, sku, variant }: { id: string | null; title: string; sku: string; variant?: V }) => (
  <div className="min-w-0">
    {id ? <Link href={`/products/${id}`} className="font-medium hover:text-indigo-700 line-clamp-1">{title}</Link> : <div className="font-medium line-clamp-1">{title}</div>}
    <div className="text-[11px] text-slate-500 font-mono">{sku}{variantText(variant) ? ` · ${variantText(variant)}` : ''}</div>
  </div>
);

/** İşletme önerileri: veriye dayalı uyarılar ve analizler (yapay zekâ kullanmaz, maliyetsizdir) */
export default function InsightsPage() {
  const { data, error, loading, reload } = useLiveData<Data>('/api/insights');
  if (loading) return <PageLoader />;
  if (error || !data) return <ErrorBox error={error ?? ''} onRetry={reload} />;
  const { actions, forecast, trend, economics, comparison } = data;

  return (
    <div className="space-y-4 fade-in max-w-6xl">
      <Card className="p-4 sm:p-5">
        <h2 className="font-semibold flex items-center gap-2 mb-3"><Lightbulb className="w-4 h-4 text-amber-500" /> Bugün yapılacaklar</h2>
        {!actions.length ? <p className="text-sm text-slate-500">Şu an acil bir durum yok. 👍 Satış verisi biriktikçe öneriler burada görünür.</p> : (
          <ul className="space-y-2">
            {actions.map((a, i) => (
              <li key={i}>
                <a href={a.href} className={cx('flex items-start gap-2 rounded-lg border px-3 py-2 text-sm', a.level === 'high' ? 'bg-rose-50 border-rose-200 text-rose-900' : a.level === 'medium' ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-slate-50 border-slate-200 text-slate-700')}>
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{a.text}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 sm:p-5" >
          <h3 id="stok" className="font-semibold flex items-center gap-2 mb-1"><Timer className="w-4 h-4" /> Stok tükenme tahmini</h3>
          <p className="text-xs text-slate-500 mb-3">Son 30 günün satış hızına göre stoğu 3 hafta içinde bitecek ürünler ve 3 haftalık ihtiyaç için önerilen üretim/tedarik.</p>
          {!forecast.length ? <Empty>3 hafta içinde bitecek ürün yok.</Empty> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {forecast.map((f) => (
                <li key={f.id} className="py-2 flex items-center gap-3">
                  <Name {...f} />
                  <div className="ml-auto text-right shrink-0">
                    <div className={cx('font-semibold', (f.daysLeft ?? 99) <= 7 ? 'text-rose-600' : 'text-amber-600')}>{f.daysLeft === 0 ? 'Tükendi' : `~${f.daysLeft} gün`}</div>
                    <div className="text-[11px] text-slate-500">stok {f.stock} · günde {f.perDay}{f.suggest ? ` · +${f.suggest} öner.` : ''}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4 sm:p-5">
          <h3 id="trend" className="font-semibold flex items-center gap-2 mb-1">{trend.totalChange >= 0 ? <ArrowUpRight className="w-4 h-4 text-emerald-600" /> : <ArrowDownRight className="w-4 h-4 text-rose-600" />} Satış trendi</h3>
          <p className="text-xs text-slate-500 mb-3">Son 30 gün: <b>{trend.totalCurrent} adet</b> · önceki 30 gün: {trend.totalPrevious} adet{trend.totalPrevious ? ` (${trend.totalChange >= 0 ? '+' : ''}${pct(trend.totalChange)})` : ''}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs font-medium text-emerald-700 mb-1">Yükselenler</div>
              {!trend.rising.length ? <p className="text-xs text-slate-400">—</p> : trend.rising.map((r) => (
                <div key={r.id} className="flex items-center gap-2 py-1"><Name {...r} /><span className="ml-auto text-xs text-emerald-700 whitespace-nowrap">{r.previous}→{r.current}</span></div>
              ))}
            </div>
            <div>
              <div className="text-xs font-medium text-rose-700 mb-1">Düşenler</div>
              {!trend.falling.length ? <p className="text-xs text-slate-400">—</p> : trend.falling.map((r) => (
                <div key={r.id} className="flex items-center gap-2 py-1"><Name {...r} /><span className="ml-auto text-xs text-rose-700 whitespace-nowrap">{r.previous}→{r.current}</span></div>
              ))}
            </div>
          </div>
          {trend.stale.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <div className="text-xs font-medium text-slate-600 mb-1 flex items-center gap-1"><PackageX className="w-3.5 h-3.5" /> 60 gündür satmayan stoklu ürünler</div>
              <div className="flex flex-wrap gap-1.5">{trend.stale.map((s) => <Link key={s.id} href={`/products/${s.id}`} className="text-[11px] bg-slate-100 rounded px-2 py-0.5 hover:bg-slate-200">{s.sku} ({s.stock})</Link>)}</div>
            </div>
          )}
        </Card>

        <Card className="p-4 sm:p-5">
          <h3 id="kar" className="font-semibold flex items-center gap-2 mb-1"><TrendingDown className="w-4 h-4 text-rose-600" /> Zarar eden ve düşük kârlı ürünler</h3>
          <p className="text-xs text-slate-500 mb-3">Son 90 gün; komisyon, kargo, bedeller, ürün maliyeti ve iadeler dahil.</p>
          {!economics.losing.length && !economics.thin.length ? <Empty>Zarar eden ürün yok. 👍</Empty> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {[...economics.losing, ...economics.thin].map((r) => (
                <li key={r.sku} className="py-2 flex items-center gap-3">
                  <Name id={r.id} title={r.title} sku={r.sku} />
                  <div className="ml-auto text-right shrink-0">
                    <div className={cx('font-semibold tabular-nums', r.netProfit < 0 ? 'text-rose-600' : 'text-amber-600')}>{tl2(r.netProfit)}</div>
                    <div className="text-[11px] text-slate-500">{r.units} adet · marj {pct(r.margin)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4 sm:p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-3"><Trophy className="w-4 h-4 text-amber-500" /> En çok kazandıranlar (90 gün)</h3>
          {!economics.best.length ? <Empty>Henüz yeterli satış yok.</Empty> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {economics.best.map((r) => (
                <li key={r.sku} className="py-2 flex items-center gap-3">
                  <Name id={r.id} title={r.title} sku={r.sku} />
                  <div className="ml-auto text-right shrink-0"><div className="font-semibold text-emerald-700 tabular-nums">{tl2(r.netProfit)}</div><div className="text-[11px] text-slate-500">{r.units} adet · marj {pct(r.margin)}</div></div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4 sm:p-5">
          <h3 id="iade" className="font-semibold flex items-center gap-2 mb-1"><RotateCcw className="w-4 h-4" /> İade analizi</h3>
          <p className="text-xs text-slate-500 mb-3">Son 90 gün iade oranı: <b>{pct(economics.returnRate)}</b></p>
          {economics.reasons.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {economics.reasons.map((r) => {
                const max = economics.reasons[0].count;
                return (
                  <div key={r.reason} className="flex items-center gap-2 text-xs">
                    <span className="w-40 shrink-0 truncate">{r.reason}</span>
                    <div className="flex-1 h-2 bg-slate-100 rounded"><div className="h-2 bg-fuchsia-400 rounded" style={{ width: `${(r.count / max) * 100}%` }} /></div>
                    <span className="w-6 text-right">{r.count}</span>
                  </div>
                );
              })}
            </div>
          )}
          {!economics.highReturn.length ? <p className="text-sm text-slate-500">İade oranı yüksek ürün yok.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {economics.highReturn.map((r) => (
                <li key={r.sku} className="py-2 flex items-center gap-3">
                  <Name id={r.id} title={r.title} sku={r.sku} />
                  <div className="ml-auto text-right shrink-0"><div className="font-semibold text-fuchsia-700">{pct(r.returnRate)}</div><div className="text-[11px] text-slate-500">{r.returns}/{r.orders} sipariş</div></div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4 sm:p-5">
          <h3 id="pazaryeri" className="font-semibold flex items-center gap-2 mb-1"><Users className="w-4 h-4" /> Pazaryerleri ve müşteriler (90 gün)</h3>
          <p className="text-xs text-slate-500 mb-3">{comparison.customers} müşteri · {comparison.repeatCustomers} tekrar alan ({pct(comparison.repeatRate)}). Müşteriler isimle eşleştirilir; yaklaşık bir değerdir.</p>
          {!comparison.marketplaces.length ? <Empty>Henüz sipariş yok.</Empty> : (
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500"><tr><th className="text-left py-1">Pazaryeri</th><th className="text-right">Sipariş</th><th className="text-right">Net kâr</th><th className="text-right">Marj</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {comparison.marketplaces.map((m) => (
                  <tr key={m.marketplace}>
                    <td className="py-1.5"><MarketplaceBadge name={m.marketplace} size="xs" /></td>
                    <td className="text-right">{m.orders}</td>
                    <td className={cx('text-right tabular-nums font-medium', m.netProfit < 0 ? 'text-rose-600' : 'text-emerald-700')}>{tl(m.netProfit)}</td>
                    <td className="text-right">{pct(m.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
