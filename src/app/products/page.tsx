'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Calculator, Download, Plus, RefreshCw, Search, Sparkles } from 'lucide-react';
import ProductCostModal, { type ProductCfg } from '@/components/ProductCostModal';
import { MARKETPLACE_META, type MarketplaceName } from '@/lib/marketplaces/meta';
import { api, useLive, useLiveData, useToast } from '@/components/live';
import { Button, Card, Empty, ErrorBox, PageLoader, cx, fmtDate, inputClass, tl2 } from '@/components/ui';
import TrendyolImport from '@/components/TrendyolImport';
import { STATUS_LABEL, STATUS_STYLE, stockSynced, type Product } from '@/components/product-shared';

function Thumb({ p, className }: { p: Product; className?: string }) {
  return p.image_url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={p.image_url} alt="" className={cx('object-cover bg-slate-100', className)} />
    : <div className={cx('bg-indigo-50 text-indigo-600 grid place-items-center text-xs font-bold', className)}>{p.title.slice(0, 2).toUpperCase()}</div>;
}

function StockPill({ p }: { p: Product }) {
  const out = p.total_stock <= 0;
  const low = !out && p.total_stock < p.low_stock_threshold;
  return <span className={cx('px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap', out ? 'bg-rose-600 text-white' : low ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700')}>{out ? 'Tükendi' : `${p.total_stock} adet`}{low && ' · kritik'}</span>;
}

export default function ProductsPage() {
  const { data, error, loading, reload } = useLiveData<{ products: Product[] }>('/api/products');
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [costFor, setCostFor] = useState<ProductCfg | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'error' | 'pending'>('all');
  const [tyConnected, setTyConnected] = useState(false);
  const toast = useToast();
  const { bump } = useLive();

  useEffect(() => {
    api<{ credentials: Array<{ marketplace: string; mode: string }> }>('/api/credentials')
      .then((r) => setTyConnected(r.credentials.some((c) => c.marketplace === 'trendyol' && c.mode !== 'off'))).catch(() => {});
  }, []);

  async function sync(p: Product) {
    setBusy(p.id);
    try {
      const r = await api<{ stock: Record<string, { ok: boolean; message: string }> }>(`/api/products/${p.id}/sync`, { method: 'POST' });
      const fails = Object.entries(r.stock).filter(([, x]) => !x.ok);
      toast(fails.length ? `${fails.map(([m]) => MARKETPLACE_META[m as MarketplaceName].label).join(', ')}: ${fails[0][1].message}` : Object.keys(r.stock).length ? 'Fiyat ve stok tüm pazaryerlerine gönderildi.' : 'Gönderilecek aktif ilan yok.', fails.length ? 'warn' : 'ok');
      bump();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally { setBusy(null); }
  }

  const products = useMemo(() => data?.products ?? [], [data]);
  const recent = useMemo(() => {
    const cut = Date.now() - 14 * 86_400_000;
    return products.filter((p) => new Date(p.created_at).getTime() >= cut).slice(0, 8);
  }, [products]);
  const rows = useMemo(() => {
    const needle = q.toLocaleLowerCase('tr-TR');
    return products.filter((p) => {
      if (needle && ![p.title, p.sku, p.barcode, p.brand, p.category].some((x) => (x ?? '').toLocaleLowerCase('tr-TR').includes(needle))) return false;
      if (filter === 'low') return p.total_stock < p.low_stock_threshold;
      if (filter === 'error') return p.listings.some((l) => l.listing_status === 'error' || !stockSynced(p, l));
      if (filter === 'pending') return p.listings.some((l) => l.listing_status === 'pending');
      return true;
    });
  }, [products, q, filter]);
  const counts = {
    low: products.filter((p) => p.total_stock < p.low_stock_threshold).length,
    error: products.filter((p) => p.listings.some((l) => l.listing_status === 'error' || !stockSynced(p, l))).length,
    pending: products.filter((p) => p.listings.some((l) => l.listing_status === 'pending')).length,
  };

  return (
    <div className="space-y-6 fade-in">
      <div className="flex flex-wrap gap-2 justify-end">
        {tyConnected && <Button variant="secondary" onClick={() => setImportOpen(true)}><Download className="w-4 h-4" /> Trendyol&apos;daki ürünleri içe aktar</Button>}
        <Link href="/products/new" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white"><Plus className="w-4 h-4" /> Yeni Ürün Ekle</Link>
      </div>

      {loading ? <PageLoader /> : error ? <ErrorBox error={error} onRetry={reload} /> : !products.length ? (
        <Card><Empty>Henüz ürün yok. <Link href="/products/new" className="text-indigo-600 underline">Yeni Ürün Ekle</Link> ile ilk ürününüzü oluşturun — fotoğraflar, açıklama ve fiyatla birlikte tüm bağlı pazaryerlerine gönderilir.</Empty></Card>
      ) : (
        <>
          {recent.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-amber-500" /> Yeni eklenen ürünler <span className="text-xs font-normal text-slate-500">(son 14 gün)</span></h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
                {recent.map((p) => (
                  <Link key={p.id} href={`/products/${p.id}`} className="block">
                    <Card className="overflow-hidden hover:shadow-md transition h-full">
                      <div className="flex gap-3 p-3">
                        <Thumb p={p} className="w-20 h-28 rounded-lg shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm line-clamp-2">{p.title}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">{p.sku} · {fmtDate(p.created_at)}</div>
                          <div className="flex items-center gap-2 mt-1.5"><span className="font-semibold text-sm">{tl2(p.price)}</span><StockPill p={p} /></div>
                          <div className="text-[11px] text-slate-500 mt-1">{p.images?.length ?? 0} fotoğraf</div>
                        </div>
                      </div>
                      <ul className="border-t border-slate-100 divide-y divide-slate-50 text-xs">
                        {p.listings.filter((l) => l.listing_status !== 'passive').map((l) => {
                          const pr = p.profits?.[l.marketplace_name];
                          return (
                            <li key={l.marketplace_name} className="flex items-center gap-2 px-3 py-1.5" title={l.sync_error_message ?? ''}>
                              <span className="w-24 shrink-0 truncate font-medium" style={{ color: MARKETPLACE_META[l.marketplace_name].color }}>{MARKETPLACE_META[l.marketplace_name].label}</span>
                              <span className={cx('px-1.5 rounded text-[10px] whitespace-nowrap', STATUS_STYLE[l.listing_status])}>{STATUS_LABEL[l.listing_status]}</span>
                              <span className="ml-auto tabular-nums whitespace-nowrap">{pr ? tl2(pr.price) : ''}</span>
                              {pr && <span className={cx('tabular-nums font-semibold w-24 text-right whitespace-nowrap', pr.netProfit < 0 ? 'text-rose-600' : 'text-emerald-700')}>{pr.netProfit >= 0 ? '+' : ''}{tl2(pr.netProfit)}</span>}
                            </li>
                          );
                        })}
                        {!p.listings.some((l) => l.listing_status !== 'passive') && <li className="px-3 py-1.5 text-slate-400">Pazaryerinde yayında değil</li>}
                      </ul>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h2 className="text-sm font-semibold text-slate-700 mr-2">Tüm ürünler ({products.length})</h2>
              {([['all', 'Tümü', products.length], ['low', 'Kritik stok', counts.low], ['error', 'Senkron sorunu', counts.error], ['pending', 'Onay bekleyen', counts.pending]] as const).map(([k, label, c]) => (
                <button key={k} onClick={() => setFilter(k)} className={cx('px-2.5 py-1 rounded-full text-xs border', filter === k ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-200 text-slate-600')}>{label} {c > 0 && <span className="opacity-70">({c})</span>}</button>
              ))}
              <div className="relative ml-auto w-64"><Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" /><input className={`${inputClass} pl-9`} placeholder="Ad, SKU, barkod ara…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            </div>
            <Card className="overflow-x-auto">
              {!rows.length ? <Empty>Filtreye uyan ürün yok.</Empty> : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <tr>
                      <th className="text-left px-4 py-3">Ürün</th>
                      <th className="text-right px-4 py-3">Fiyat / Maliyet</th>
                      <th className="text-center px-4 py-3">Stok</th>
                      <th className="text-left px-4 py-3">Pazaryerleri · fiyat · net kâr</th><th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((p) => {
                      const issues = p.listings.filter((l) => l.listing_status === 'error' || !stockSynced(p, l));
                      return (
                        <tr key={p.id} className="hover:bg-slate-50 align-top">
                          <td className="px-4 py-3">
                            <Link href={`/products/${p.id}`} className="flex items-center gap-3 group">
                              <Thumb p={p} className="w-10 h-14 rounded-lg shrink-0" />
                              <div className="min-w-0"><div className="font-medium group-hover:text-indigo-700 line-clamp-2">{p.title}</div><div className="text-xs text-slate-500 font-mono">{p.sku} · {p.barcode}</div></div>
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap"><div>{tl2(p.price)}</div><div className="text-xs text-slate-500">{tl2(p.cost_price)}</div></td>
                          <td className="px-4 py-3 text-center"><StockPill p={p} /></td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1.5">
                              {p.listings.filter((l) => l.listing_status !== 'passive').map((l) => {
                                const pr = p.profits?.[l.marketplace_name];
                                const synced = stockSynced(p, l);
                                return (
                                  <span key={l.marketplace_name} title={[l.sync_error_message, !synced && `Pazaryerindeki stok ${l.last_pushed_stock}, havuz ${p.total_stock}`, `Son senkron: ${fmtDate(l.last_synced_at)}`].filter(Boolean).join('\n')}
                                    className={cx('px-2 py-1 rounded-lg text-[11px] leading-tight cursor-help', STATUS_STYLE[l.listing_status], !synced && 'ring-2 ring-amber-400')}>
                                    <b>{MARKETPLACE_META[l.marketplace_name].label}</b>
                                    {pr && <> · {tl2(pr.price)} · <span className={pr.netProfit < 0 ? 'text-rose-700' : ''}>{tl2(pr.netProfit)}</span></>}
                                  </span>
                                );
                              })}
                              {!p.listings.some((l) => l.listing_status !== 'passive') && <span className="text-xs text-slate-400">Yayında değil</span>}
                            </div>
                            {issues.length > 0 && <div className="text-[11px] text-rose-600 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{issues.map((l) => MARKETPLACE_META[l.marketplace_name].label).join(', ')}: {issues[0].sync_error_message ?? 'stok eşitlenmedi'}</div>}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <Button variant="ghost" className="text-xs" onClick={() => setCostFor(p)} title="Maliyet, desi, komisyon, Bugün Kargoda ayarları"><Calculator className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" className="text-xs" loading={busy === p.id} onClick={() => sync(p)} title="Fiyat ve stoğu tüm pazaryerlerine şimdi gönder"><RefreshCw className="w-3.5 h-3.5" /></Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Card>
          </section>
        </>
      )}
      <ProductCostModal product={costFor} onClose={() => setCostFor(null)} />
      {tyConnected && <TrendyolImport open={importOpen} onClose={() => setImportOpen(false)} />}
    </div>
  );
}
