'use client';
import { useMemo, useState } from 'react';
import { AlertTriangle, Clock, TrendingDown, TrendingUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MARKETPLACES, MARKETPLACE_META, type MarketplaceName } from '@/lib/marketplaces/meta';
import { useLiveData } from '@/components/live';
import { Card, ErrorBox, MarketplaceBadge, PageLoader, cx, fmtDate, inputClass, tl, tl2 } from '@/components/ui';
import CostBreakdown from '@/components/CostBreakdown';

type Agg = { revenue_gross: number; revenue_net: number; commission: number; fees: number; shipping: number; tax: number; product_cost: number; other: number; net_profit: number; orders: number; cancelled: number; estimates: number };
interface Report {
  range: { from: string; to: string };
  total: Agg;
  byMarketplace: Record<string, Agg>;
  products: Array<{ sku: string; title: string; units: number; revenue_net: number; net_profit: number; orders: number }>;
  losses: Array<{ id: string; external_order_id: string; marketplace: string; date: string; net_profit: number; revenue_gross: number; reason: string }>;
  missed: { sameDay: number; fast: number; extraCost: number; orders: Array<{ id: string; external_order_id: string; marketplace: string; date: string; kind: string }> };
  uncomputed: number;
  ads?: { totalNet: number; byMarketplace: Record<string, number>; profitAfterAds: number };
}

const iso = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
function preset(p: string): [string, string] {
  const now = new Date();
  const ist = new Date(now.getTime() + 3 * 3600_000);
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth();
  if (p === 'this_month') return [`${y}-${String(m + 1).padStart(2, '0')}-01`, iso(now)];
  if (p === 'last_month') { const s = new Date(Date.UTC(y, m - 1, 1)); const e = new Date(Date.UTC(y, m, 0)); return [s.toISOString().slice(0, 10), e.toISOString().slice(0, 10)]; }
  const days = p === 'last_7' ? 7 : p === 'last_30' ? 30 : p === 'last_90' ? 90 : 365;
  return [iso(new Date(now.getTime() - (days - 1) * 86_400_000)), iso(now)];
}

const COLORS = { commission: '#6366F1', fees: '#A855F7', shipping: '#F59E0B', tax: '#64748B', product_cost: '#94A3B8', net_profit: '#10B981' };
const LABELS: Record<string, string> = { commission: 'Komisyon', fees: 'Platform bedelleri', shipping: 'Kargo', tax: 'Stopaj', product_cost: 'Ürün maliyeti', other: 'Reklam/risk', net_profit: 'Net kâr' };

export default function ProfitPage() {
  const [p, setP] = useState('this_month');
  const [mp, setMp] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const [from, to] = useMemo(() => preset(p), [p]);
  const { data, error, loading, reload } = useLiveData<Report>(`/api/profit?from=${from}&to=${to}${mp ? `&marketplace=${mp}` : ''}`);

  const chart = useMemo(() => data ? Object.entries(data.byMarketplace).map(([k, v]) => ({
    name: MARKETPLACE_META[k as MarketplaceName]?.label ?? k, commission: v.commission, fees: v.fees, shipping: v.shipping, tax: v.tax, product_cost: v.product_cost, net_profit: Math.max(0, v.net_profit),
  })) : [], [data]);

  return (
    <div className="space-y-6 fade-in">
      <CostBreakdown orderId={detail} onClose={() => setDetail(null)} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex bg-white border border-slate-200 rounded-lg p-0.5 text-sm">
          {[['this_month', 'Bu ay'], ['last_month', 'Geçen ay'], ['last_7', '7 gün'], ['last_30', '30 gün'], ['last_90', '90 gün'], ['last_365', '1 yıl']].map(([k, l]) => (
            <button key={k} onClick={() => setP(k)} className={cx('px-3 py-1.5 rounded-md', p === k && 'bg-indigo-600 text-white')}>{l}</button>
          ))}
        </div>
        <select className={`${inputClass} !w-auto`} value={mp} onChange={(e) => setMp(e.target.value)}>
          <option value="">Tüm pazaryerleri</option>
          {MARKETPLACES.map((m) => <option key={m} value={m}>{MARKETPLACE_META[m].label}</option>)}
        </select>
        <span className="text-xs text-slate-500">{from} — {to}</span>
      </div>

      {loading ? <PageLoader /> : error || !data ? <ErrorBox error={error ?? ''} onRetry={reload} /> : (
        <>
          {!!data.ads?.totalNet && (
            <Card className="p-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span>Reklam harcaması (KDV hariç): <b className="tabular-nums">{tl(data.ads.totalNet)}</b></span>
              <span>Reklam sonrası net kâr: <b className={cx('tabular-nums', data.ads.profitAfterAds < 0 ? 'text-rose-600' : 'text-emerald-700')}>{tl(data.ads.profitAfterAds)}</b></span>
              <a href="/ads" className="text-indigo-600 text-xs hover:underline">Reklam harcamaları →</a>
            </Card>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
            <Kpi label="Ciro (KDV dahil)" value={tl(data.total.revenue_gross)} sub={`${data.total.orders} sipariş · ${data.total.cancelled} iptal/iade`} />
            <Kpi label="Net kâr" value={tl(data.total.net_profit)} accent={data.total.net_profit < 0 ? 'text-rose-600' : 'text-emerald-700'}
              sub={data.total.estimates ? `${data.total.estimates} sipariş tahmini` : 'Tümü kesin'} icon={data.total.net_profit < 0 ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />} />
            <Kpi label="Net marj" value={`%${data.total.revenue_net ? ((data.total.net_profit / data.total.revenue_net) * 100).toFixed(1) : '0'}`} sub="KDV hariç ciro üzerinden" />
            <Kpi label="Komisyon + bedeller" value={tl(data.total.commission + data.total.fees)} sub={`Cironun %${data.total.revenue_net ? (((data.total.commission + data.total.fees) / data.total.revenue_net) * 100).toFixed(1) : 0}'i`} />
            <Kpi label="Kargo" value={tl(data.total.shipping)} sub={`Sipariş başı ${tl2(data.total.orders ? data.total.shipping / data.total.orders : 0)}`} />
            <Kpi label="Kaçırılan hızlı gönderim" value={String(data.missed.sameDay + data.missed.fast)} accent={data.missed.sameDay + data.missed.fast ? 'text-amber-600' : ''}
              sub={data.missed.extraCost ? `~${tl(data.missed.extraCost)} fazladan hizmet bedeli` : 'Termin performansı iyi'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <Card className="lg:col-span-3 p-5">
              <h3 className="font-semibold mb-3">Pazaryerine göre ciro dağılımı (KDV hariç)</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                    <XAxis type="number" tickFormatter={(v: number) => tl(v)} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={90} />
                    <Tooltip formatter={(v: number, n: string) => [tl2(v), LABELS[n] ?? n]} />
                    <Legend formatter={(v: string) => LABELS[v] ?? v} wrapperStyle={{ fontSize: 12 }} />
                    {(['product_cost', 'commission', 'fees', 'shipping', 'tax', 'net_profit'] as const).map((k) => <Bar key={k} dataKey={k} stackId="a" fill={COLORS[k]} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="lg:col-span-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase"><tr><th className="text-left px-3 py-2">Pazaryeri</th><th className="text-right px-3 py-2">Ciro</th><th className="text-right px-3 py-2">Net kâr</th><th className="text-right px-3 py-2">Marj</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {Object.entries(data.byMarketplace).sort((a, b) => b[1].net_profit - a[1].net_profit).map(([k, v]) => (
                    <tr key={k}>
                      <td className="px-3 py-2"><MarketplaceBadge name={k} /><div className="text-[11px] text-slate-500">{v.orders} sip.</div></td>
                      <td className="px-3 py-2 text-right tabular-nums">{tl(v.revenue_gross)}</td>
                      <td className={cx('px-3 py-2 text-right tabular-nums font-semibold', v.net_profit < 0 ? 'text-rose-600' : 'text-emerald-700')}>{tl(v.net_profit)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">%{v.revenue_net ? ((v.net_profit / v.revenue_net) * 100).toFixed(1) : '0'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <Card className="overflow-x-auto">
            <div className="px-5 py-3 border-b border-slate-100 font-semibold">Pazaryeri bazında gider kırılımı</div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase"><tr>
                <th className="text-left px-4 py-2">Pazaryeri</th>
                {['KDV hariç ciro', 'Ürün maliyeti', 'Komisyon', 'Platform bedelleri', 'Kargo', 'Stopaj', 'Reklam/risk', 'Net kâr'].map((h) => <th key={h} className="text-right px-4 py-2">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {Object.entries(data.byMarketplace).map(([k, v]) => (
                  <tr key={k}>
                    <td className="px-4 py-2"><MarketplaceBadge name={k} /></td>
                    {[v.revenue_net, v.product_cost, v.commission, v.fees, v.shipping, v.tax, v.other].map((x, i) => <td key={i} className="px-4 py-2 text-right tabular-nums">{tl2(x)}</td>)}
                    <td className={cx('px-4 py-2 text-right tabular-nums font-semibold', v.net_profit < 0 ? 'text-rose-600' : 'text-emerald-700')}>{tl2(v.net_profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="overflow-x-auto">
              <div className="px-5 py-3 border-b border-slate-100 font-semibold">Ürün kârlılığı</div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase"><tr><th className="text-left px-4 py-2">Ürün</th><th className="text-right px-4 py-2">Adet</th><th className="text-right px-4 py-2">Net kâr</th><th className="text-right px-4 py-2 hidden sm:table-cell">Adet başı</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.products.map((x) => (
                    <tr key={x.sku}>
                      <td className="px-4 py-2"><div className="font-medium truncate max-w-[140px] sm:max-w-[260px]">{x.title}</div><div className="text-[11px] text-slate-500 font-mono">{x.sku}</div></td>
                      <td className="px-4 py-2 text-right">{x.units}</td>
                      <td className={cx('px-4 py-2 text-right tabular-nums font-semibold', x.net_profit < 0 ? 'text-rose-600' : 'text-emerald-700')}>{tl2(x.net_profit)}</td>
                      <td className="px-4 py-2 text-right tabular-nums hidden sm:table-cell">{tl2(x.units ? x.net_profit / x.units : 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <div className="space-y-4">
              <Card>
                <div className="px-5 py-3 border-b border-slate-100 font-semibold flex items-center gap-2"><TrendingDown className="w-4 h-4 text-rose-600" /> Zarar eden siparişler ({data.losses.length})</div>
                <ul className="divide-y divide-slate-100 text-sm max-h-72 overflow-y-auto">
                  {!data.losses.length && <li className="px-5 py-6 text-center text-slate-500">Bu dönemde zarar eden sipariş yok.</li>}
                  {data.losses.map((l) => (
                    <li key={l.id} className="px-5 py-2 flex items-center gap-3 hover:bg-slate-50 cursor-pointer" onClick={() => setDetail(l.id)}>
                      <MarketplaceBadge name={l.marketplace} size="xs" />
                      <div className="flex-1 min-w-0"><div className="font-mono text-xs">#{l.external_order_id.split('/')[0]}</div><div className="text-[11px] text-slate-500 truncate">{fmtDate(l.date)} · {tl2(l.revenue_gross)} · {l.reason}</div></div>
                      <span className="text-rose-600 font-semibold tabular-nums">{tl2(l.net_profit)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card>
                <div className="px-5 py-3 border-b border-slate-100 font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-600" /> Kaçırılan Bugün Kargoda / termin ({data.missed.sameDay + data.missed.fast})</div>
                <ul className="divide-y divide-slate-100 text-sm max-h-56 overflow-y-auto">
                  {!data.missed.orders.length && <li className="px-5 py-6 text-center text-slate-500">Tüm hızlı gönderimler zamanında.</li>}
                  {data.missed.orders.map((m) => (
                    <li key={m.id} className="px-5 py-2 flex items-center gap-3 hover:bg-slate-50 cursor-pointer" onClick={() => setDetail(m.id)}>
                      <MarketplaceBadge name={m.marketplace} size="xs" />
                      <span className="font-mono text-xs">#{m.external_order_id.split('/')[0]}</span>
                      <span className="text-[11px] text-slate-500 flex-1">{fmtDate(m.date)}</span>
                      <span className="text-xs text-amber-700 flex items-center gap-1"><Clock className="w-3 h-3" />{m.kind}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
          {data.uncomputed > 0 && <p className="text-xs text-amber-700">{data.uncomputed} sipariş henüz hesaplanmadı — Maliyet Kuralları &gt; "Tümünü yeniden hesapla".</p>}
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, accent, icon }: { label: string; value: string; sub?: string; accent?: string; icon?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-slate-500 flex items-center justify-between">{label}{icon}</div>
      <div className={cx('text-xl font-bold mt-1 tabular-nums', accent)}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </Card>
  );
}
