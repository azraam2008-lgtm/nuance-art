'use client';
import { useIsStaff } from '@/components/role';
import { useEffect, useState } from 'react';
import { AlarmClock, CheckSquare, ChevronLeft, ChevronRight, Printer, Search, Truck, X } from 'lucide-react';
import CostBreakdown, { ProfitBadge } from '@/components/CostBreakdown';
import { MARKETPLACES, MARKETPLACE_META, ORDER_STATUSES, ORDER_STATUS_META, RETURN_REASONS, isClosedStatus, type OrderStatus } from '@/lib/marketplaces/meta';
import { api, useLive, useLiveData, useToast } from '@/components/live';
import { Button, Card, Empty, ErrorBox, Field, MarketplaceBadge, Modal, PageLoader, cx, fmtDate, inputClass, tl2 } from '@/components/ui';

type Cost = { net_profit: number; status: string; same_day_eligible: boolean | null; same_day_met: boolean | null; fast_met: boolean | null; deadline?: string | null };
interface Order {
  id: string; external_order_id: string; marketplace_name: string; customer_name: string; total_amount: number; status: OrderStatus; order_date: string;
  shipped_at: string | null; tracking_number?: string | null; invoice_number?: string | null; return_reason?: string | null;
  items: Array<{ sku: string; product_title: string; quantity: number; unit_price: number }>;
  cost: Cost | Cost[] | null;
}
type Remote = { ok: boolean; message: string; unsupported?: boolean } | undefined;
const costOf = (o: Order) => (Array.isArray(o.cost) ? o.cost[0] : o.cost) ?? null;
const no = (o: Order) => o.external_order_id.split('/')[0];
const isLate = (o: Order) => !o.shipped_at && !isClosedStatus(o.status) && o.status !== 'shipped' && o.status !== 'delivered'
  && !!costOf(o)?.deadline && new Date(costOf(o)!.deadline!).getTime() < Date.now();

/** Durum seçimi ek bilgi isteyen durumlar için pencere: kargo, fatura, iade */
type Pending = { orders: Order[]; status: OrderStatus } | null;

export default function OrdersPage() {
  const staff = useIsStaff();
  const [marketplace, setMarketplace] = useState('');
  const [status, setStatus] = useState('');
  const [late, setLate] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending>(null);
  const [form, setForm] = useState({ trackingNumber: '', carrier: '', invoiceNumber: '', returnReason: RETURN_REASONS[0] as string, note: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { bump } = useLive();

  const label = (o: Order) => MARKETPLACE_META[o.marketplace_name as keyof typeof MARKETPLACE_META]?.label ?? o.marketplace_name;
  function report(o: Order, local: string, remote: Remote) {
    if (!remote) { toast(local); return; }
    if (remote.ok) toast(`${local} ${label(o)} pazaryerine de bildirildi.`);
    else if (remote.unsupported) toast(`${local} ${remote.message}`, 'warn');
    else toast(`${local} Ancak ${label(o)} pazaryerine gönderilemedi: ${remote.message} (İşlem Merkezi'nden tekrar denenebilir)`, 'err');
  }

  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(0); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setSelected(new Set()); }, [marketplace, status, late, debounced, page]);

  const params = new URLSearchParams({ page: String(page), pageSize: '50', ...(marketplace && { marketplace }), ...(status && { status }), ...(late && { late: '1' }), ...(debounced && { q: debounced }) });
  const { data, error, loading, reload } = useLiveData<{ orders: Order[]; total: number; pageSize: number; lateCount?: number }>(`/api/orders?${params}`);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const orders = data?.orders ?? [];
  const chosen = orders.filter((o) => selected.has(o.id));

  /** Durum değişikliği: kargo, fatura ve iade için önce bilgi penceresi açılır */
  function ask(list: Order[], next: OrderStatus) {
    if (!list.length) return;
    if (next === 'shipped' || next === 'invoiced' || next === 'returned' || next === 'cancelled') {
      setForm({ trackingNumber: '', carrier: '', invoiceNumber: '', returnReason: RETURN_REASONS[0], note: '' });
      setPending({ orders: list, status: next });
      return;
    }
    void apply(list, next);
  }

  async function apply(list: Order[], next: OrderStatus) {
    setBusy(true);
    const reason = form.returnReason === 'Diğer' && form.note.trim() ? form.note.trim() : form.returnReason;
    try {
      if (list.length === 1) {
        const o = list[0];
        const r = next === 'shipped'
          ? await api<{ cost: { net_profit: number } | null; remote?: Remote }>(`/api/orders/${o.id}/ship`, { method: 'POST', body: { trackingNumber: form.trackingNumber, carrier: form.carrier } })
          : await api<{ remote?: Remote }>(`/api/orders/${o.id}`, { method: 'PATCH', body: { status: next, invoiceNumber: form.invoiceNumber, trackingNumber: form.trackingNumber, returnReason: next === 'returned' ? reason : undefined } });
        report(o, `#${no(o)} → ${ORDER_STATUS_META[next].label}.${isClosedStatus(next) ? ' Stok havuza iade edildi.' : ''}`, r.remote);
      } else {
        const r = await api<{ results: Array<{ id: string; ok: boolean; message: string; remote?: Remote }> }>('/api/orders/bulk', {
          method: 'POST', body: next === 'shipped' ? { ids: list.map((o) => o.id), action: 'ship' } : { ids: list.map((o) => o.id), status: next },
        });
        const failLocal = r.results.filter((x) => !x.ok);
        const failRemote = r.results.filter((x) => x.ok && x.remote && !x.remote.ok && !x.remote.unsupported);
        if (!failLocal.length && !failRemote.length) toast(`${list.length} sipariş → ${ORDER_STATUS_META[next].label}. Pazaryerlerine bildirildi.`);
        else toast(`${list.length - failLocal.length} sipariş güncellendi.${failLocal.length ? ` ${failLocal.length} sipariş güncellenemedi: ${failLocal[0].message}.` : ''}${failRemote.length ? ` ${failRemote.length} sipariş pazaryerine gönderilemedi (İşlem Merkezi'nde).` : ''}`, 'warn');
      }
      setPending(null);
      setSelected(new Set());
      bump();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectable = orders.filter((o) => !isClosedStatus(o.status));
  const allChecked = selectable.length > 0 && selectable.every((o) => selected.has(o.id));

  const StatusSelect = ({ o, className }: { o: Order; className?: string }) => (
    <select value={o.status} disabled={isClosedStatus(o.status)} onChange={(e) => ask([o], e.target.value as OrderStatus)}
      className={cx('text-xs rounded-md px-1.5 py-1 border-0 font-medium cursor-pointer disabled:cursor-default', ORDER_STATUS_META[o.status].className, className)}>
      {ORDER_STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS_META[s].label}</option>)}
    </select>
  );

  return (
    <div className="space-y-4 fade-in">
      <CostBreakdown orderId={detail} onClose={() => setDetail(null)} />

      <Modal open={!!pending} onClose={() => setPending(null)} title={pending ? `${pending.orders.length > 1 ? `${pending.orders.length} sipariş` : `#${no(pending.orders[0])}`} → ${ORDER_STATUS_META[pending.status].label}` : ''}>
        {pending && (
          <div className="space-y-4">
            {pending.status === 'shipped' && (
              <>
                <p className="text-sm text-slate-600">Sipariş &quot;Kargoda&quot; yapılacak ve pazaryerine bildirilecek. Pazaryerinin anlaşmalı kargosuyla gönderdiyseniz alanları boş bırakabilirsiniz.</p>
                {pending.orders.length === 1 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Kargo takip numarası (isteğe bağlı)"><input className={inputClass} value={form.trackingNumber} onChange={(e) => setForm({ ...form, trackingNumber: e.target.value })} /></Field>
                    <Field label="Kargo firması (isteğe bağlı)"><input className={inputClass} placeholder="Aras, Yurtiçi, PTT…" value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} /></Field>
                  </div>
                )}
              </>
            )}
            {pending.status === 'invoiced' && (
              <>
                <p className="text-sm text-slate-600">Fatura numarası Trendyol ve idefix&apos;e bildirilir. Diğer pazaryerleri fatura bilgisini API ile almaz; durum yalnızca panelde değişir.</p>
                {pending.orders.length === 1 && <Field label="Fatura numarası (isteğe bağlı)"><input className={inputClass} value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} /></Field>}
              </>
            )}
            {pending.status === 'cancelled' && (
              <p className="text-sm text-slate-600">Sipariş iptal edilecek, satılan adetler stok havuzuna geri eklenecek ve iptal pazaryerine bildirilecek. Bu işlem geri alınamaz.</p>
            )}
            {pending.status === 'returned' && (
              <>
                <p className="text-sm text-slate-600">Ürün size geri döndüyse &quot;İade edildi&quot; yapın: adetler stok havuzuna eklenir ve iade analizine girer. İade pazaryerinde müşteri tarafından başlatıldığı için pazaryerine ayrıca bildirim gitmez.</p>
                <Field label="İade nedeni">
                  <select className={inputClass} value={form.returnReason} onChange={(e) => setForm({ ...form, returnReason: e.target.value })}>
                    {RETURN_REASONS.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </Field>
                {form.returnReason === 'Diğer' && <Field label="Açıklama"><input className={inputClass} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>}
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPending(null)}>Vazgeç</Button>
              <Button loading={busy} variant={isClosedStatus(pending.status) ? 'danger' : 'primary'} onClick={() => apply(pending.orders, pending.status)}>
                {pending.status === 'shipped' && <Truck className="w-4 h-4" />} Onayla
              </Button>
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
        <button onClick={() => { setLate((x) => !x); setPage(0); }}
          className={cx('inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm', late ? 'bg-rose-600 border-rose-600 text-white' : (data?.lateCount ?? 0) > 0 ? 'border-rose-300 text-rose-700 bg-rose-50' : 'border-slate-300 text-slate-600 bg-white')}>
          <AlarmClock className="w-4 h-4" /> Geciken {data?.lateCount ? `(${data.lateCount})` : ''}
        </button>
      </div>

      {(data?.lateCount ?? 0) > 0 && !late && (
        <button onClick={() => setLate(true)} className="w-full text-left text-sm bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-4 py-2.5 flex items-center gap-2">
          <AlarmClock className="w-4 h-4 shrink-0" /> {data!.lateCount} siparişin kargoya teslim süresi geçti. Pazaryerleri geç gönderimde ceza kesebilir veya mağaza puanını düşürür — görmek için dokunun.
        </button>
      )}

      {chosen.length > 0 && (
        <Card className="p-3 flex flex-wrap items-center gap-2 sticky top-16 z-20 border-indigo-200 bg-indigo-50">
          <span className="text-sm font-medium flex items-center gap-1.5"><CheckSquare className="w-4 h-4 text-indigo-600" /> {chosen.length} sipariş seçildi</span>
          <span className="flex-1" />
          <select className={`${inputClass} !w-auto py-1.5`} value="" onChange={(e) => e.target.value && ask(chosen, e.target.value as OrderStatus)}>
            <option value="">Toplu durum değiştir…</option>
            {ORDER_STATUSES.filter((s) => s !== 'new').map((s) => <option key={s} value={s}>{ORDER_STATUS_META[s].label}</option>)}
          </select>
          <Button variant="secondary" onClick={() => window.open(`/orders/labels?ids=${chosen.map((o) => o.id).join(',')}`, '_blank')}><Printer className="w-4 h-4" /> Kargo etiketi yazdır</Button>
          <Button onClick={() => ask(chosen, 'shipped')}><Truck className="w-4 h-4" /> Kargoya verildi</Button>
          <button onClick={() => setSelected(new Set())} className="p-2 text-slate-500" aria-label="Seçimi temizle"><X className="w-4 h-4" /></button>
        </Card>
      )}

      {loading ? <PageLoader /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
        <>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>{data?.total.toLocaleString('tr-TR')} sipariş</span>
            {selectable.length > 0 && (
              <label className="flex items-center gap-1.5 cursor-pointer md:hidden">
                <input type="checkbox" className="accent-indigo-600" checked={allChecked} onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((o) => o.id)) : new Set())} /> Tümünü seç
              </label>
            )}
          </div>

          {/* Telefon: kart listesi */}
          <div className="md:hidden space-y-2">
            {!orders.length && <Card><Empty>{late ? 'Geciken sipariş yok. 👍' : 'Kriterlere uygun sipariş yok.'}</Empty></Card>}
            {orders.map((o) => (
              <Card key={o.id} className={cx('p-3 space-y-2', selected.has(o.id) && 'ring-2 ring-indigo-400', isLate(o) && 'border-rose-300')}>
                <div className="flex items-center gap-2">
                  {!isClosedStatus(o.status) && <input type="checkbox" className="w-4 h-4 accent-indigo-600" checked={selected.has(o.id)} onChange={() => toggle(o.id)} />}
                  <MarketplaceBadge name={o.marketplace_name} />
                  <span className="font-mono text-xs text-slate-500 truncate">#{no(o)}</span>
                  <span className="ml-auto text-[11px] text-slate-500 whitespace-nowrap">{fmtDate(o.order_date)}</span>
                </div>
                <div>
                  <div className="font-medium text-sm">{o.customer_name}</div>
                  <div className="text-xs text-slate-600">{o.items.map((i) => `${i.quantity}x ${i.product_title}`).join(', ')}</div>
                  {isLate(o) && <div className="text-[11px] text-rose-600 font-medium mt-0.5">⏰ Kargoya teslim süresi geçti ({fmtDate(costOf(o)?.deadline)})</div>}
                  {o.return_reason && <div className="text-[11px] text-fuchsia-700 mt-0.5">İade nedeni: {o.return_reason}</div>}
                  {o.tracking_number && <div className="text-[11px] text-slate-500 mt-0.5">Takip: {o.tracking_number}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">{tl2(o.total_amount)}</span>
                  {!staff && <button onClick={() => setDetail(o.id)} className="text-xs"><ProfitBadge value={costOf(o)?.net_profit} status={costOf(o)?.status} /></button>}
                  <span className="flex-1" />
                  <StatusSelect o={o} className="py-1.5" />
                  {!o.shipped_at && !isClosedStatus(o.status) && (<>
                    <a href={`/orders/labels?ids=${o.id}`} target="_blank" rel="noreferrer" className="p-2 rounded-md bg-slate-100 text-slate-600" aria-label="Kargo etiketi yazdır"><Printer className="w-4 h-4" /></a>
                    <button onClick={() => ask([o], 'shipped')} className="p-2 rounded-md bg-indigo-50 text-indigo-700" aria-label="Kargoya verildi"><Truck className="w-4 h-4" /></button>
                  </>)}
                </div>
              </Card>
            ))}
          </div>

          <Card className="overflow-x-auto hidden md:block">
            {!orders.length ? <Empty>{late ? 'Geciken sipariş yok. 👍' : 'Kriterlere uygun sipariş yok.'}</Empty> : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="pl-4 py-3 w-8"><input type="checkbox" className="accent-indigo-600" checked={allChecked} disabled={!selectable.length} onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((o) => o.id)) : new Set())} /></th>
                    <th className="text-left px-3 py-3">Sipariş No</th><th className="text-left px-3 py-3">Pazaryeri</th><th className="text-left px-3 py-3">Müşteri</th>
                    <th className="text-left px-3 py-3">Ürün(ler)</th><th className="text-right px-3 py-3">Adet</th><th className="text-right px-3 py-3">Tutar</th>
                    <th className="text-right px-3 py-3">Net Kâr</th><th className="text-left px-3 py-3">Durum</th><th className="text-left px-3 py-3">Tarih</th><th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orders.map((o) => (
                    <tr key={o.id} className={cx('hover:bg-slate-50', selected.has(o.id) && 'bg-indigo-50/60', isLate(o) && 'bg-rose-50/50')}>
                      <td className="pl-4 py-3">{!isClosedStatus(o.status) && <input type="checkbox" className="accent-indigo-600" checked={selected.has(o.id)} onChange={() => toggle(o.id)} />}</td>
                      <td className="px-3 py-3 font-mono text-xs">{no(o)}{isLate(o) && <div className="text-[10px] font-sans text-rose-600 font-medium">⏰ gecikti</div>}</td>
                      <td className="px-3 py-3"><MarketplaceBadge name={o.marketplace_name} /></td>
                      <td className="px-3 py-3">{o.customer_name}</td>
                      <td className="px-3 py-3 max-w-[260px]">
                        <div className="truncate" title={o.items.map((i) => `${i.quantity}x ${i.product_title} (${i.sku})`).join('\n')}>{o.items.map((i) => i.product_title).join(', ')}</div>
                        {o.return_reason && <div className="text-[11px] text-fuchsia-700 truncate">İade: {o.return_reason}</div>}
                      </td>
                      <td className="px-3 py-3 text-right">{o.items.reduce((s, i) => s + i.quantity, 0)}</td>
                      <td className="px-3 py-3 text-right font-medium">{tl2(o.total_amount)}</td>
                      <td className="px-3 py-3 text-right">
                        <button onClick={() => !staff && setDetail(o.id)} className="hover:underline" title="Maliyet dökümü">
                          <ProfitBadge value={costOf(o)?.net_profit} status={costOf(o)?.status} />
                        </button>
                        {costOf(o)?.same_day_eligible && costOf(o)?.same_day_met === false && <div className="text-[10px] text-rose-600">aynı gün kaçtı</div>}
                      </td>
                      <td className="px-3 py-3"><StatusSelect o={o} /></td>
                      <td className="px-3 py-3 text-xs text-slate-500 whitespace-nowrap">{fmtDate(o.order_date)}</td>
                      <td className="px-2 py-3">
                        {!o.shipped_at && !isClosedStatus(o.status) && (<span className="inline-flex">
                          <a href={`/orders/labels?ids=${o.id}`} target="_blank" rel="noreferrer" title="Kargo etiketi yazdır" className="inline-flex p-1.5 rounded-md text-slate-500 hover:bg-slate-100"><Printer className="w-4 h-4" /></a>
                          <button onClick={() => ask([o], 'shipped')} title="Kargoya verildi olarak işaretle" className="p-1.5 rounded-md text-slate-500 hover:bg-indigo-50 hover:text-indigo-700"><Truck className="w-4 h-4" /></button>
                        </span>)}
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
