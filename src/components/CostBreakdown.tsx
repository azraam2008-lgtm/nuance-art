'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2, RefreshCw, Truck, XCircle } from 'lucide-react';
import { api, useLive, useToast } from './live';
import { Button, MarketplaceBadge, Modal, cx, fmtDate, tl2 } from './ui';

interface Line { code: string; label: string; group: string; gross: number; vat: number; recoverable: boolean; cost: number; note?: string }
interface Cost {
  status: 'estimate' | 'final'; rule_effective_from: string; revenue_gross: number; revenue_net: number; total_cost: number; vat_payable: number; net_profit: number;
  margin_on_revenue: number; same_day_eligible: boolean; same_day_met: boolean | null; fast_eligible: boolean; fast_met: boolean | null; deadline: string | null;
  lines: Line[]; notes: string[];
}
interface Order { id: string; external_order_id: string; marketplace_name: string; customer_name: string; status: string; order_date: string; shipped_at: string | null; carrier: string | null; desi: number | null; currency: string; fx_rate: number; items: Array<{ sku: string; product_title: string; quantity: number; unit_price: number }> }

const GROUP_LABEL: Record<string, string> = { commission: 'Komisyon', fee: 'Platform bedelleri', shipping: 'Kargo', tax: 'Vergi', product: 'Ürün', other: 'Diğer' };

export function ProfitBadge({ value, status }: { value: number | null | undefined; status?: string }) {
  if (value == null) return <span className="text-xs text-slate-400">—</span>;
  return (
    <span className={cx('inline-flex items-center gap-1 font-semibold tabular-nums', value < 0 ? 'text-rose-600' : 'text-emerald-700')} title={status === 'estimate' ? 'Tahmini (kargoya verilince kesinleşir)' : 'Kesin'}>
      {tl2(value)}{status === 'estimate' && <Clock className="w-3 h-3 text-slate-400" />}
    </span>
  );
}

function Speed({ c }: { c: Cost }) {
  const item = (label: string, eligible: boolean, met: boolean | null) => {
    if (!eligible) return <span className="text-slate-400">{label}: yok</span>;
    if (met === null) return <span className="flex items-center gap-1 text-amber-700"><Clock className="w-3.5 h-3.5" />{label}: bekleniyor</span>;
    return met
      ? <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" />{label}: sağlandı</span>
      : <span className="flex items-center gap-1 text-rose-700"><XCircle className="w-3.5 h-3.5" />{label}: kaçırıldı</span>;
  };
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {item('Bugün Kargoda', c.same_day_eligible, c.same_day_met)}
      {item('Hızlı gönderim / termin', c.fast_eligible, c.fast_met)}
      {c.deadline && <span className="text-slate-500">Son kargoya veriliş: {fmtDate(c.deadline)}</span>}
    </div>
  );
}

export default function CostBreakdown({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const [data, setData] = useState<{ order: Order; cost: Cost | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const { bump, version } = useLive();

  useEffect(() => {
    if (!orderId) { setData(null); return; }
    api<{ order: Order; cost: Cost | null }>(`/api/orders/${orderId}/cost`).then(setData).catch((e: Error) => toast(e.message, 'err'));
  }, [orderId, version, toast]);

  async function act(kind: 'ship' | 'recompute') {
    if (!orderId) return;
    setBusy(kind);
    try {
      await api(`/api/orders/${orderId}/${kind === 'ship' ? 'ship' : 'cost'}`, { method: 'POST', body: {} });
      const d = await api<{ order: Order; cost: Cost | null }>(`/api/orders/${orderId}/cost`);
      setData(d);
      toast(kind === 'ship' ? 'Kargoya verildi; kâr kesinleşti.' : 'Yeniden hesaplandı.');
      bump();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(null);
    }
  }

  const o = data?.order;
  const c = data?.cost;
  return (
    <Modal open={!!orderId} onClose={onClose} wide title={o ? <span className="flex items-center gap-2"><MarketplaceBadge name={o.marketplace_name} /> #{o.external_order_id.split('/')[0]} — Maliyet Dökümü</span> : 'Maliyet Dökümü'}>
      {!data ? <div className="flex justify-center py-12 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat label="Ciro (KDV dahil)" value={tl2(c?.revenue_gross ?? 0)} />
            <Stat label="Ciro (KDV hariç)" value={tl2(c?.revenue_net ?? 0)} />
            <Stat label="Toplam gider" value={tl2(c?.total_cost ?? 0)} />
            <Stat label="Net kâr" value={tl2(c?.net_profit ?? 0)} accent={(c?.net_profit ?? 0) < 0 ? 'text-rose-600' : 'text-emerald-700'}
              sub={c ? `Marj %${(c.margin_on_revenue * 100).toFixed(1)} · ${c.status === 'final' ? 'kesin' : 'tahmini'}` : ''} />
          </div>
          {o && (
            <div className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3 space-y-1">
              <div>{o.customer_name} · {fmtDate(o.order_date)} · {o.items.map((i) => `${i.quantity}× ${i.product_title} (${tl2(i.unit_price)})`).join(', ')}</div>
              <div className="flex flex-wrap gap-x-4">
                <span><Truck className="inline w-3.5 h-3.5 mr-1" />{o.carrier ?? 'varsayılan firma'}{o.desi != null ? ` · ${o.desi} desi` : ''}</span>
                <span>Kargoya veriliş: {o.shipped_at ? fmtDate(o.shipped_at) : 'henüz verilmedi'}</span>
                {o.currency !== 'TRY' && <span>Para birimi: {o.currency} (kur {Number(o.fx_rate).toFixed(4)})</span>}
              </div>
              {c && <Speed c={c} />}
            </div>
          )}
          {c && (
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500 border-b border-slate-200">
                <tr><th className="text-left py-2">Kalem</th><th className="text-right py-2">Tutar (KDV dahil)</th><th className="text-right py-2">İçindeki KDV</th><th className="text-right py-2">Kâra etkisi</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {c.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-2">
                      <div className="font-medium">{l.label} <span className="text-[10px] text-slate-400 uppercase">{GROUP_LABEL[l.group]}</span></div>
                      {l.note && <div className="text-[11px] text-slate-500">{l.note}</div>}
                    </td>
                    <td className="py-2 text-right tabular-nums">{tl2(l.gross)}</td>
                    <td className="py-2 text-right tabular-nums text-slate-500">{l.vat ? `${tl2(l.vat)}${l.recoverable ? '' : ' *'}` : '—'}</td>
                    <td className="py-2 text-right tabular-nums font-medium text-rose-700">−{tl2(l.cost)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2">KDV hariç ciro − giderler</td><td /><td />
                  <td className={cx('py-2 text-right tabular-nums', c.net_profit < 0 ? 'text-rose-600' : 'text-emerald-700')}>{tl2(c.net_profit)}</td>
                </tr>
              </tbody>
            </table>
          )}
          {c && (
            <div className="text-[11px] text-slate-500">
              Devlete ödenecek KDV farkı (bilgi): {tl2(c.vat_payable)}. KDV'si indirilebilen giderlerin kâra etkisi KDV hariç tutarıdır{c.lines.some((l) => l.vat && !l.recoverable) ? '; * işaretli KDV indirilemez, gider sayıldı' : ''}. Kural yürürlüğü: {c.rule_effective_from}.
            </div>
          )}
          {c?.notes?.length ? (
            <ul className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 space-y-1 list-disc pl-6">
              {c.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          ) : null}
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button variant="secondary" loading={busy === 'recompute'} onClick={() => act('recompute')}><RefreshCw className="w-4 h-4" /> Yeniden hesapla</Button>
            {o && !o.shipped_at && o.status !== 'cancelled' && o.status !== 'returned' && (
              <Button loading={busy === 'ship'} onClick={() => act('ship')}><Truck className="w-4 h-4" /> Şimdi kargoya verildi</Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cx('text-lg font-bold tabular-nums', accent)}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}
