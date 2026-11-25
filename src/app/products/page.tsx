'use client';
import { useIsStaff } from '@/components/role';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Calculator, CheckSquare, CloudDownload, Download, FileSpreadsheet, Plus, RefreshCw, Search, Sparkles, Tag, X } from 'lucide-react';
import ProductCostModal, { type ProductCfg } from '@/components/ProductCostModal';
import { MARKETPLACE_META, type MarketplaceName } from '@/lib/marketplaces/meta';
import { api, useLive, useLiveData, useToast } from '@/components/live';
import { Button, Card, Empty, ErrorBox, PageLoader, cx, fmtDate, inputClass, tl2 } from '@/components/ui';
import MarketplaceImport from '@/components/MarketplaceImport';
import CatalogImport from '@/components/CatalogImport';
import { BulkPriceModal, CsvImportModal } from '@/components/ProductBulk';
import { STATUS_LABEL, STATUS_STYLE, stockSynced, variantText, type Product } from '@/components/product-shared';

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
  const staff = useIsStaff();
  const { data, error, loading, reload } = useLiveData<{ products: Product[] }>('/api/products');
  const [importOpen, setImportOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  useEffect(() => { if (new URLSearchParams(window.location.search).get('catalog') === '1') setCatalogOpen(true); }, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [costFor, setCostFor] = useState<ProductCfg | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'error' | 'pending'>('all');
  const [connected, setConnected] = useState<MarketplaceName[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [priceFor, setPriceFor] = useState<string[] | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const toggle = (id: string) => setSelected((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toast = useToast();
  const { bump } = useLive();

  useEffect(() => {
    api<{ credentials: Array<{ marketplace: string; mode: string }> }>('/api/credentials')
      .then((r) => setConnected(r.credentials.filter((c) => c.mode !== 'off').map((c) => c.marketplace as MarketplaceName))).catch(() => {});
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
      if (needle && ![p.title, p.sku, p.barcode, p.brand, p.category, p.group_code ?? '', variantText(p.variant_attrs)].some((x) => (x ?? '').toLocaleLowerCase('tr-TR').includes(needle))) return false;
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
    <div className="space-y-4 sm:space-y-6 fade-in">
      <div className="flex flex-wrap gap-2 justify-end">
        {connected.length > 0 && !staff && <Button onClick={() => setCatalogOpen(true)}><CloudDownload className="w-4 h-4" /> Tüm ürünleri pazaryerlerinden çek</Button>}
        {connected.length > 0 && !staff && <Button variant="secondary" onClick={() => setImportOpen(true)}><Download className="w-4 h-4" /> Seçerek içe aktar</Button>}
        <Button variant="secondary" onClick={() => setCsvOpen(true)}><FileSpreadsheet className="w-4 h-4" /> Excel/CSV&apos;den yükle</Button>
        <Link href="/products/new" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white"><Plus className="w-4 h-4" /> Yeni Ürün Ekle</Link>
      </div>
      {selected.size > 0 && (
        <Card className="p-3 flex flex-wrap items-center gap-2 sticky top-16 z-20 border-indigo-200 bg-indigo-50">
          <span className="text-sm font-medium flex items-center gap-1.5"><CheckSquare className="w-4 h-4 text-indigo-600" /> {selected.size} ürün seçildi</span>
          <span className="flex-1" />
          <Button onClick={() => setPriceFor([...selected])}><Tag className="w-4 h-4" /> Fiyatları güncelle</Button>
          <button onClick={() => setSelected(new Set())} className="p-2 text-slate-500" aria-label="Seçimi temizle"><X className="w-4 h-4" /></button>
        </Card>
      )}

      {loading ? <PageLoader /> : error ? <ErrorBox error={error} onRetry={reload} /> : !products.length ? (
        connected.length > 0 && !staff ? (
          <Card className="p-6 text-center space-y-3">
            <div className="text-lg font-semibold">Pazaryerlerinizdeki ürünleri panele alın</div>
            <p className="text-sm text-slate-600 max-w-xl mx-auto">Bağlı pazaryerlerinizdeki ({connected.map((m) => MARKETPLACE_META[m].label).join(', ')}) bütün ürünler tek tuşla gelir. Aynı ürün birden fazla pazaryerinde varsa tek ürün olarak birleştirilir.</p>
            <Button onClick={() => setCatalogOpen(true)}><CloudDownload className="w-4 h-4" /> Tüm ürünleri pazaryerlerinden çek</Button>
          </Card>
        ) :
        <Card><Empty>Henüz ürün yok. <Link href="/products/new" className="text-indigo-600 underline">Yeni Ürün Ekle</Link> ile ilk ürününüzü oluşturun — fotoğraflar, açıklama ve fiyatla birlikte tüm bağlı pazaryerlerine gönderilir.</Empty></Card>
      ) : (
        <>
          {recent.length > 0 && (
            <section className="hidden md:block">
              <h2 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-amber-500" /> Yeni eklenen ürünler <span className="text-xs font-normal text-slate-500">(son 14 gün)</span></h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
                {recent.map((p) => (
                  <Link key={p.id} href={`/products/${p.id}`} className="block">
                    <Card className="overflow-hidden hover:shadow-md transition h-full">
                      <div className="flex gap-3 p-3">
                        <Thumb p={p} className="w-20 h-28 rounded-lg shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm line-clamp-2">{p.title}{variantText(p.variant_attrs) && <span className="ml-1 inline-block text-[10px] font-medium bg-violet-50 text-violet-700 rounded px-1.5 py-0.5 align-middle">{variantText(p.variant_attrs)}</span>}</div>
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
              <div className="relative w-full sm:w-64 sm:ml-auto"><Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" /><input className={`${inputClass} pl-9`} placeholder="Ad, SKU, barkod ara…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            </div>
            {/* Telefon: kart listesi */}
            <div className="md:hidden space-y-2">
              {!rows.length && <Card><Empty>Filtreye uyan ürün yok.</Empty></Card>}
              {rows.map((p) => {
                const issues = p.listings.filter((l) => l.listing_status === 'error' || !stockSynced(p, l));
                const live = p.listings.filter((l) => l.listing_status !== 'passive');
                return (
                  <Card key={p.id} className={cx('p-3', selected.has(p.id) && 'ring-2 ring-indigo-400')}>
                    <div className="flex gap-2">
                    <input type="checkbox" className="w-4 h-4 mt-1 accent-indigo-600 shrink-0" checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label="Seç" />
                    <Link href={`/products/${p.id}`} className="flex gap-3 flex-1 min-w-0">
                      <Thumb p={p} className="w-14 h-20 rounded-lg shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm line-clamp-2">{p.title}{variantText(p.variant_attrs) && <span className="ml-1 inline-block text-[10px] font-medium bg-violet-50 text-violet-700 rounded px-1.5 py-0.5 align-middle">{variantText(p.variant_attrs)}</span>}</div>
                        <div className="text-[11px] text-slate-500 font-mono truncate">{p.sku}</div>
                        <div className="flex items-center gap-2 mt-1"><span className="font-semibold text-sm">{tl2(p.price)}</span><StockPill p={p} /></div>
                      </div>
                    </Link>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {live.map((l) => {
                        const pr = p.profits?.[l.marketplace_name];
                        return (
                          <span key={l.marketplace_name} className={cx('px-1.5 py-0.5 rounded text-[10px]', STATUS_STYLE[l.listing_status], !stockSynced(p, l) && 'ring-2 ring-amber-400')}>
                            <b>{MARKETPLACE_META[l.marketplace_name].label}</b>{pr && <> · <span className={pr.netProfit < 0 ? 'text-rose-700' : ''}>{tl2(pr.netProfit)}</span></>}
                          </span>
                        );
                      })}
                      {!live.length && <span className="text-xs text-slate-400">Yayında değil</span>}
                    </div>
                    {issues.length > 0 && <div className="text-[11px] text-rose-600 mt-1.5 flex items-start gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /><span>{issues.map((l) => MARKETPLACE_META[l.marketplace_name].label).join(', ')}: {issues[0].sync_error_message ?? 'stok eşitlenmedi'}</span></div>}
                    <div className="flex justify-end gap-1 mt-1 -mb-1">
                      <Button variant="ghost" className="text-xs" onClick={() => setCostFor(p)}><Calculator className="w-3.5 h-3.5" /> Maliyet</Button>
                      <Button variant="ghost" className="text-xs" loading={busy === p.id} onClick={() => sync(p)}><RefreshCw className="w-3.5 h-3.5" /> Gönder</Button>
                    </div>
                  </Card>
                );
              })}
            </div>
            <Card className="overflow-x-auto hidden md:block">
              {!rows.length ? <Empty>Filtreye uyan ürün yok.</Empty> : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <tr>
                      <th className="pl-4 py-3 w-8"><input type="checkbox" className="accent-indigo-600" checked={rows.length > 0 && rows.every((p) => selected.has(p.id))} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((p) => p.id)) : new Set())} aria-label="Tümünü seç" /></th>
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
                        <tr key={p.id} className={cx('hover:bg-slate-50 align-top', selected.has(p.id) && 'bg-indigo-50/60')}>
                          <td className="pl-4 py-3"><input type="checkbox" className="accent-indigo-600 mt-1" checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label="Seç" /></td>
                          <td className="px-4 py-3">
                            <Link href={`/products/${p.id}`} className="flex items-center gap-3 group">
                              <Thumb p={p} className="w-10 h-14 rounded-lg shrink-0" />
                              <div className="min-w-0"><div className="font-medium group-hover:text-indigo-700 line-clamp-2">{p.title}{variantText(p.variant_attrs) && <span className="ml-1 inline-block text-[10px] font-medium bg-violet-50 text-violet-700 rounded px-1.5 py-0.5 align-middle">{variantText(p.variant_attrs)}</span>}</div><div className="text-xs text-slate-500 font-mono">{p.sku} · {p.barcode}</div></div>
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap"><div>{tl2(p.price)}</div>{!staff && <div className="text-xs text-slate-500">{tl2(p.cost_price)}</div>}</td>
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
      <BulkPriceModal ids={priceFor} onClose={() => { setPriceFor(null); setSelected(new Set()); }} />
      <CsvImportModal open={csvOpen} onClose={() => setCsvOpen(false)} />
      <CatalogImport open={catalogOpen} onClose={() => setCatalogOpen(false)} onDone={reload} />
      {connected.length > 0 && <MarketplaceImport open={importOpen} onClose={() => setImportOpen(false)} sources={connected} />}
    </div>
  );
}
