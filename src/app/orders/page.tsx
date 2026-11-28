'use client';
import { useIsStaff } from '@/components/role';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowUpDown, CheckSquare, ChevronLeft, ChevronRight, FileText, Filter, Printer, RotateCcw, Search, Truck, X } from 'lucide-react';
import CostBreakdown, { ProfitBadge } from '@/components/CostBreakdown';
import InvoiceModal from '@/components/InvoiceModal';
import { useConnectedMarketplaces, useMarketplaceShortName, useMarketplaces } from '@/components/useMarketplaces';
import { BASE_MARKETPLACES, MARKETPLACE_META, baseOf, isSecondAccount, mixHex, type MarketplaceName, ORDER_STATUSES, ORDER_STATUS_META, ORDER_TABS, RETURN_REASONS, isClosedStatus, type OrderStatus } from '@/lib/marketplaces/meta';
import { api, useLive, useLiveData, useToast } from '@/components/live';
import { Button, Card, Empty, ErrorBox, Field, MarketplaceBadge, Modal, PageLoader, ProductImage, cx, fixImageUrl, fmtDate, inputClass, tl2 } from '@/components/ui';

type Cost = { net_profit: number; status: string; same_day_eligible: boolean | null; same_day_met: boolean | null; fast_met: boolean | null; deadline?: string | null };
type Item = { sku: string; product_title: string; quantity: number; unit_price: number; product?: { id: string; image_url: string | null; barcode: string | null; variant_attrs: Record<string, string> | null } | null };
interface Order {
  id: string; external_order_id: string; marketplace_name: string; customer_name: string; total_amount: number; status: OrderStatus; order_date: string;
  shipped_at: string | null; tracking_number?: string | null; invoice_number?: string | null; return_reason?: string | null; carrier?: string | null;
  order_number?: string; package_no?: string | null; delivery_no?: string | null;
  items: Item[];
  cost: Cost | Cost[] | null;
  invoice?: Inv | Inv[] | null;
}
type Inv = { status: string; invoice_number: string | null; last_error: string | null };
const invOf = (o: Order) => (Array.isArray(o.invoice) ? o.invoice[0] : o.invoice) ?? null;
type Remote = { ok: boolean; message: string; unsupported?: boolean } | undefined;
const costOf = (o: Order) => (Array.isArray(o.cost) ? o.cost[0] : o.cost) ?? null;
const no = (o: Order) => o.order_number ?? o.external_order_id.split('/')[0];
const waitingShip = (o: Order) => !o.shipped_at && !isClosedStatus(o.status) && o.status !== 'shipped' && o.status !== 'delivered';
const isLate = (o: Order) => waitingShip(o) && !!costOf(o)?.deadline && new Date(costOf(o)!.deadline!).getTime() < Date.now();

/** Kargoya vermek için kalan süre: "2 gün 5 saat", "3 saat gecikti" */
function remaining(o: Order): { text: string; cls: string } | null {
  if (!waitingShip(o)) return null;
  const d = costOf(o)?.deadline;
  if (!d) return null;
  const ms = new Date(d).getTime() - Date.now();
  const abs = Math.abs(ms);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const mins = Math.max(1, Math.floor((abs % 3_600_000) / 60_000));
  const span = days > 0 ? `${days} gün ${hours} saat` : hours > 0 ? `${hours} saat` : `${mins} dk`;
  if (ms < 0) return { text: `${span} gecikti`, cls: 'bg-rose-100 text-rose-700' };
  if (ms < 24 * 3_600_000) return { text: `${span} kaldı`, cls: 'bg-amber-100 text-amber-800' };
  return { text: `${span} kaldı`, cls: 'bg-emerald-50 text-emerald-700' };
}
const variantText = (v?: Record<string, string> | null) => (v ? Object.entries(v).filter(([, x]) => x).map(([k, x]) => `${k}: ${x}`).join(' · ') : '');

const SORT_OPTIONS = [
  ['date_desc', 'Sipariş tarihi: yeniden eskiye'],
  ['date_asc', 'Sipariş tarihi: eskiden yeniye'],
  ['deadline_asc', 'Kargoya kalan süre: en acilden'],
  ['deadline_desc', 'Kargoya kalan süre: en geçten'],
  ['amount_desc', 'Tutar: yüksekten düşüğe'],
  ['amount_asc', 'Tutar: düşükten yükseğe'],
] as const;

type Filters = { customer: string; orderNo: string; tracking: string; barcode: string; product: string; marketplace: string; deadline: string; invoice: string; from: string; to: string };
const EMPTY: Filters = { customer: '', orderNo: '', tracking: '', barcode: '', product: '', marketplace: '', deadline: '', invoice: '', from: '', to: '' };
/** Ana sayfadaki kutulardan gelen bağlantılar: /orders?tab=new, ?deadline=late, ?invoice=missing */
function fromUrl(sp: URLSearchParams): { tab: string; filters: Filters } {
  const f = { ...EMPTY };
  for (const k of Object.keys(EMPTY) as Array<keyof Filters>) f[k] = sp.get(k) ?? '';
  if (sp.get('late') === '1') f.deadline = 'late';
  return { tab: ORDER_TABS.some((t) => t.key === sp.get('tab')) ? sp.get('tab')! : 'all', filters: f };
}

/** Durum seçimi ek bilgi isteyen durumlar için pencere: kargo, fatura, iade */
type Pending = { orders: Order[]; status: OrderStatus } | null;

export default function OrdersPage() {
  return <Suspense fallback={<PageLoader />}><OrdersInner /></Suspense>;
}

function OrdersInner() {
  const sp = useSearchParams();
  const spKey = sp.toString();
  const staff = useIsStaff();
  const mpList = useMarketplaces();
  const shortName = useMarketplaceShortName();
  const connected = useConnectedMarketplaces();
  // İkinci mağaza ana mağazanın hemen yanında
  const chipList = [...(connected.length ? connected : mpList)].sort((a, b) =>
    BASE_MARKETPLACES.indexOf(baseOf(a)) - BASE_MARKETPLACES.indexOf(baseOf(b)) || Number(isSecondAccount(a)) - Number(isSecondAccount(b)));
  const [init] = useState(() => fromUrl(new URLSearchParams(spKey)));
  const [tab, setTab] = useState(init.tab);
  const [draft, setDraft] = useState<Filters>(init.filters);
  const [filters, setFilters] = useState<Filters>(init.filters);
  const [showFilters, setShowFilters] = useState(() => Object.values(init.filters).some(Boolean));
  const [sort, setSort] = useState('date_desc');
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<string | null>(null);
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

  // Ana sayfadaki kutulardan gelince (ör. ?tab=shipped) ilgili siparişler açılır
  useEffect(() => {
    const u = fromUrl(new URLSearchParams(spKey));
    setTab(u.tab); setDraft(u.filters); setFilters(u.filters); setPage(0);
    if (Object.values(u.filters).some(Boolean)) setShowFilters(true);
  }, [spKey]);
  useEffect(() => { setSelected(new Set()); }, [tab, filters, sort, page]);
  const activeCount = Object.entries(filters).filter(([k, v]) => k !== 'marketplace' && v).length;
  const selectedStores = filters.marketplace ? filters.marketplace.split(',').filter(Boolean) as MarketplaceName[] : [];
  const setStores = (list: string[]) => { const f = { ...filters, marketplace: list.join(',') }; setFilters(f); setDraft((d) => ({ ...d, marketplace: f.marketplace })); setPage(0); };
  const applyFilters = () => { setFilters(draft); setPage(0); };
  const clearFilters = () => { const keep = { ...EMPTY, marketplace: filters.marketplace }; setDraft(keep); setFilters(keep); setPage(0); };

  const params = new URLSearchParams({ page: String(page), pageSize: '50', tab, sort, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), ...(chipList.length > 1 && { mps: chipList.join(',') }) });
  const { data, error, loading, reload } = useLiveData<{ orders: Order[]; total: number; pageSize: number; lateCount?: number; tabCounts?: Record<string, number>; marketplaceCounts?: Record<string, number> }>(`/api/orders?${params}`);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const orders = data?.orders ?? [];
  const chosen = orders.filter((o) => selected.has(o.id));

  async function issueInvoices() {
    setBusy(true);
    try {
      const r = await api<{ results: Array<{ orderId: string; ok: boolean; message: string }> }>('/api/invoices', { method: 'POST', body: { action: 'issue', ids: chosen.map((o) => o.id) } });
      const ok = r.results.filter((x) => x.ok).length;
      const bad = r.results.filter((x) => !x.ok);
      toast(bad.length ? `${ok} fatura kesildi, ${bad.length} kesilemedi: ${bad[0].message}` : `${ok} fatura kesildi.`, bad.length ? 'err' : 'ok');
      if (!r.results.length) toast('Seçilen siparişlerin faturası zaten kesilmiş.');
      setSelected(new Set()); reload(); bump();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }

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
      <InvoiceModal orderId={invoiceFor} onClose={() => setInvoiceFor(null)} onChanged={() => { reload(); bump(); }} />

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

      {/* Mağaza seçimi: dokununca hemen süzülür, birden çok seçilebilir */}
      {chipList.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500 shrink-0">Mağaza:</span>
          <button onClick={() => setStores([])}
            className={cx('shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors', !selectedStores.length ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-400')}>
            Tümü
          </button>
          {chipList.map((m) => {
            const on = selectedStores.includes(m);
            const color = MARKETPLACE_META[m].chart;
            const n = data?.marketplaceCounts?.[m];
            return (
              <button key={m} onClick={() => setStores(on ? selectedStores.filter((x) => x !== m) : [...selectedStores, m])} aria-pressed={on}
                className={cx('shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors', on ? 'text-white' : 'bg-white text-slate-700 hover:border-slate-400', isSecondAccount(m) && !on && 'border-dashed')}
                style={on ? { background: color, borderColor: color } : { borderColor: mixHex(color, '#FFFFFF', 0.4) }}>
                <span className="w-2 h-2 rounded-full" style={{ background: on ? '#fff' : color }} />
                {shortName(m)}
                {n != null && <span className={cx('text-xs rounded-full px-1.5', on ? 'bg-white/25' : 'bg-slate-100 text-slate-500')}>{n.toLocaleString('tr-TR')}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Sekmeler: durum grupları ve sayıları */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto scroll-thin">
        <div className="flex min-w-max">
          {ORDER_TABS.map((t) => (
            <button key={t.key} onClick={() => { setTab(t.key); setPage(0); }}
              className={cx('px-4 py-3 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors', tab === t.key ? 'border-indigo-600 text-indigo-700 font-semibold' : 'border-transparent text-slate-600 hover:text-slate-900')}>
              {t.label}
              {data?.tabCounts && <span className={cx('ml-1.5 text-xs rounded-full px-1.5 py-0.5', tab === t.key ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500')}>{(data.tabCounts[t.key] ?? 0).toLocaleString('tr-TR')}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Filtre kutusu */}
      <Card className="p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setShowFilters((x) => !x)} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <Filter className="w-4 h-4 text-slate-400" /> Filtrele {activeCount > 0 && <span className="text-[11px] bg-indigo-600 text-white rounded-full px-1.5">{activeCount}</span>}
          </button>
          {activeCount > 0 && <button onClick={clearFilters} className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Temizle</button>}
          <span className="flex-1" />
          {(data?.lateCount ?? 0) > 0 && filters.deadline !== 'late' && (
            <button onClick={() => { const f = { ...filters, deadline: 'late' }; setDraft(f); setFilters(f); setPage(0); }} className="text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2.5 py-1">
              {data!.lateCount} geciken sipariş
            </button>
          )}
        </div>
        {showFilters && (
          <form onSubmit={(e) => { e.preventDefault(); applyFilters(); }} className="mt-3 pt-3 border-t border-slate-100">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <FilterInput label="Müşteri adı" value={draft.customer} onChange={(v) => setDraft({ ...draft, customer: v })} />
              <FilterInput label="Sipariş / paket no" value={draft.orderNo} onChange={(v) => setDraft({ ...draft, orderNo: v })} />
              <FilterInput label="Barkod" value={draft.barcode} onChange={(v) => setDraft({ ...draft, barcode: v })} />
              <FilterInput label="Kargo takip kodu" value={draft.tracking} onChange={(v) => setDraft({ ...draft, tracking: v })} />
              <FilterInput label="Ürün adı / model kodu" value={draft.product} onChange={(v) => setDraft({ ...draft, product: v })} />
              <FilterSelect label="Kargoya teslim süresi" value={draft.deadline} onChange={(v) => setDraft({ ...draft, deadline: v })}>
                <option value="">Tümü</option>
                <option value="late">Süresi geçenler</option>
                <option value="today">Bugün dolanlar</option>
                <option value="ok">Süresi olanlar</option>
              </FilterSelect>
              <FilterSelect label="Fatura" value={draft.invoice} onChange={(v) => setDraft({ ...draft, invoice: v })}>
                <option value="">Tümü</option>
                <option value="missing">Faturası kesilmemiş</option>
              </FilterSelect>
              <FilterInput label="Sipariş başlangıç tarihi" type="date" value={draft.from} onChange={(v) => setDraft({ ...draft, from: v })} />
              <FilterInput label="Sipariş bitiş tarihi" type="date" value={draft.to} onChange={(v) => setDraft({ ...draft, to: v })} />
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <Button variant="ghost" onClick={clearFilters}>Temizle</Button>
              <Button type="submit"><Search className="w-4 h-4" /> Filtrele</Button>
            </div>
          </form>
        )}
      </Card>

      {chosen.length > 0 && (
        <Card className="p-3 flex flex-wrap items-center gap-2 sticky top-16 z-20 border-indigo-200 bg-indigo-50">
          <span className="text-sm font-medium flex items-center gap-1.5"><CheckSquare className="w-4 h-4 text-indigo-600" /> {chosen.length} sipariş seçildi</span>
          <span className="flex-1" />
          <select className={`${inputClass} !w-auto py-1.5`} value="" onChange={(e) => e.target.value && ask(chosen, e.target.value as OrderStatus)}>
            <option value="">Toplu durum değiştir…</option>
            {ORDER_STATUSES.filter((s) => s !== 'new').map((s) => <option key={s} value={s}>{ORDER_STATUS_META[s].label}</option>)}
          </select>
          <Button variant="secondary" loading={busy} onClick={issueInvoices}><FileText className="w-4 h-4" /> Fatura kes</Button>
          <Button variant="secondary" onClick={() => window.open(`/orders/labels?ids=${chosen.map((o) => o.id).join(',')}`, '_blank')}><Printer className="w-4 h-4" /> Kargo etiketi yazdır</Button>
          <Button onClick={() => ask(chosen, 'shipped')}><Truck className="w-4 h-4" /> Kargoya verildi</Button>
          <button onClick={() => setSelected(new Set())} className="p-2 text-slate-500" aria-label="Seçimi temizle"><X className="w-4 h-4" /></button>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span>{data ? `${data.total.toLocaleString('tr-TR')} sipariş` : ''}</span>
        {selectable.length > 0 && (
          <label className="flex items-center gap-1.5 cursor-pointer md:hidden">
            <input type="checkbox" className="accent-indigo-600" checked={allChecked} onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((o) => o.id)) : new Set())} /> Tümünü seç
          </label>
        )}
        <span className="flex-1" />
        <label className="flex items-center gap-1.5">
          <ArrowUpDown className="w-3.5 h-3.5" />
          <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }} className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-slate-700">
            {SORT_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {sort.startsWith('deadline') && <span className="basis-full text-[11px] text-slate-500">Kalan süreye göre sıralarken yalnızca kargoya verilmeyi bekleyen siparişler gösterilir (kargodaki, teslim edilen, iptal ve iadeler gizlenir).</span>}
      </div>

      {loading ? <PageLoader /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
        <>
          {/* Telefon: kart listesi */}
          <div className="md:hidden space-y-2">
            {!orders.length && <Card><Empty>{filters.deadline === 'late' ? 'Geciken sipariş yok. 👍' : 'Kriterlere uygun sipariş yok.'}</Empty></Card>}
            {orders.map((o) => {
              const rem = remaining(o);
              return (
                <Card key={o.id} className={cx('p-3 space-y-2.5', selected.has(o.id) && 'ring-2 ring-indigo-400', isLate(o) && 'border-rose-300')}>
                  <div className="flex items-center gap-2">
                    {!isClosedStatus(o.status) && <input type="checkbox" className="w-4 h-4 accent-indigo-600" checked={selected.has(o.id)} onChange={() => toggle(o.id)} />}
                    <MarketplaceBadge name={o.marketplace_name} />
                    <span className="font-mono text-xs text-slate-600 truncate">#{no(o)}</span>
                    {rem && <span className={cx('ml-auto text-[11px] font-medium rounded-full px-2 py-0.5 whitespace-nowrap', rem.cls)}>{rem.text}</span>}
                  </div>
                  <OrderMeta o={o} />
                  <div className="text-sm font-medium">{o.customer_name}</div>
                  <ItemList items={o.items} />
                  {o.return_reason && <div className="text-[11px] text-fuchsia-700">İade nedeni: {o.return_reason}</div>}
                  <div className="pt-2 border-t border-slate-100 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold tabular-nums">{tl2(o.total_amount)}</div>
                        <InvoiceBadge o={o} onOpen={() => setInvoiceFor(o.id)} />
                      </div>
                      {!staff && <button onClick={() => setDetail(o.id)} className="text-xs"><ProfitBadge value={costOf(o)?.net_profit} status={costOf(o)?.status} /></button>}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusSelect o={o} className="py-2 flex-1 min-w-0" />
                      {waitingShip(o) && (<>
                        <a href={`/orders/labels?ids=${o.id}`} target="_blank" rel="noreferrer" className="p-2 rounded-md bg-slate-100 text-slate-600" aria-label="Kargo etiketi yazdır"><Printer className="w-4 h-4" /></a>
                        <button onClick={() => ask([o], 'shipped')} className="p-2 rounded-md bg-indigo-50 text-indigo-700" aria-label="Kargoya verildi"><Truck className="w-4 h-4" /></button>
                      </>)}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Masaüstü: Trendyol düzenine benzer tablo */}
          <Card className="overflow-x-auto hidden md:block">
            {!orders.length ? <Empty>{filters.deadline === 'late' ? 'Geciken sipariş yok. 👍' : 'Kriterlere uygun sipariş yok.'}</Empty> : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    <th className="pl-4 py-3 w-8"><input type="checkbox" className="accent-indigo-600" checked={allChecked} disabled={!selectable.length} onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((o) => o.id)) : new Set())} /></th>
                    <th className="text-left px-3 py-3 font-semibold">Sipariş Bilgileri</th>
                    <th className="text-left px-2 py-3 font-semibold w-24">Alıcı</th>
                    <th className="text-left px-3 py-3 font-semibold">Ürün Bilgileri <span className="float-right font-normal">Birim fiyat</span></th>
                    <th className="text-left px-3 py-3 font-semibold">Kargo</th>
                    <th className="text-right px-3 py-3 font-semibold">Fatura</th>
                    <th className="text-left px-3 py-3 font-semibold">Durum</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orders.map((o) => {
                    const rem = remaining(o);
                    return (
                      <tr key={o.id} className={cx('align-top hover:bg-slate-50/70', selected.has(o.id) && 'bg-indigo-50/60', isLate(o) && 'bg-rose-50/40')}>
                        <td className="pl-4 py-3">{!isClosedStatus(o.status) && <input type="checkbox" className="accent-indigo-600" checked={selected.has(o.id)} onChange={() => toggle(o.id)} />}</td>
                        <td className="px-3 py-3 min-w-[190px]">
                          <div className="flex items-center gap-1.5 mb-1"><MarketplaceBadge name={o.marketplace_name} size="xs" /><span className="font-mono text-xs font-semibold text-slate-800">#{no(o)}</span></div>
                          <OrderMeta o={o} />
                          {rem && <div className={cx('inline-block mt-1.5 text-[11px] font-medium rounded-full px-2 py-0.5', rem.cls)}>⏱ {rem.text}</div>}
                        </td>
                        <td className="px-2 py-3 text-xs text-slate-700 w-24 max-w-[7rem] break-words">{o.customer_name}</td>
                        <td className="px-3 py-3 min-w-[300px] max-w-[440px]">
                          <ItemList items={o.items} price />
                          {o.return_reason && <div className="text-[11px] text-fuchsia-700 mt-1">İade: {o.return_reason}</div>}
                        </td>
                        <td className="px-3 py-3 text-xs">
                          <div className="font-medium text-slate-700">{o.carrier || '—'}</div>
                          {o.delivery_no && <div className="font-mono text-[11px] text-slate-500 mt-0.5">{o.delivery_no}</div>}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          <div className="text-[11px] text-slate-400">Satış tutarı</div>
                          <div className="font-semibold tabular-nums">{tl2(o.total_amount)}</div>
                          {!staff && (
                            <button onClick={() => setDetail(o.id)} className="hover:underline mt-0.5" title="Maliyet dökümü">
                              <ProfitBadge value={costOf(o)?.net_profit} status={costOf(o)?.status} />
                            </button>
                          )}
                          <div className="flex justify-end"><InvoiceBadge o={o} onOpen={() => setInvoiceFor(o.id)} /></div>
                        </td>
                        <td className="px-3 py-3">
                          <StatusSelect o={o} />
                          {waitingShip(o) && (
                            <div className="flex flex-col gap-1 mt-2">
                              <a href={`/orders/labels?ids=${o.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-indigo-700"><Printer className="w-3.5 h-3.5" /> Etiket yazdır</a>
                              <button onClick={() => ask([o], 'shipped')} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-indigo-700"><Truck className="w-3.5 h-3.5" /> Kargoya verildi</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
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

/** Siparişin fatura durumu (tıklayınca fatura penceresi) */
function InvoiceBadge({ o, onOpen }: { o: Order; onOpen: () => void }) {
  const inv = invOf(o);
  const t = inv?.status === 'issued' ? { c: 'text-emerald-700', l: `🧾 ${inv.invoice_number ?? 'Fatura kesildi'}` }
    : inv?.status === 'failed' ? { c: 'text-rose-600', l: '🧾 Fatura kesilemedi' }
    : inv ? { c: 'text-amber-700', l: '🧾 Fatura sırada' }
    : o.invoice_number ? { c: 'text-emerald-700', l: `🧾 ${o.invoice_number}` }
    : { c: 'text-slate-400 hover:text-indigo-600', l: '🧾 Fatura' };
  return <button onClick={onOpen} className={cx('block text-[11px] mt-0.5 hover:underline', t.c)} title={inv?.last_error ?? undefined}>{t.l}</button>;
}

/** Sipariş kodunun altındaki bilgiler: tarih, paket no, teslimat (kargo takip) no */
function OrderMeta({ o }: { o: Order }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] leading-snug">
      <dt className="text-slate-400">Sipariş tarihi</dt><dd className="text-slate-600">{fmtDate(o.order_date)}</dd>
      {o.package_no && <><dt className="text-slate-400">Paket no</dt><dd className="text-slate-600 font-mono">{o.package_no}</dd></>}
      {o.delivery_no && <><dt className="text-slate-400">Teslimat no</dt><dd className="text-slate-600 font-mono break-all">{o.delivery_no}</dd></>}
      {o.shipped_at && <><dt className="text-slate-400">Kargoya verildi</dt><dd className="text-slate-600">{fmtDate(o.shipped_at)}</dd></>}
    </dl>
  );
}

/** Ürün satırları: fotoğraf, ad, stok kodu, barkod, seçenek */
function ItemList({ items, price }: { items: Item[]; price?: boolean }) {
  return (
    <ul className="space-y-2">
      {items.map((i, k) => {
        const v = variantText(i.product?.variant_attrs);
        return (
          <li key={k} className="flex gap-3">
            <a href={i.product?.image_url ? fixImageUrl(i.product.image_url) : undefined} target="_blank" rel="noreferrer" className="shrink-0" title="Fotoğrafı büyüt">
              <ProductImage src={i.product?.image_url} px={300} className="w-20 h-28 sm:w-24 sm:h-32 rounded-lg border border-slate-200" />
            </a>
            <div className="min-w-0 flex-1 text-xs leading-snug">
              <div className="text-slate-800 font-medium text-[13px] line-clamp-3" title={i.product_title}>{i.quantity > 1 && <span className="text-indigo-700">{i.quantity}× </span>}{i.product_title}</div>
              <div className="text-slate-400 mt-0.5">Stok kodu: <span className="font-mono text-slate-500">{i.sku || '—'}</span></div>
              {i.product?.barcode && <div className="text-slate-400">Barkod: <span className="font-mono text-slate-500">{i.product.barcode}</span></div>}
              {v && <div className="text-slate-500">{v}</div>}
              {!i.product && <a href="/products?catalog=1" className="text-[11px] text-amber-700 hover:underline">Bu ürün panelde kayıtlı değil — fotoğraf için ürünleri çekin</a>}
            </div>
            {price && <div className="text-xs tabular-nums text-slate-700 whitespace-nowrap pl-2">{tl2(i.unit_price)}</div>}
          </li>
        );
      })}
    </ul>
  );
}

function FilterInput({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-slate-500 mb-1">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} py-1.5`} />
    </label>
  );
}
function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-slate-500 mb-1">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} py-1.5`}>{children}</select>
    </label>
  );
}
