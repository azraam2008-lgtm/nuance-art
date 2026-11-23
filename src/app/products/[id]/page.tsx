'use client';
import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Check, Minus, Pencil, Plus, RefreshCw, Rocket, Save, X } from 'lucide-react';
import { api, useLive, useLiveData, useToast } from '@/components/live';
import { Button, Card, ErrorBox, Field, MarketplaceBadge, PageLoader, cx, fmtDate, inputClass, tl2 } from '@/components/ui';
import ImageUploader from '@/components/ImageUploader';
import { STATUS_LABEL, STATUS_STYLE, stockSynced, variantText, type Listing, type Product } from '@/components/product-shared';
import { MARKETPLACE_META, type MarketplaceName } from '@/lib/marketplaces/meta';

interface FullProfit { price: number; commission: number; fee: number; shipping: number; tax: number; netProfit: number; margin: number; commissionRate: number; verified: boolean; lines: Array<{ label: string; cost: number; note?: string }>; notes: string[] }
interface Detail {
  product: Omit<Product, 'profits'> & { description: string; list_price: number | null; profits: Record<string, FullProfit> };
  movements: Array<{ marketplace_name: string | null; change_amount: number; reason: string; created_at: string }>;
  sales30: Record<string, { units: number; revenue: number }>;
  siblings?: Array<{ id: string; sku: string; variant_attrs: Record<string, string> | null; total_stock: number; price: number }>;
}
const REASON: Record<string, string> = { sale: 'Satış', cancel: 'İptal iadesi', restock: 'Stok girişi', manual_adjust: 'Düzeltme', initial: 'Açılış' };

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useLiveData<Detail>(`/api/products/${id}`);
  const toast = useToast();
  const { bump } = useLive();
  const [img, setImg] = useState(0);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<{ title: string; description: string; price: string; listPrice: string; costPrice: string; images: string[]; overrides: Record<string, string> } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [delta, setDelta] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [connected, setConnected] = useState<MarketplaceName[]>([]);

  useEffect(() => {
    api<{ credentials: Array<{ marketplace: MarketplaceName; mode: string }> }>('/api/credentials')
      .then((r) => setConnected(r.credentials.filter((c) => c.mode !== 'off').map((c) => c.marketplace))).catch(() => {});
  }, []);

  if (loading) return <PageLoader />;
  if (error || !data) return <ErrorBox error={error ?? 'Ürün bulunamadı'} onRetry={reload} />;
  const p = data.product;
  const listings = p.listings as Listing[];
  const images = p.images?.length ? p.images : p.image_url ? [p.image_url] : [];
  const unpublished = connected.filter((m) => !listings.some((l) => l.marketplace_name === m && ['active', 'pending'].includes(l.listing_status)));

  function startEdit() {
    setForm({
      title: p.title, description: p.description ?? '', price: String(p.price), listPrice: p.list_price != null ? String(p.list_price) : '', costPrice: String(p.cost_price), images,
      overrides: Object.fromEntries(listings.map((l) => [l.marketplace_name, l.price_override != null ? String(l.price_override) : ''])),
    });
    setEdit(true);
  }

  async function save() {
    if (!form) return;
    setBusy('save');
    try {
      const priceOverrides: Record<string, number | null> = {};
      for (const [mp, v] of Object.entries(form.overrides)) priceOverrides[mp] = v.trim() === '' ? null : Number(v.replace(',', '.'));
      const r = await api<{ stock: Record<string, { ok: boolean; message: string }>; content: Record<string, { ok: boolean; message: string }>; warnings?: Array<{ label: string; netProfit: number; margin: number; minMargin: number | null }> }>(`/api/products/${id}`, {
        method: 'PUT',
        body: { title: form.title, description: form.description, price: Number(form.price.replace(',', '.')), listPrice: form.listPrice ? Number(form.listPrice.replace(',', '.')) : null, costPrice: Number(form.costPrice.replace(',', '.')), images: form.images, priceOverrides },
      });
      const fails = [...Object.entries(r.stock), ...Object.entries(r.content)].filter(([, x]) => !x.ok);
      toast(fails.length ? `${MARKETPLACE_META[fails[0][0] as MarketplaceName]?.label}: ${fails[0][1].message}` : 'Kaydedildi ve pazaryerlerine gönderildi.', fails.length ? 'warn' : 'ok');
      if (r.warnings?.length) {
        const w = r.warnings[0];
        toast(`⚠ Dikkat: ${w.label} pazaryerinde bu fiyatla ${w.netProfit < 0 ? `zarar ediyorsunuz (${w.netProfit.toLocaleString('tr-TR')} ₺)` : `kâr marjı %${(w.margin * 100).toFixed(1)}, hedefiniz %${w.minMargin}`}${r.warnings.length > 1 ? ` · toplam ${r.warnings.length} uyarı` : ''}. Fiyat Hesaplayıcı'dan en düşük fiyatı görebilirsiniz.`, 'err');
      }
      setEdit(false); bump(); reload();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  }

  async function action(key: string, fn: () => Promise<string>) {
    setBusy(key);
    try { toast(await fn(), 'ok'); bump(); reload(); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  }
  const publish = (mps: MarketplaceName[]) => action(`pub-${mps.join()}`, async () => {
    const r = await api<{ results: Record<string, { ok: boolean; message: string }> }>(`/api/products/${id}/publish`, { method: 'POST', body: { marketplaces: mps } });
    const f = Object.entries(r.results).find(([, x]) => !x.ok);
    if (f) throw new Error(`${MARKETPLACE_META[f[0] as MarketplaceName].label}: ${f[1].message}`);
    return 'Yayın isteği gönderildi.';
  });
  const sync = () => action('sync', async () => {
    const r = await api<{ stock: Record<string, { ok: boolean; message: string }> }>(`/api/products/${id}/sync`, { method: 'POST' });
    const f = Object.entries(r.stock).find(([, x]) => !x.ok);
    if (f) throw new Error(`${MARKETPLACE_META[f[0] as MarketplaceName].label}: ${f[1].message}`);
    return 'Fiyat ve stok tüm pazaryerlerine gönderildi.';
  });
  const adjust = (sign: 1 | -1) => action('stock', async () => {
    const v = Math.abs(parseInt(delta, 10));
    if (!v) throw new Error('Miktar girin.');
    const r = await api<{ totalStock: number }>(`/api/products/${id}/stock`, { method: 'POST', body: { change: sign * v, reason: sign > 0 ? 'restock' : 'manual_adjust' } });
    setDelta('');
    return `Yeni stok: ${r.totalStock}. Tüm pazaryerlerine gönderildi.`;
  });

  const out = p.total_stock <= 0, low = p.total_stock < p.low_stock_threshold;

  return (
    <div className="space-y-5 fade-in">
      <div className="flex items-center gap-2">
        <Link href="/products" className="text-sm text-slate-500 hover:text-slate-800 flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Ürünler</Link>
        <div className="ml-auto flex gap-2">
          {!edit && <Button variant="secondary" onClick={startEdit}><Pencil className="w-4 h-4" /> Düzenle</Button>}
          <Button variant="secondary" loading={busy === 'sync'} onClick={sync}><RefreshCw className="w-4 h-4" /> Tümünü eşitle</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5">
        {/* Galeri */}
        <Card className="p-3 space-y-2 self-start">
          {edit && form ? (
            <ImageUploader images={form.images} onChange={(v) => setForm({ ...form, images: v })} />
          ) : images.length ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={images[Math.min(img, images.length - 1)]} alt="" className="w-full max-w-xs sm:max-w-none mx-auto aspect-[2/3] object-cover rounded-xl bg-slate-100" />
              <div className="grid grid-cols-5 gap-1.5">
                {images.map((u, i) => (
                  <button key={u} onClick={() => setImg(i)} className={cx('relative rounded-lg overflow-hidden border-2', i === img ? 'border-indigo-500' : 'border-transparent')}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="" className="aspect-square object-cover" />
                    <span className="absolute top-0 left-0 bg-white/90 text-[10px] px-1 rounded-br">{i + 1}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500">Pazaryerlerine bu sırayla gönderilir. 1. fotoğraf kapak görselidir.</p>
            </>
          ) : <div className="aspect-[2/3] rounded-xl bg-slate-100 grid place-items-center text-slate-400 text-sm">Fotoğraf yok</div>}
        </Card>

        <div className="space-y-5 min-w-0">
          {/* Bilgiler */}
          <Card className="p-5">
            {edit && form ? (
              <div className="space-y-3">
                <Field label="Ürün adı"><input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
                <Field label="Açıklama"><textarea className={`${inputClass} min-h-[160px]`} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Satış fiyatı (ortak)"><input className={inputClass} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
                  <Field label="Liste fiyatı"><input className={inputClass} value={form.listPrice} onChange={(e) => setForm({ ...form, listPrice: e.target.value })} /></Field>
                  <Field label="Maliyet (KDV hariç)"><input className={inputClass} value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} /></Field>
                </div>
                {listings.some((l) => l.listing_status !== 'passive') && (
                  <div>
                    <div className="text-xs font-medium text-slate-600 mb-1">Pazaryerine özel fiyat (boş = ortak fiyat)</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {listings.filter((l) => l.listing_status !== 'passive').map((l) => (
                        <label key={l.marketplace_name} className="text-xs"><span style={{ color: MARKETPLACE_META[l.marketplace_name].color }} className="font-medium">{MARKETPLACE_META[l.marketplace_name].label}</span>
                          <input className={`${inputClass} mt-0.5`} placeholder={form.price} value={form.overrides[l.marketplace_name] ?? ''} onChange={(e) => setForm({ ...form, overrides: { ...form.overrides, [l.marketplace_name]: e.target.value } })} />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-xs text-slate-500">Kaydettiğinizde fiyat ve stok tüm aktif ilanlara; başlık, açıklama ve fotoğraflar içerik güncellemesini destekleyen pazaryerlerine (Trendyol) gönderilir.</p>
                <div className="flex gap-2"><Button loading={busy === 'save'} onClick={save}><Save className="w-4 h-4" /> Kaydet ve gönder</Button><Button variant="ghost" onClick={() => setEdit(false)}><X className="w-4 h-4" /> Vazgeç</Button></div>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-semibold">{p.title}{variantText(p.variant_attrs) && <span className="ml-1 inline-block text-[10px] font-medium bg-violet-50 text-violet-700 rounded px-1.5 py-0.5 align-middle">{variantText(p.variant_attrs)}</span>}</h2>
                {(data.siblings?.length ?? 0) > 1 && (
                  <div className="mt-2">
                    <div className="text-xs text-slate-500 mb-1">Bu ürünün seçenekleri (ana kod {p.group_code}):</div>
                    <div className="flex flex-wrap gap-1.5">
                      {data.siblings!.map((v) => (
                        <Link key={v.id} href={`/products/${v.id}`} className={cx('text-xs rounded-lg border px-2 py-1', v.id === p.id ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-slate-200 hover:border-slate-300')}>
                          {variantText(v.variant_attrs) || v.sku} <span className={cx('ml-1 font-semibold', v.total_stock <= 0 ? 'text-rose-600' : 'text-slate-500')}>{v.total_stock}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
                <div className="text-xs text-slate-500 mt-0.5">{p.brand} · {p.category} · SKU <span className="font-mono">{p.sku}</span> · Barkod <span className="font-mono">{p.barcode}</span> · KDV %{Number(p.vat_rate)} · {Number(p.desi)} desi · Eklenme {fmtDate(p.created_at)}</div>
                <div className="flex flex-wrap gap-6 mt-3">
                  <div><div className="text-xs text-slate-500">Satış fiyatı</div><div className="text-lg font-semibold">{tl2(p.price)}</div>{p.list_price && Number(p.list_price) > Number(p.price) && <div className="text-xs text-slate-400 line-through">{tl2(p.list_price)}</div>}</div>
                  <div><div className="text-xs text-slate-500">Maliyet (KDV hariç)</div><div className="text-lg font-semibold">{tl2(p.cost_price)}</div></div>
                  <div><div className="text-xs text-slate-500">Son 30 gün satış</div><div className="text-lg font-semibold">{Object.values(data.sales30).reduce((s, x) => s + x.units, 0)} adet</div></div>
                </div>
                {p.description && <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700 mt-3 max-h-40 overflow-y-auto">{p.description}</pre>}
              </>
            )}
          </Card>

          {/* Stok */}
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <div className="text-xs text-slate-500">Ortak stok havuzu</div>
                <div className={cx('text-3xl font-bold tabular-nums', out ? 'text-rose-600' : low ? 'text-amber-600' : 'text-slate-900')}>{p.total_stock}</div>
                <div className="text-xs text-slate-500">Kritik eşik {p.low_stock_threshold}{out ? ' · TÜKENDİ — tüm pazaryerlerinde 0' : low ? ' · kritik seviyede' : ''}</div>
              </div>
              <div className="flex items-center gap-2 sm:ml-auto w-full sm:w-auto">
                <input className={`${inputClass} !w-20 sm:!w-24`} inputMode="numeric" placeholder="Adet" value={delta} onChange={(e) => setDelta(e.target.value.replace(/\D/g, ''))} />
                <Button variant="secondary" loading={busy === 'stock'} onClick={() => adjust(1)}><Plus className="w-4 h-4" /> Stok girişi</Button>
                <Button variant="secondary" disabled={busy === 'stock'} onClick={() => adjust(-1)}><Minus className="w-4 h-4" /> Düş</Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {listings.filter((l) => l.listing_status === 'active').map((l) => {
                const ok = stockSynced(p, l);
                return (
                  <span key={l.marketplace_name} className={cx('text-xs px-2 py-1 rounded-lg', ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800 ring-1 ring-amber-300')} title={l.sync_error_message ?? ''}>
                    {ok ? <Check className="w-3 h-3 inline" /> : <AlertTriangle className="w-3 h-3 inline" />} {MARKETPLACE_META[l.marketplace_name].label}: {l.last_pushed_stock ?? '—'} adet
                  </span>
                );
              })}
            </div>
            {data.movements.length > 0 && (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-slate-500">Son stok hareketleri</summary>
                <ul className="mt-1 divide-y divide-slate-100">
                  {data.movements.map((m, i) => (
                    <li key={i} className="py-1 flex gap-2"><span className="text-slate-400 w-28">{fmtDate(m.created_at)}</span><span className="w-24">{REASON[m.reason] ?? m.reason}</span>
                      <span className="w-24">{m.marketplace_name ? MARKETPLACE_META[m.marketplace_name as MarketplaceName]?.label : 'Panel'}</span>
                      <span className={cx('ml-auto font-semibold tabular-nums', m.change_amount < 0 ? 'text-rose-600' : 'text-emerald-700')}>{m.change_amount > 0 ? '+' : ''}{m.change_amount}</span></li>
                  ))}
                </ul>
              </details>
            )}
          </Card>

        </div>
      </div>

      {/* Pazaryerleri */}
      <Card className="overflow-x-auto">
        <div className="px-5 pt-4 pb-2 flex items-center gap-2">
          <h3 className="font-semibold">Pazaryerleri</h3>
          {unpublished.length > 0 && <Button className="ml-auto text-xs" loading={busy === `pub-${unpublished.join()}`} onClick={() => publish(unpublished)}><Rocket className="w-3.5 h-3.5" /> Yayınlanmayanlara gönder ({unpublished.length})</Button>}
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 uppercase bg-slate-50">
            <tr><th className="text-left px-4 py-2">Pazaryeri</th><th className="text-left px-3 py-2">Durum</th><th className="text-right px-3 py-2">Fiyat</th><th className="text-right px-3 py-2">Komisyon</th><th className="text-right px-3 py-2">Platform</th><th className="text-right px-3 py-2">Kargo</th><th className="text-right px-3 py-2">Net kâr</th><th className="text-right px-3 py-2">30 gün</th><th /></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {listings.map((l) => {
              const pr = p.profits[l.marketplace_name];
              const s = data.sales30[l.marketplace_name];
              return (
                <Fragment key={l.marketplace_name}>
                  <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => setOpen(open === l.marketplace_name ? null : l.marketplace_name)}>
                    <td className="px-4 py-2"><MarketplaceBadge name={l.marketplace_name} size="xs" /><div className="text-[10px] text-slate-400 font-mono mt-0.5">{l.external_product_id ?? ''}</div></td>
                    <td className="px-3 py-2"><span className={cx('px-1.5 py-0.5 rounded text-[11px] whitespace-nowrap', STATUS_STYLE[l.listing_status])}>{STATUS_LABEL[l.listing_status]}</span>
                      {l.sync_error_message && <div className="text-[11px] text-rose-600 mt-0.5 max-w-xs">{l.sync_error_message}</div>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pr ? tl2(pr.price) : '—'}{l.price_override != null && <div className="text-[10px] text-indigo-600">özel fiyat</div>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pr ? <>{tl2(pr.commission)}<div className="text-[10px] text-slate-400">%{pr.commissionRate.toFixed(1)}</div></> : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pr ? tl2(pr.fee) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pr ? tl2(pr.shipping) : '—'}</td>
                    <td className={cx('px-3 py-2 text-right tabular-nums font-semibold', pr && pr.netProfit < 0 ? 'text-rose-600' : 'text-emerald-700')}>{pr ? <>{tl2(pr.netProfit)}<div className="text-[10px] font-normal text-slate-400">%{(pr.margin * 100).toFixed(1)}</div></> : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs">{s ? `${s.units} adet` : '—'}</td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      {['error', 'passive'].includes(l.listing_status) && connected.includes(l.marketplace_name) && (
                        <Button variant="ghost" className="text-xs" loading={busy === `pub-${l.marketplace_name}`} onClick={() => publish([l.marketplace_name])}><Rocket className="w-3.5 h-3.5" /> {l.listing_status === 'error' ? 'Tekrar dene' : 'Yayınla'}</Button>
                      )}
                    </td>
                  </tr>
                  {open === l.marketplace_name && pr && (
                    <tr><td colSpan={9} className="px-5 pb-3 bg-slate-50 text-xs">
                      <table className="w-full max-w-lg mt-1"><tbody>
                        {pr.lines.map((x, i) => <tr key={i}><td className="py-0.5">{x.label}{x.note && <span className="text-slate-400"> — {x.note}</span>}</td><td className="text-right text-rose-700">−{tl2(x.cost)}</td></tr>)}
                        <tr className="font-semibold"><td>Net kâr</td><td className="text-right">{tl2(pr.netProfit)}</td></tr>
                      </tbody></table>
                      <div className="text-slate-500 mt-1">Kargo firması {l.carrier ?? 'varsayılan'} · termin {l.handling_days} gün{l.same_day_tag ? ' · Bugün Kargoda' : ''}{l.fast_tag ? ' · Hızlı Teslimat' : ''} · Son senkron {fmtDate(l.last_synced_at)}</div>
                      {pr.notes.length > 0 && <ul className="text-amber-700 list-disc pl-4 mt-1">{pr.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
            {connected.filter((m) => !listings.some((l) => l.marketplace_name === m)).map((m) => (
              <tr key={m}><td className="px-4 py-2"><MarketplaceBadge name={m} size="xs" /></td><td className="px-3 py-2 text-xs text-slate-400" colSpan={7}>Bu pazaryerinde ilan yok</td>
                <td className="px-3 py-2 text-right"><Button variant="ghost" className="text-xs" loading={busy === `pub-${m}`} onClick={() => publish([m])}><Rocket className="w-3.5 h-3.5" /> Yayınla</Button></td></tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-slate-500 px-5 py-2">Tutarlar KDV hariç kâra etkisidir; satıra tıklayınca kalem kalem döküm açılır. Komisyon/kargo ayarlarını Ürünler listesindeki hesap makinesi simgesinden değiştirebilirsiniz.</p>
      </Card>
    </div>
  );
}
