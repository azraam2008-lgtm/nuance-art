'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Boxes, Check, Plus, RefreshCw } from 'lucide-react';
import { MARKETPLACES, MARKETPLACE_META, type MarketplaceName } from '@/lib/marketplaces/meta';
import { api, useLive, useLiveData, useToast } from '@/components/live';
import { Button, Card, Empty, ErrorBox, Field, Modal, PageLoader, cx, inputClass } from '@/components/ui';
import { variantText } from '@/components/product-shared';

interface Row {
  id: string; sku: string; title: string; total_stock: number; low_stock_threshold: number; start_stock: number;
  trendyol_sales: number; hepsiburada_sales: number; n11_sales: number; ciceksepeti_sales: number; is_critical: boolean;
  sales_by_marketplace: Record<string, number>; image_url: string | null; variant_attrs?: Record<string, string> | null;
  listings: Array<{ marketplace_name: MarketplaceName; listing_status: string; last_pushed_stock: number | null; sync_error_message: string | null; last_synced_at: string | null }>;
}
const inSync = (r: Row, l: Row['listings'][number]) => l.listing_status !== 'active' || l.last_pushed_stock === null || l.last_pushed_stock === Math.max(0, r.total_stock);

export default function StockPage() {
  const { data, error, loading, reload } = useLiveData<{ rows: Row[] }>('/api/stock');
  const [editing, setEditing] = useState<Row | null>(null);
  const [qty, setQty] = useState('10');
  const [reason, setReason] = useState<'restock' | 'manual_adjust'>('restock');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { bump } = useLive();
  const [syncing, setSyncing] = useState(false);
  const [onlyIssues, setOnlyIssues] = useState(false);
  // Yalnızca ilanı veya satışı olan pazaryerlerini sütun olarak göster
  const cols = useMemo(() => MARKETPLACES.filter((m) => data?.rows.some((r) => r.listings.some((l) => l.marketplace_name === m) || (r.sales_by_marketplace?.[m] ?? 0) > 0)), [data]);
  const issues = (data?.rows ?? []).filter((r) => r.listings.some((l) => !inSync(r, l) || l.listing_status === 'error'));
  const stats = {
    out: (data?.rows ?? []).filter((r) => r.total_stock <= 0).length,
    crit: (data?.rows ?? []).filter((r) => r.is_critical && r.total_stock > 0).length,
    units: (data?.rows ?? []).reduce((s, r) => s + Math.max(0, r.total_stock), 0),
  };
  const rows = (data?.rows ?? []).filter((r) => !onlyIssues || issues.includes(r));

  async function syncAll() {
    setSyncing(true);
    try {
      const r = await api<{ products: number; summary: Record<string, { ok: boolean; message: string }> }>('/api/stock/sync', { method: 'POST' });
      const fails = Object.entries(r.summary).filter(([, x]) => !x.ok);
      toast(fails.length ? `${fails.map(([m]) => MARKETPLACE_META[m as MarketplaceName].label).join(', ')}: ${fails[0][1].message}` : `${r.products} ürünün stoğu tüm pazaryerlerine gönderildi.`, fails.length ? 'warn' : 'ok');
      bump();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setSyncing(false); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      const r = await api<{ totalStock: number }>(`/api/products/${editing.id}/stock`, { method: 'POST', body: { change: Number(qty), reason } });
      toast(`${editing.sku}: yeni stok ${r.totalStock}. Tüm pazaryerlerine gönderildi.`);
      setEditing(null);
      bump();
    } catch (err) {
      toast((err as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 fade-in">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4"><div className="text-xs text-slate-500">Havuzdaki toplam adet</div><div className="text-2xl font-bold">{stats.units}</div></Card>
        <Card className="p-4"><div className="text-xs text-slate-500">Tükenen ürün</div><div className={cx('text-2xl font-bold', stats.out > 0 && 'text-rose-600')}>{stats.out}</div></Card>
        <Card className="p-4"><div className="text-xs text-slate-500">Kritik seviyede</div><div className={cx('text-2xl font-bold', stats.crit > 0 && 'text-amber-600')}>{stats.crit}</div></Card>
        <Card className="p-4"><div className="text-xs text-slate-500">Eşitlenmemiş ilan</div><div className={cx('text-2xl font-bold', issues.length > 0 && 'text-rose-600')}>{issues.length}</div></Card>
      </div>
      <div className="bg-indigo-50 border border-indigo-100 text-indigo-900 rounded-xl p-4 text-sm flex flex-col sm:flex-row gap-3 items-start">
        <Boxes className="w-5 h-5 shrink-0 mt-0.5 hidden sm:block" />
        <div className="flex-1">
          <b>Ortak stok havuzu:</b> Bir pazaryerinde satış olduğunda stok tek sayaçtan düşer ve yeni stok diğer tüm pazaryerlerine otomatik gönderilir.
          Örn. 25 adet − 3 Trendyol − 2 N11 = <b>20</b> → diğer pazaryerlerine 20 gönderilir. Pazaryeri hücresindeki küçük sayı, o pazaryerine en son gönderilen stoktur.
        </div>
        <div className="flex sm:flex-col items-center sm:items-stretch gap-3 sm:gap-1.5 shrink-0 w-full sm:w-auto">
          <Button loading={syncing} onClick={syncAll}><RefreshCw className="w-4 h-4" /> Tümünü eşitle</Button>
          <label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Yalnızca sorunlular</label>
        </div>
      </div>

      {loading ? <PageLoader /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
        <>
        {/* Telefon: kart listesi */}
        <div className="md:hidden space-y-2">
          {!rows.length && <Card><Empty>{onlyIssues ? 'Tüm ilanlar eşit — sorun yok.' : 'Stok havuzunda ürün yok.'}</Empty></Card>}
          {rows.map((r) => (
            <Card key={r.id} className={cx('p-3', r.is_critical && 'border-rose-200 bg-rose-50/40')}>
              <div className="flex items-center gap-3">
                <Link href={`/products/${r.id}`} className="flex items-center gap-2 min-w-0 flex-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {r.image_url ? <img src={r.image_url} alt="" className="w-10 h-12 rounded object-cover shrink-0" /> : <div className="w-10 h-12 rounded bg-slate-100 shrink-0" />}
                  <div className="min-w-0"><div className="font-medium text-sm line-clamp-2">{r.title}{variantText(r.variant_attrs) && <span className="ml-1 inline-block text-[10px] font-medium bg-violet-50 text-violet-700 rounded px-1.5 py-0.5 align-middle">{variantText(r.variant_attrs)}</span>}</div><div className="text-[11px] text-slate-500 font-mono">{r.sku} · eşik {r.low_stock_threshold}</div></div>
                </Link>
                <div className="text-right shrink-0">
                  <div className={cx('text-xl font-bold', r.is_critical ? 'text-rose-600' : 'text-slate-900')}>{r.total_stock}</div>
                  {r.total_stock <= 0 ? <span className="bg-rose-600 text-white text-[10px] font-semibold rounded-full px-2 py-0.5">TÜKENDİ</span> : r.is_critical && <span className="bg-amber-500 text-white text-[10px] font-semibold rounded-full px-2 py-0.5">KRİTİK</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {r.listings.map((l) => {
                  const ok = inSync(r, l) && l.listing_status !== 'error';
                  return (
                    <span key={l.marketplace_name} className={cx('text-[10px] px-1.5 py-0.5 rounded border', l.listing_status === 'pending' ? 'border-amber-200 text-amber-700' : ok ? 'border-emerald-200 text-emerald-700' : 'border-rose-300 text-rose-700 font-semibold')}
                      title={l.sync_error_message ?? ''}>
                      {MARKETPLACE_META[l.marketplace_name].label}: {l.listing_status === 'pending' ? 'onayda' : `${l.last_pushed_stock ?? '—'}${ok ? ' ✓' : ' ⚠'}`}
                    </span>
                  );
                })}
              </div>
              {r.listings.some((l) => l.sync_error_message) && <div className="text-[11px] text-rose-600 mt-1">{r.listings.find((l) => l.sync_error_message)?.sync_error_message}</div>}
              <div className="flex justify-between items-center mt-2">
                <span className="text-[11px] text-slate-500">Başlangıç {r.start_stock} · satılan {Object.values(r.sales_by_marketplace ?? {}).reduce((a, b) => a + b, 0)}</span>
                <Button variant="secondary" className="text-xs px-2 py-1" onClick={() => { setEditing(r); setQty('10'); setReason('restock'); }}><Plus className="w-3 h-3" /> Stok</Button>
              </div>
            </Card>
          ))}
        </div>
        <Card className="overflow-x-auto hidden md:block">
          {!rows.length ? <Empty>{onlyIssues ? 'Tüm ilanlar eşit — sorun yok.' : 'Stok havuzunda ürün yok.'}</Empty> : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Ürün</th>
                  <th className="text-right px-4 py-3">Başlangıç Stoğu</th>
                  {cols.map((m) => (
                    <th key={m} className="text-right px-4 py-3 whitespace-nowrap"><span style={{ color: MARKETPLACE_META[m].color }}>{MARKETPLACE_META[m].label}</span></th>
                  ))}
                  <th className="text-right px-4 py-3">Kalan Net Stok</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className={cx(r.is_critical && 'bg-rose-50/60')}>
                    <td className="px-4 py-3 min-w-[240px]"><Link href={`/products/${r.id}`} className="flex items-center gap-2 hover:text-indigo-700">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {r.image_url ? <img src={r.image_url} alt="" className="w-8 h-10 rounded object-cover" /> : <div className="w-8 h-10 rounded bg-slate-100" />}
                      <div><div className="font-medium">{r.title}{variantText(r.variant_attrs) && <span className="ml-1 inline-block text-[10px] font-medium bg-violet-50 text-violet-700 rounded px-1.5 py-0.5 align-middle">{variantText(r.variant_attrs)}</span>}</div><div className="text-xs text-slate-500 font-mono">{r.sku} · eşik {r.low_stock_threshold}</div></div></Link></td>
                    <td className="px-4 py-3 text-right">{r.start_stock}</td>
                    {cols.map((m) => {
                      const v = r.sales_by_marketplace?.[m] ?? 0;
                      const l = r.listings.find((x) => x.marketplace_name === m);
                      const ok = l ? inSync(r, l) && l.listing_status !== 'error' : true;
                      return (
                        <td key={m} className="px-4 py-3 text-right" title={l ? [l.sync_error_message, `Gönderilen stok: ${l.last_pushed_stock ?? '—'}`].filter(Boolean).join('\n') : 'İlan yok'}>
                          <div className={cx(!v && 'text-slate-300')}>{v ? `−${v}` : '0'}</div>
                          {l ? (
                            <div className={cx('text-[10px] inline-flex items-center gap-0.5', l.listing_status === 'pending' ? 'text-amber-600' : ok ? 'text-emerald-600' : 'text-rose-600 font-semibold')}>
                              {l.listing_status === 'pending' ? 'onayda' : ok ? <><Check className="w-3 h-3" />{l.last_pushed_stock ?? '—'}</> : <><AlertTriangle className="w-3 h-3" />{l.last_pushed_stock ?? '—'}</>}
                            </div>
                          ) : <div className="text-[10px] text-slate-300">ilan yok</div>}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right">
                      <span className={cx('inline-flex items-center gap-1.5 font-bold', r.is_critical ? 'text-rose-600' : 'text-slate-900')}>
                        {r.total_stock}
                        {r.total_stock <= 0 ? <span className="bg-rose-600 text-white text-[10px] font-semibold rounded-full px-2 py-0.5">TÜKENDİ</span> : r.is_critical && <span className="bg-amber-500 text-white text-[10px] font-semibold rounded-full px-2 py-0.5">KRİTİK</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="secondary" className="text-xs px-2 py-1" onClick={() => { setEditing(r); setQty('10'); setReason('restock'); }}><Plus className="w-3 h-3" /> Stok</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        </>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Stok Hareketi — ${editing?.sku ?? ''}`}>
        <form onSubmit={save} className="space-y-4">
          <p className="text-sm text-slate-600">{editing?.title} · mevcut stok <b>{editing?.total_stock}</b></p>
          <Field label="İşlem">
            <select className={inputClass} value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
              <option value="restock">Stok girişi (tedarik)</option>
              <option value="manual_adjust">Sayım düzeltmesi (+/−)</option>
            </select>
          </Field>
          <Field label="Miktar" hint={reason === 'manual_adjust' ? 'Azaltmak için negatif değer girin (örn. -3).' : undefined}>
            <input type="number" step="1" min={reason === 'restock' ? 1 : undefined} className={inputClass} value={qty} onChange={(e) => setQty(e.target.value)} required />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>Vazgeç</Button>
            <Button type="submit" loading={busy}>Kaydet ve Tüm Pazaryerlerine Gönder</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
