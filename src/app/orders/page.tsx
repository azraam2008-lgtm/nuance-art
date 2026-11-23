'use client';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, Truck } from 'lucide-react';
import CostBreakdown, { ProfitBadge } from '@/components/CostBreakdown';
import { MARKETPLACES, MARKETPLACE_META, ORDER_STATUSES, ORDER_STATUS_META, type OrderStatus } from '@/lib/marketplaces/meta';
import { api, useLive, useLiveData, useToast } from '@/components/live';
import { Button, Card, Empty, ErrorBox, Field, MarketplaceBadge, Modal, PageLoader, cx, fmtDate, inputClass, tl2 } from '@/components/ui';

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
  const [shipFor, setShipFor] = useState<Order | null>(null);
  const [shipForm, setShipForm] = useState({ trackingNumber: '', carrier: '' });
  const [busy, setBusy] = useState(false);

  type Remote = { ok: boolean; message: string; unsupported?: boolean } | undefined;
  const label = (o: Order) => MARKETPLACE_META[o.marketplace_name as keyof typeof MARKETPLACE_META]?.label ?? o.marketplace_name;
  function report(o: Order, local: string, remote: Remote) {
    if (!remote) { toast(local); return; }
    if (remote.ok) toast(`${local} ${label(o)} pazaryerine de bildirildi.`);
    else if (remote.unsupported) toast(`${local} ${remote.message}`, 'warn');
    else toast(`${local} Ancak ${label(o)} pazaryerine gönderilemedi: ${remote.message}`, 'err');
  }

  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(0); }, 300); return () => clearTimeout(t); }, [q]);

  const params = new URLSearchParams({ page: String(page), pageSize: '50', ...(marketplace && { marketplace }), ...(status && { status }), ...(debounced && { q: debounced }) });
  const { data, error, loading, reload } = useLiveData<{ orders: Order[]; total: number; pageSize: number }>(`/api/orders?${params}`);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  async function changeStatus(o: Order, next: OrderStatus) {
    if (next === 'shipped') { openShip(o); return; }
    if (next === 'cancelled' && !window.confirm(`#${o.external_order_id.split('/')[0]} iptal edilecek, stok havuza iade edilecek ve ${label(o)} pazaryerine iptal bildirilecek. Emin misiniz?`)) return;
    try {
      const r = await api<{ remote?: Remote }>(`/api/orders/${o.id}`, { method: 'PATCH', body: { status: next } });
      report(o, next === 'cancelled' ? 'Sipariş iptal edildi, stok iade edildi.' : `Durum: ${ORDER_STATUS_META[next].label}.`, r.remote);
      bump();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }

  function openShip(o: Order) {
    setShipForm({ trackingNumber: '', carrier: '' });
    setShipFor(o);
  }

  async function ship() {
    if (!shipFor) return;
    setBusy(true);
    try {
      const r = await api<{ cost: { net_profit: number } | null; remote?: Remote }>(`/api/orders/${shipFor.id}/ship`, { method: 'POST', body: shipForm });
      report(shipFor, `#${shipFor.external_order_id.split('/')[0]} kargoya verildi — net kâr ${tl2(r.cost?.net_profit ?? 0)}.`, r.remote);
      setShipFor(null);
      bump();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 fade-in">
      <CostBreakdown orderId={detail} onClose={() => setDetail(null)} />
      <Modal open={!!shipFor} onClose={() => setShipFor(null)} title={shipFor ? `#${shipFor.external_order_id.split('/')[0]} kargoya verildi` : ''}>
        {shipFor && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Sipariş "Kargoda" olarak işaretlenecek ve <b>{label(shipFor)}</b> pazaryerine bildirilecek. Pazaryerinin anlaşmalı kargosuyla gönderdiyseniz alanları boş bırakabilirsiniz; kendi kargonuzla gönderdiyseniz takip numarasını yazın.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Kargo takip numarası (isteğe bağlı)"><input className={inputClass} value={shipForm.trackingNumber} onChange={(e) => setShipForm({ ...shipForm, trackingNumber: e.target.value })} /></Field>
              <Field label="Kargo firması (isteğe bağlı)"><input className={inputClass} placeholder="Aras, Yurtiçi, PTT…" value={shipForm.carrier} onChange={(e) => setShipForm({ ...shipForm, carrier: e.target.value })} /></Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShipFor(null)}>Vazgeç</Button>
              <Button loading={busy} onClick={ship}><Truck className="w-4 h-4" /> Kargoya verildi</Button>
            </div>
          </div>
        )}
      </Modal>
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sipariş no, müşteri veya ürün ara…" className={`${inputClass} pl-9`} />
        </div>
        <select value={marketplace} onChange={(e) => { setMarketplace(e.target.value); setPage(0); }} className={`${inputClass} !w-auto flex-1 sm:flex-none`}>
          <option value="">Tüm Pazaryerleri</option>
          {MARKETPLACES.map((m) => <option key={m} value={m}>{MARKETPLACE_META[m].label}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className={`${inputClass} !w-auto flex-1 sm:flex-none`}>
          <option value="">Tüm Durumlar</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS_META[s].label}</option>)}
        </select>
      </div>

      {loading ? <PageLoader /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
        <>
          <div className="text-xs text-slate-500">{data?.total.toLocaleString('tr-TR')} sipariş</div>
          {/* Telefon: kart listesi */}
          <div className="md:hidden space-y-2">
            {!data?.orders.length && <Card><Empty>Kriterlere uygun sipariş yok.</Empty></Card>}
            {data?.orders.map((o) => (
              <Card key={o.id} className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <MarketplaceBadge name={o.marketplace_name} />
                  <span className="font-mono text-xs text-slate-500 truncate">#{o.external_order_id.split('/')[0]}</span>
                  <span className="ml-auto text-[11px] text-slate-500 whitespace-nowrap">{fmtDate(o.order_date)}</span>
                </div>
                <div>
                  <div className="font-medium text-sm">{o.customer_name}</div>
                  <div className="text-xs text-slate-600">{o.items.map((i) => `${i.quantity}x ${i.product_title}`).join(', ')}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">{tl2(o.total_amount)}</span>
                  <button onClick={() => setDetail(o.id)} className="text-xs"><ProfitBadge value={costOf(o)?.net_profit} status={costOf(o)?.status} /></button>
                  <span className="flex-1" />
                  <select value={o.status} disabled={o.status === 'cancelled'} onChange={(e) => changeStatus(o, e.target.value as OrderStatus)}
                    className={cx('text-xs rounded-md px-2 py-1.5 border-0 font-medium', ORDER_STATUS_META[o.status].className)}>
                    {ORDER_STATUSES.map((st) => <option key={st} value={st}>{ORDER_STATUS_META[st].label}</option>)}
                  </select>
                  {!o.shipped_at && o.status !== 'cancelled' && (
                    <button onClick={() => openShip(o)} className="p-2 rounded-md bg-indigo-50 text-indigo-700" aria-label="Kargoya verildi"><Truck className="w-4 h-4" /></button>
                  )}
                </div>
              </Card>
            ))}
          </div>
          <Card className="overflow-x-auto hidden md:block">
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
                          <button onClick={() => openShip(o)} title="Kargoya verildi olarak işaretle" className="p-1.5 rounded-md text-slate-500 hover:bg-indigo-50 hover:text-indigo-700"><Truck className="w-4 h-4" /></button>
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
