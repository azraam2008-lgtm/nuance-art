'use client';
import { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { MARKETPLACES, type MarketplaceName } from '@/lib/marketplaces/meta';
import type { RemoteProduct } from '@/lib/marketplaces/types';
import { api, useLive, useToast } from './live';
import { Button, MarketplaceBadge, Modal, tl2 } from './ui';

type Remote = RemoteProduct & { alreadyImported: boolean };

/** "Trendyol'dan İçe Aktar ve Diğerlerine Dağıt" */
export default function TrendyolImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { bump } = useLive();
  const [items, setItems] = useState<Remote[] | null>(null);
  const [mode, setMode] = useState<'live' | 'demo'>('demo');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [targets, setTargets] = useState<MarketplaceName[]>(['hepsiburada', 'n11', 'ciceksepeti']);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Array<{ sku: string; ok: boolean; message: string; publish?: Record<string, { ok: boolean; message: string }> }> | null>(null);

  useEffect(() => {
    if (!open) return;
    setItems(null); setError(null); setSelected([]); setResults(null);
    api<{ products: Remote[]; mode: 'live' | 'demo' }>('/api/products/import-trendyol')
      .then((r) => { setItems(r.products); setMode(r.mode); })
      .catch((e: Error) => setError(e.message));
  }, [open]);

  async function run() {
    if (!items) return;
    setBusy(true);
    try {
      const r = await api<{ results: NonNullable<typeof results> }>('/api/products/import-trendyol', {
        method: 'POST', body: { products: items.filter((i) => selected.includes(i.externalId)), marketplaces: targets },
      });
      setResults(r.results);
      toast('İçe aktarma tamamlandı.');
      bump();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} wide title={<span className="flex items-center gap-2"><MarketplaceBadge name="trendyol" /> Trendyol&apos;dan İçe Aktar ve Dağıt</span>}>
      {mode === 'demo' && items && <div className="mb-3 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">Demo modu: örnek Trendyol kataloğu gösteriliyor.</div>}
      {error && <div className="text-sm text-rose-700">{error}</div>}
      {!items && !error && <div className="flex justify-center py-10 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>}

      {results ? (
        <div className="space-y-3">
          {results.map((r) => (
            <div key={r.sku} className="border border-slate-200 rounded-lg p-3 text-sm">
              <div className="font-mono font-medium">{r.sku} — <span className={r.ok ? 'text-emerald-700' : 'text-rose-700'}>{r.message}</span></div>
              {r.publish && (
                <ul className="mt-2 space-y-1">
                  {Object.entries(r.publish).map(([mp, p]) => (
                    <li key={mp} className="flex items-center gap-2 text-xs"><MarketplaceBadge name={mp} size="xs" /><span className={p.ok ? 'text-emerald-700' : 'text-rose-700'}>{p.message}</span></li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <div className="flex justify-end"><Button onClick={onClose}>Kapat</Button></div>
        </div>
      ) : items && (
        <div className="space-y-4">
          {!items.length && <div className="text-sm text-slate-500 py-6 text-center">Trendyol mağazasında onaylı ürün bulunamadı.</div>}
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg max-h-80 overflow-y-auto">
            {items.map((p) => (
              <li key={p.externalId} className={`flex items-center gap-3 p-3 ${p.alreadyImported ? 'opacity-50' : ''}`}>
                <input type="checkbox" className="accent-indigo-600" disabled={p.alreadyImported} checked={selected.includes(p.externalId)}
                  onChange={(e) => setSelected((s) => (e.target.checked ? [...s, p.externalId] : s.filter((x) => x !== p.externalId)))} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.title}</div>
                  <div className="text-xs text-slate-500 font-mono">{p.sku} · {p.barcode} · {tl2(p.price)} · stok {p.stock}</div>
                </div>
                {p.alreadyImported && <span className="text-xs text-slate-500">Panelde var</span>}
              </li>
            ))}
          </ul>
          <div>
            <div className="text-xs font-medium text-slate-600 mb-2">Dağıtılacak pazaryerleri</div>
            <div className="flex flex-wrap gap-2">
              {MARKETPLACES.filter((m) => m !== 'trendyol').map((m) => (
                <label key={m} className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2 cursor-pointer">
                  <input type="checkbox" className="accent-indigo-600" checked={targets.includes(m)}
                    onChange={(e) => setTargets((s) => (e.target.checked ? [...s, m] : s.filter((x) => x !== m)))} />
                  <MarketplaceBadge name={m} />
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button variant="secondary" onClick={onClose}>Vazgeç</Button>
            <Button onClick={run} loading={busy} disabled={!selected.length} className="bg-[#F27A1A] hover:bg-[#d96a10]">
              <Download className="w-4 h-4" /> {selected.length || ''} Ürünü Aktar & Dağıt
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
