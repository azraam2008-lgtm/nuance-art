'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
import { api } from './live';
import { MarketplaceBadge, cx, tl2 } from './ui';

export interface QuoteInput {
  unitCostNet: number; costVatRate: number; vatRate: number; desi: number; packagingNet: number;
  quotes: Array<{ marketplace: string; price: number; carrier?: string | null; sameDayTag?: boolean; fastTag?: boolean; handlingDays?: number; commissionRate?: number | null; manualShippingNet?: number | null }>;
}
export interface QuoteResult {
  marketplace: string; price: number; verified: boolean; commissionRate: number; netProfit: number; marginOnRevenue: number; marginOnCost: number; revenueNet: number;
  totals: Record<string, number>; lines: Array<{ code: string; label: string; cost: number; note?: string }>; notes: string[];
}

/** Girdi değiştikçe (gecikmeli) her pazaryeri için kesinti ve net kâr hesabını getirir */
export function useQuotes(input: QuoteInput | null) {
  const [data, setData] = useState<QuoteResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = JSON.stringify(input);
  useEffect(() => {
    if (t.current) clearTimeout(t.current);
    if (!input || !input.quotes.length) { setData([]); return; }
    t.current = setTimeout(() => {
      api<{ results: QuoteResult[] }>('/api/fees/quote', { method: 'POST', body: input })
        .then((r) => { setData(r.results); setError(null); })
        .catch((e: Error) => setError(e.message));
    }, 400);
    return () => { if (t.current) clearTimeout(t.current); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error };
}

/** Pazaryeri bazında: satış fiyatı, komisyon, platform bedelleri, kargo, stopaj, net kâr, marj */
export function ProfitTable({ results, compact }: { results: QuoteResult[]; compact?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!results.length) return <div className="text-sm text-slate-500">Hesaplanacak pazaryeri yok.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-slate-500 uppercase bg-slate-50">
          <tr>
            <th className="text-left px-3 py-2">Pazaryeri</th>
            <th className="text-right px-3 py-2">Satış fiyatı</th>
            <th className="text-right px-3 py-2">Komisyon</th>
            <th className="text-right px-3 py-2">Platform bedeli</th>
            <th className="text-right px-3 py-2">Kargo</th>
            {!compact && <th className="text-right px-3 py-2">Stopaj</th>}
            <th className="text-right px-3 py-2">Net kâr</th>
            <th className="text-right px-3 py-2">Marj</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {results.map((r) => (
            <Fragment key={r.marketplace}>
              <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => setOpen(open === r.marketplace ? null : r.marketplace)} title="Döküm için tıklayın">
                <td className="px-3 py-2"><div className="flex items-center gap-1.5"><MarketplaceBadge name={r.marketplace} size="xs" />{!r.verified && <span className="text-[9px] text-amber-700 bg-amber-50 rounded px-1">kural doğrulanmadı</span>}</div><div className="text-[10px] text-slate-500">%{r.commissionRate.toFixed(1)} komisyon</div></td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{tl2(r.price)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{tl2(r.totals.commission)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{tl2(r.totals.fee)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{tl2(r.totals.shipping)}</td>
                {!compact && <td className="px-3 py-2 text-right tabular-nums">{tl2(r.totals.tax)}</td>}
                <td className={cx('px-3 py-2 text-right tabular-nums font-semibold', r.netProfit < 0 ? 'text-rose-600' : 'text-emerald-700')}>{tl2(r.netProfit)}</td>
                <td className={cx('px-3 py-2 text-right tabular-nums', r.marginOnRevenue < 0 && 'text-rose-600')}>%{(r.marginOnRevenue * 100).toFixed(1)}</td>
              </tr>
              {open === r.marketplace && (
                <tr><td colSpan={compact ? 7 : 8} className="px-3 pb-3 bg-slate-50">
                  <table className="w-full text-xs mt-1">
                    <tbody>
                      <tr><td className="py-0.5">KDV hariç ciro</td><td className="text-right">{tl2(r.revenueNet)}</td></tr>
                      {r.lines.map((l, i) => <tr key={i}><td className="py-0.5">{l.label}{l.note && <span className="text-slate-400"> — {l.note}</span>}</td><td className="text-right text-rose-700">−{tl2(l.cost)}</td></tr>)}
                      <tr className="font-semibold"><td className="py-0.5">Net kâr</td><td className="text-right">{tl2(r.netProfit)}</td></tr>
                    </tbody>
                  </table>
                  {r.notes.length > 0 && <ul className="text-[11px] text-amber-700 mt-1 list-disc pl-4">{r.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
                </td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-slate-500 mt-1 px-1">Tutarlar KDV hariç, kâra etkisidir. Kargo: zamanında kargoya verildiği varsayımıyla (barem / desi tarifesi). Satıra tıklayınca kalem kalem döküm açılır.</p>
    </div>
  );
}
