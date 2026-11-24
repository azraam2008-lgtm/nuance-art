'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Printer } from 'lucide-react';
import { code128Widths, encodable } from '@/lib/shipping/code128';
import { MARKETPLACE_META, isMarketplace } from '@/lib/marketplaces/meta';
import { BRAND } from '@/lib/brand';

interface Label {
  id: string; orderNo: string; marketplace: string; orderDate: string;
  label: { trackingNumber: string | null; carrier: string | null; recipient: string; address: string; phone: string | null; source: string };
  items: Array<{ sku: string; title: string; quantity: number; variant: string; image: string | null }>;
}

/** Kargo takip numarasının barkodu (Code 128) */
function Barcode({ value }: { value: string }) {
  const widths = code128Widths(value);
  const quiet = 10;
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  let x = quiet;
  const bars = widths.map((w, i) => {
    const r = i % 2 === 0 ? <rect key={i} x={x} y={0} width={w} height={50} fill="#000" /> : null;
    x += w;
    return r;
  });
  return <svg viewBox={`0 0 ${total} 50`} preserveAspectRatio="none" className="w-full h-[22mm]" role="img" aria-label={`Barkod ${value}`}>{bars}</svg>;
}

const mpLabel = (m: string) => (isMarketplace(m) ? MARKETPLACE_META[m].label : m);

function Labels() {
  const ids = useSearchParams().get('ids') ?? '';
  const [data, setData] = useState<{ labels: Label[]; demo: boolean } | null>(null);
  const [store, setStore] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<'label' | 'a4'>('label');

  useEffect(() => {
    try { const v = localStorage.getItem('label-size'); if (v === 'a4' || v === 'label') setSize(v); } catch { /* yok */ }
    fetch(`/api/orders/labels?ids=${encodeURIComponent(ids)}`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (r.ok) setData(d); else setError(d.error ?? 'Etiketler alınamadı.');
    }).catch(() => setError('Bağlantı kurulamadı.'));
    fetch('/api/auth/status').then((r) => r.json()).then((s) => setStore(s.companyName ?? '')).catch(() => {});
  }, [ids]);

  function choose(v: 'label' | 'a4') {
    setSize(v);
    try { localStorage.setItem('label-size', v); } catch { /* yok */ }
  }

  if (error) return <div className="p-6 text-rose-700">{error}</div>;
  if (!data) return <div className="p-6 text-slate-500">Etiketler hazırlanıyor…</div>;
  const missing = data.labels.filter((l) => !l.label.trackingNumber);

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      <style>{size === 'label'
        ? '@page { size: 100mm 150mm; margin: 0 } .lbl { width: 100mm; height: 150mm; padding: 5mm }'
        : '@page { size: A4; margin: 12mm } .lbl { width: 100%; max-width: 160mm; min-height: 120mm; padding: 6mm }'}
      </style>

      <div className="print:hidden sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="font-semibold">{data.labels.length} kargo etiketi</div>
        <select className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white" value={size} onChange={(e) => choose(e.target.value as 'label' | 'a4')}>
          <option value="label">Etiket yazıcı (10 × 15 cm)</option>
          <option value="a4">Normal yazıcı (A4, sayfa başına 1)</option>
        </select>
        <button onClick={() => window.print()} className="ml-auto inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-medium"><Printer className="w-4 h-4" /> Yazdır</button>
        {data.demo && <div className="w-full text-xs text-amber-700">Deneme mağazası: barkod ve adresler örnektir, kargoda kullanılamaz.</div>}
        {missing.length > 0 && (
          <div className="w-full text-xs text-rose-700 flex gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0" />
            {missing.length} siparişte kargo barkodu pazaryerinden gelmedi. Bunların sevk fişi yazdırılır; kargo etiketini ilgili pazaryerinin panelinden alın veya siparişe takip numarası girin.
          </div>
        )}
        <div className="w-full text-[11px] text-slate-500">İlk gerçek siparişte barkodu kargo görevlisine okutup deneyin; okunmazsa etiketi pazaryeri panelinden yazdırın ve bize bildirin.</div>
      </div>

      <div className="p-4 print:p-0 flex flex-col items-center gap-4 print:gap-0">
        {data.labels.map((l) => (
          <div key={l.id} className="lbl bg-white shadow print:shadow-none text-black flex flex-col gap-2 overflow-hidden break-after-page" style={{ breakAfter: 'page' }}>
            <div className="flex items-center justify-between text-[11px] border-b border-black pb-1">
              <b className="text-sm">{mpLabel(l.marketplace)}</b>
              <span>Sipariş #{l.orderNo} · {new Date(l.orderDate).toLocaleDateString('tr-TR')}</span>
            </div>

            {l.label.trackingNumber && encodable(l.label.trackingNumber) ? (
              <div className="text-center">
                {l.label.carrier && <div className="text-xs font-semibold uppercase">{l.label.carrier}</div>}
                <Barcode value={l.label.trackingNumber} />
                <div className="font-mono text-sm tracking-wider">{l.label.trackingNumber}</div>
              </div>
            ) : (
              <div className="border-2 border-dashed border-black p-2 text-xs text-center">
                Kargo barkodu yok — kargo etiketini {mpLabel(l.marketplace)} panelinden yazdırın.
                {l.label.trackingNumber && <div className="font-mono mt-1">Takip no: {l.label.trackingNumber}</div>}
              </div>
            )}

            <div className="border border-black p-2 text-xs leading-snug">
              <div className="text-[10px] font-bold">ALICI</div>
              <div className="text-sm font-bold">{l.label.recipient}</div>
              {l.label.address ? <div>{l.label.address}</div> : <div className="italic">Adres pazaryeri verisinde yok — pazaryeri panelinden kontrol edin.</div>}
              {l.label.phone && <div>Tel: {l.label.phone}</div>}
            </div>
            {store && <div className="text-[10px]"><b>GÖNDEREN:</b> {store}</div>}

            <div className="flex-1 min-h-0">
              <div className="text-[10px] font-bold border-b border-black">PAKET İÇERİĞİ</div>
              <table className="w-full text-[11px]">
                <tbody>
                  {l.items.map((i, k) => (
                    <tr key={k} className="border-b border-slate-300 align-top">
                      <td className="w-4 pt-1"><span className="inline-block w-3 h-3 border border-black" /></td>
                      <td className="w-8 font-bold pt-0.5">{i.quantity} ×</td>
                      <td className="pt-0.5">{i.title}{i.variant && <b> ({i.variant})</b>}<div className="text-[9px] text-slate-600 font-mono">{i.sku}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[8px] text-slate-500 text-right">{BRAND.name} ile hazırlandı</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LabelsPage() {
  return <Suspense fallback={null}><Labels /></Suspense>;
}
