'use client';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, Truck } from 'lucide-react';
import CostBreakdown, { ProfitBadge } from '@/components/CostBreakdown';
import { MARKETPLACES, MARKETPLACE_META, ORDER_STATUSES, ORDER_STATUS_META, type OrderStatus } from '@/lib/marketplaces/meta';
import { api, useLive, useLiveData, useToast } from '@/components/live';
import { Card, Empty, ErrorBox, MarketplaceBadge, PageLoader, cx, fmtDate, inputClass, tl2 } from '@/components/ui';

interface Order {
  id: string; external_order_id: string; marketplace_name: string; customer_name: string; total_amount: number; status: OrderStatus; order_date: string;
  shipped_at: string | null;
  items: Array<{ sku: string; product_title: string; quantity: number; unit_price: number }>;
  cost: { net_profit: number; status: string; same_day_eligible: boolean | null; same_day_met: boolean | null; fast_met: boolean | null } | Array<{ net_profit: number; status: string; same_day_eligible: boolean | null; same_day_met: boolean | null; fast_met: boolean | null }> | null;
}
const costOf = (o: Order) => (Array.isArray(o.cost) ? o.cost[0] : o.cost) ?? null;

export default function OrdersPage() {
  const [marketplace, setMarketplace] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const toast = useToast();
  const { bump } = useLive();

  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(0); }, 300); return () => clearTimeout(t); }, [q]);

  const params = new URLSearchParams({ page: String(page), pageSize: '50', ...(marketplace && { marketplace }), ...(status && { status }), ...(debounced && { q: debounced }) });
  const { data, error, loading, reload } = useLiveData<{ orders: Order[]; total: number; pageSize: number }>(`/api/orders?${params}`);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  async function changeStatus(o: Order, next: OrderStatus) {
    if (next === 'cancelled' && !window.confirm(`#${o.external_order_id} iptal/iade olarak işaretlenecek ve stok havuza iade edilecek. Emin misiniz?`)) return;
    try {
      await api(`/api/orders/${o.id}`, { method: 'PATCH', body: { status: next } });
      toast(next === 'cancelled' ? 'Sipariş iptal edildi, stok iade edildi ve pazaryerlerine gönderildi.' : `Durum: ${ORDER_STATUS_META[next].label}`, next === 'cancelled' ? 'warn' : 'ok');
      bump();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }

  async function ship(o: Order) {
    try {
      const r = await api<{ cost: { net_profit: number } | null }>(`/api/orders/${o.id}/ship`, { method: 'POST', body: {} });
      toast(`#${o.external_order_id.split('/')[0]} kargoya verildi — net kâr ${tl2(r.cost?.net_profit ?? 0)}`);
      bump();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }

  return (
    <div className="space-y-4 fade-in">
      <CostBreakdown orderId={detail} onClose={() => setDetail(null)} />
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sipariş no, müşteri veya ürün ara…" className={`${inputClass} pl-9`} />
        </div>
        <select value={marketplace} onChange={(e) => { setMarketplace(e.target.value); setPage(0); }} className={`${inputClass} !w-auto`}>
          <option value="">Tüm Pazaryerleri</option>
          {MARKETPLACES.map((m) => <option key={m} value={m}>{MARKETPLACE_META[m].label}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className={`${inputClass} !w-auto`}>
          <option value="">Tüm Durumlar</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS_META[s].label}</option>)}
        </select>
      </div>

      {loading ? <PageLoader /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
        <>
          <div className="text-xs text-slate-500">{data?.total.toLocaleString('tr-TR')} sipariş</div>
          <Card className="overflow-x-auto">
            {!data?.orders.length ? <Empty>Kriterlere uygun sipariş yok.</Empty> : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-3">Sipariş No</th><th className="text-left px-4 py-3">Pazaryeri</th><th className="text-left px-4 py-3">Müşteri</th>
                    <th className="text-left px-4 py-3">Ürün(ler)</th><th className="text-right px-4 py-3">Adet</th><th className="text-right px-4 py-3">Tutar</th>
                    <th className="text-right px-4 py-3">Net Kâr</th><th className="text-left px-4 py-3">Durum</th><th className="text-left px-4 py-3">Tarih</th><th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.orders.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs">{o.external_order_id.split('/')[0]}</td>
                      <td className="px-4 py-3"><MarketplaceBadge name={o.marketplace_name} /></td>
                      <td className="px-4 py-3">{o.customer_name}</td>
                      <td className="px-4 py-3 max-w-[260px]"><div className="truncate" title={o.items.map((i) => `${i.quantity}x ${i.product_title} (${i.sku})`).join('\n')}>{o.items.map((i) => i.product_title).join(', ')}</div></td>
                      <td className="px-4 py-3 text-right">{o.items.reduce((s, i) => s + i.quantity, 0)}</td>
                      <td className="px-4 py-3 text-right font-medium">{tl2(o.total_amount)}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setDetail(o.id)} className="hover:underline" title="Maliyet dökümü">
                          <ProfitBadge value={costOf(o)?.net_profit} status={costOf(o)?.status} />
                        </button>
                        {costOf(o)?.same_day_eligible && costOf(o)?.same_day_met === false && <div className="text-[10px] text-rose-600">aynı gün kaçtı</div>}
                      </td>
                      <td className="px-4 py-3">
                        <select value={o.status} disabled={o.status === 'cancelled'} onChange={(e) => changeStatus(o, e.target.value as OrderStatus)}
                          className={cx('text-xs rounded-md px-1.5 py-1 border-0 font-medium cursor-pointer disabled:cursor-default', ORDER_STATUS_META[o.status].className)}>
                          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS_META[s].label}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fmtDate(o.order_date)}</td>
                      <td className="px-2 py-3">
                        {!o.shipped_at && o.status !== 'cancelled' && (
                          <button onClick={() => ship(o)} title="Kargoya verildi olarak işaretle" className="p-1.5 rounded-md text-slate-500 hover:bg-indigo-50 hover:text-indigo-700"><Truck className="w-4 h-4" /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded border border-slate-300 disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
              <span>{page + 1} / {pages}</span>
              <button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded border border-slate-300 disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
