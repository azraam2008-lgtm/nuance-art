'use client';
import { useRef, useState } from 'react';
import { CheckCircle2, CloudDownload, Loader2 } from 'lucide-react';
import { api, useLive } from './live';
import { Button, Modal } from './ui';
import { MARKETPLACE_META, type MarketplaceName } from '@/lib/marketplaces/meta';

interface Step {
  cursor: unknown; current: { marketplace: MarketplaceName; page: number } | null;
  fetched: number; created: number; linked: number; already: number; errors: string[]; notes: string[]; perMarketplace: Record<string, number>;
}
type Totals = { fetched: number; created: number; linked: number; already: number; errors: string[]; notes: string[]; per: Record<string, number> };
const EMPTY: Totals = { fetched: 0, created: 0, linked: 0, already: 0, errors: [], notes: [], per: {} };

/**
 * "Tüm ürünleri pazaryerlerinden çek": bağlı her pazaryerindeki bütün ürünleri alır,
 * aynı barkod/stok kodlu ürünleri tek ürün yapar ve her pazaryerini ilan olarak bağlar.
 */
export default function CatalogImport({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { bump } = useLive();
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle');
  const [t, setT] = useState<Totals>(EMPTY);
  const [now, setNow] = useState<string>('');
  const stop = useRef(false);

  async function run() {
    setState('running'); setT(EMPTY); stop.current = false;
    let cursor: unknown = null;
    let acc = { ...EMPTY, per: {} as Record<string, number> };
    try {
      do {
        const s: Step = await api('/api/products/import-all', { method: 'POST', body: { cursor } });
        cursor = s.cursor;
        const per = { ...acc.per };
        for (const [k, v] of Object.entries(s.perMarketplace)) per[k] = (per[k] ?? 0) + v;
        acc = { fetched: acc.fetched + s.fetched, created: acc.created + s.created, linked: acc.linked + s.linked, already: acc.already + s.already,
          errors: [...acc.errors, ...s.errors].slice(0, 100), notes: [...acc.notes, ...s.notes].slice(0, 100), per };
        setT(acc);
        if (s.current) setNow(`${MARKETPLACE_META[s.current.marketplace].label} · sayfa ${s.current.page + 1}`);
      } while (cursor && !stop.current);
    } catch (e) {
      acc = { ...acc, errors: [...acc.errors, (e as Error).message] };
      setT(acc);
    }
    setState('done'); bump(); onDone();
  }

  const close = () => { if (state === 'running') { stop.current = true; return; } setState('idle'); setT(EMPTY); onClose(); };
  return (
    <Modal open={open} onClose={close} title="Tüm ürünleri pazaryerlerinden çek">
      <div className="space-y-4 text-sm">
        {state === 'idle' && (
          <>
            <p>Bağlı bütün pazaryerlerinizdeki ürünler panele alınır:</p>
            <ul className="list-disc pl-5 space-y-1 text-slate-600">
              <li><b>Aynı ürün tek kez eklenir.</b> Barkodu (yoksa stok kodu) aynı olan ürünler birleştirilir; her pazaryeri o ürünün ilanı olarak bağlanır.</li>
              <li>Yalnızca bir pazaryerinde olan ürünler de eklenir.</li>
              <li>Pazaryerindeki fiyatlarınız korunur; pazaryerleri arasında fiyat farklıysa her birinin fiyatı ayrı saklanır.</li>
              <li>Aynı ürünün stoğu pazaryerlerinde farklıysa, fazla satışı önlemek için <b>sıfır olmayan en düşük stok</b> ortak stok olur ve birkaç dakika içinde tüm pazaryerlerine eşitlenir. Farklar aşağıda listelenir; isterseniz Stok sayfasından düzeltebilirsiniz.</li>
              <li>Tekrar çalıştırmak güvenlidir: zaten panelde olanlar tekrar eklenmez, yalnızca yeni ürünler gelir.</li>
            </ul>
            <p className="text-xs text-slate-500">Ürün sayısına göre birkaç dakika sürebilir; bu pencereyi açık tutun.</p>
            <Button onClick={run} className="w-full"><CloudDownload className="w-4 h-4" /> Başlat</Button>
          </>
        )}
        {state !== 'idle' && (
          <>
            <div className="flex items-center gap-2 font-medium">
              {state === 'running' ? <><Loader2 className="w-4 h-4 animate-spin text-indigo-600" /> Çekiliyor… {now}</> : <><CheckCircle2 className="w-4 h-4 text-emerald-600" /> Tamamlandı</>}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-slate-50 p-2"><div className="text-xl font-bold tabular-nums">{t.fetched}</div><div className="text-[11px] text-slate-500">ilan okundu</div></div>
              <div className="rounded-xl bg-emerald-50 p-2"><div className="text-xl font-bold tabular-nums text-emerald-700">{t.created}</div><div className="text-[11px] text-slate-500">yeni ürün</div></div>
              <div className="rounded-xl bg-indigo-50 p-2"><div className="text-xl font-bold tabular-nums text-indigo-700">{t.linked}</div><div className="text-[11px] text-slate-500">ilan bağlandı</div></div>
            </div>
            {Object.keys(t.per).length > 0 && <div className="text-xs text-slate-600">{Object.entries(t.per).map(([m, n]) => `${MARKETPLACE_META[m as MarketplaceName]?.label ?? m}: ${n}`).join(' · ')}</div>}
            {state === 'done' && t.fetched > 0 && <p className="text-xs text-slate-600">Panelde artık {t.created} yeni ürün var; {t.linked - t.created > 0 ? `${t.linked - t.created} ilan mevcut ürünlerle birleştirildi. ` : ''}{t.already ? `${t.already} ilan zaten bağlıydı.` : ''}</p>}
            {t.notes.length > 0 && (
              <details className="rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs"><summary className="cursor-pointer font-medium text-amber-800">{t.notes.length} üründe stok farkı vardı</summary>
                <ul className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">{t.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></details>
            )}
            {t.errors.length > 0 && (
              <details open className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800"><summary className="cursor-pointer font-medium">{t.errors.length} sorun</summary>
                <ul className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">{t.errors.map((n, i) => <li key={i}>{n}</li>)}</ul></details>
            )}
            <Button variant={state === 'done' ? 'primary' : 'secondary'} onClick={close} className="w-full">{state === 'running' ? 'Durdur' : 'Kapat'}</Button>
          </>
        )}
      </div>
    </Modal>
  );
}
