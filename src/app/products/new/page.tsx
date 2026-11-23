'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Image as ImageIcon, Info, Package, Rocket, Store, Wand2, Wallet } from 'lucide-react';
import { api, useToast } from '@/components/live';
import { Button, Card, Field, MarketplaceBadge, cx, inputClass, tl2 } from '@/components/ui';
import ImageUploader from '@/components/ImageUploader';
import { AttributesForm, SearchPicker, attributesPayload, type AttrDef, type AttrValue } from '@/components/CatalogPickers';
import { ProfitTable, useQuotes } from '@/components/ProfitQuote';
import { MARKETPLACE_META, type MarketplaceName } from '@/lib/marketplaces/meta';
import { CARRIERS_BY_MARKETPLACE } from '@/lib/fees/carriers';
import { DEFAULT_COMMISSION } from '@/lib/fees/commission-defaults';
import type { ListingDefaults } from '@/lib/marketplaces/guides';

interface Cred { marketplace: MarketplaceName; mode: 'live' | 'demo' | 'off'; extraConfig: Record<string, unknown> }
interface MpState {
  publish: boolean; price: string; carrier: string; handlingDays: number; sameDayTag: boolean; fastTag: boolean; commissionRate: string;
  category: { id: number | string; name: string } | null; brand: { id: number | string; name: string } | null;
  categoryId: string; brandId: string; attrs: Record<number, AttrValue>; attrDefs: AttrDef[];
}
interface Form {
  title: string; brand: string; category: string; barcode: string; sku: string; description: string; vatRate: string; desi: string;
  images: string[];
  costPrice: string; costVatRate: string; packagingCost: string; price: string; listPrice: string; stock: string; lowStockThreshold: string;
}
const EMPTY: Form = { title: '', brand: '', category: '', barcode: '', sku: '', description: '', vatRate: '20', desi: '1', images: [], costPrice: '', costVatRate: '20', packagingCost: '0', price: '', listPrice: '', stock: '', lowStockThreshold: '5' };
const STEPS = [
  { key: 'info', label: 'Ürün bilgileri', icon: Package },
  { key: 'photos', label: 'Fotoğraflar', icon: ImageIcon },
  { key: 'price', label: 'Fiyat & stok', icon: Wallet },
  { key: 'mps', label: 'Pazaryerleri', icon: Store },
  { key: 'review', label: 'Kontrol & yayınla', icon: Rocket },
] as const;
const DRAFT_KEY = 'nuance-art:new-product-draft';

const n = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(',', '.')));
/** İç kullanım EAN-13 barkodu (2 ile başlar, kontrol hanesi hesaplı) */
function makeBarcode() {
  const d = [2, ...Array.from({ length: 11 }, () => Math.floor(Math.random() * 10))];
  const sum = d.reduce((s, x, i) => s + x * (i % 2 ? 3 : 1), 0);
  return d.join('') + ((10 - (sum % 10)) % 10);
}
function makeSku(title: string) {
  const base = title.toLocaleUpperCase('tr-TR').replace(/Ç/g, 'C').replace(/Ğ/g, 'G').replace(/İ/g, 'I').replace(/Ö/g, 'O').replace(/Ş/g, 'S').replace(/Ü/g, 'U')
    .replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 3).map((w) => w.slice(0, 4)).join('-');
  return `${base || 'NA'}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export default function NewProductPage() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>(EMPTY);
  const [creds, setCreds] = useState<Cred[] | null>(null);
  const [mps, setMps] = useState<Record<string, MpState>>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ id: string; results: Record<string, { ok: boolean; message: string }> } | null>(null);
  const set = (k: keyof Form, v: string | string[]) => setF((x) => ({ ...x, [k]: v }));

  // Taslak: sayfa yenilense de girilenler kaybolmasın
  useEffect(() => {
    try { const d = localStorage.getItem(DRAFT_KEY); if (d) { const p = JSON.parse(d); if (p?.f) setF({ ...EMPTY, ...p.f }); } } catch { /* yok say */ }
  }, []);
  useEffect(() => {
    if (done) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ f })); } catch { /* yok say */ }
  }, [f, done]);

  useEffect(() => {
    Promise.all([
      api<{ credentials: Cred[] }>('/api/credentials'),
      api<{ listingDefaults: ListingDefaults }>('/api/onboarding').catch(() => ({ listingDefaults: {} as ListingDefaults })),
    ]).then(([c, o]) => {
      const live = c.credentials.filter((x) => x.mode !== 'off');
      setCreds(live);
      const init: Record<string, MpState> = {};
      for (const cr of live) {
        const d = o.listingDefaults?.[cr.marketplace] ?? {};
        init[cr.marketplace] = {
          publish: true, price: '', carrier: d.carrier ?? CARRIERS_BY_MARKETPLACE[cr.marketplace]?.[0] ?? '',
          handlingDays: d.handlingDays ?? 1, sameDayTag: !!d.sameDayTag, fastTag: !!d.fastTag,
          commissionRate: String(d.commissionRate ?? DEFAULT_COMMISSION[cr.marketplace] ?? ''),
          category: null, brand: null, categoryId: String(cr.extraConfig?.defaultCategoryId ?? ''), brandId: String(cr.extraConfig?.defaultBrandId ?? ''),
          attrs: {}, attrDefs: [],
        };
      }
      setMps(init);
    }).catch((e: Error) => toast(e.message, 'err'));
  }, [toast]);

  const [manualIds, setManualIds] = useState<Record<string, boolean>>({});
  const setMp = (mp: string, patch: Partial<MpState>) => setMps((x) => ({ ...x, [mp]: { ...x[mp], ...patch } }));
  const selected = Object.entries(mps).filter(([, s]) => s.publish).map(([k]) => k as MarketplaceName);
  const basePrice = n(f.price);

  // Canlı kâr hesabı: her pazaryeri için kendi fiyatı, kargo firması, termin ve komisyonuyla
  const quoteInput = useMemo(() => {
    if (!Number.isFinite(basePrice) || basePrice <= 0 || !Number.isFinite(n(f.costPrice))) return null;
    const list = (creds ?? []).map((c) => c.marketplace).filter((mp) => mps[mp]);
    return {
      unitCostNet: n(f.costPrice), costVatRate: n(f.costVatRate) || 0, vatRate: n(f.vatRate) || 0, desi: n(f.desi) || 1, packagingNet: n(f.packagingCost) || 0,
      quotes: list.map((mp) => {
        const s = mps[mp];
        const p = n(s.price);
        return { marketplace: mp, price: Number.isFinite(p) && p > 0 ? p : basePrice, carrier: s.carrier, sameDayTag: s.sameDayTag, fastTag: s.fastTag, handlingDays: s.handlingDays, commissionRate: Number.isFinite(n(s.commissionRate)) ? n(s.commissionRate) : null };
      }),
    };
  }, [basePrice, f.costPrice, f.costVatRate, f.vatRate, f.desi, f.packagingCost, mps, creds]);
  const quotes = useQuotes(quoteInput);

  // Adım doğrulamaları
  const problems = useMemo(() => {
    const p: string[][] = [[], [], [], [], []];
    if (f.title.trim().length < 5) p[0].push('Ürün adı en az 5 karakter olmalı.');
    if (!f.brand.trim()) p[0].push('Marka girin.');
    if (!f.category.trim()) p[0].push('Kategori girin.');
    if (!/^[0-9A-Za-z-]{4,64}$/.test(f.barcode.trim())) p[0].push('Barkod girin (en az 4 karakter, boşluksuz).');
    if (!f.sku.trim()) p[0].push('Stok kodu (SKU) girin.');
    if (f.description.trim().length < 30) p[0].push('Açıklama en az 30 karakter olmalı — pazaryerleri kısa açıklamalı ürünleri reddedebilir.');
    if (!(n(f.desi) > 0)) p[0].push('Desi değeri girin.');
    if (!f.images.length) p[1].push('En az bir fotoğraf ekleyin.');
    if (!(n(f.price) > 0)) p[2].push('Satış fiyatı girin.');
    if (!(n(f.costPrice) >= 0)) p[2].push('Ürün maliyetini girin (kâr hesabı için).');
    if (!(n(f.stock) >= 0) || !Number.isInteger(n(f.stock))) p[2].push('Başlangıç stoğunu tam sayı olarak girin.');
    if (f.listPrice && n(f.listPrice) < n(f.price)) p[2].push('Liste (üstü çizili) fiyat satış fiyatından düşük olamaz.');
    for (const mp of selected) {
      const s = mps[mp];
      const label = MARKETPLACE_META[mp].label;
      if (mp === 'trendyol') {
        if (!s.category) p[3].push(`${label}: kategori seçin.`);
        if (!s.brand) p[3].push(`${label}: marka seçin (Trendyol'da kayıtlı marka).`);
        const missing = s.attrDefs.filter((d) => d.required && !s.attrs[d.id]?.valueId && !s.attrs[d.id]?.custom?.trim());
        if (missing.length) p[3].push(`${label}: zorunlu özellikler eksik — ${missing.map((d) => d.name).join(', ')}.`);
      } else if (['hepsiburada', 'n11', 'ciceksepeti', 'pazarama', 'idefix'].includes(mp) && !s.categoryId.trim()) {
        p[3].push(`${label}: kategori seçin.`);
      }
      if ((mp === 'pazarama' || mp === 'idefix') && !s.brandId.trim()) p[3].push(`${label}: marka seçin.`);
      if (s.price && !(n(s.price) > 0)) p[3].push(`${label}: özel fiyat geçersiz.`);
    }
    return p;
  }, [f, mps, selected]);

  const canGo = (i: number) => problems.slice(0, i).every((x) => x.length === 0);

  async function submit() {
    setSaving(true);
    try {
      const marketplaceAttributes: Record<string, Record<string, unknown>> = {};
      const listingSettings: Record<string, Record<string, unknown>> = {};
      for (const [mp, s] of Object.entries(mps)) {
        listingSettings[mp] = { carrier: s.carrier, handlingDays: s.handlingDays, sameDayTag: s.sameDayTag, fastTag: s.fastTag, commissionRate: s.commissionRate, priceOverride: s.price || null };
        if (mp === 'trendyol') {
          marketplaceAttributes[mp] = { categoryId: s.category?.id, categoryName: s.category?.name, brandId: s.brand?.id, brandName: s.brand?.name, attributes: attributesPayload(s.attrs), dimensionalWeight: n(f.desi) || 1 };
        } else if (mp === 'etsy') {
          marketplaceAttributes[mp] = s.categoryId ? { taxonomyId: Number(s.categoryId), categoryName: s.category?.name } : {};
        } else {
          marketplaceAttributes[mp] = {
            ...(s.categoryId ? { categoryId: s.categoryId, categoryName: s.category?.name } : {}),
            ...(s.brandId ? { brandId: s.brandId, brandName: s.brand?.name } : {}),
          };
        }
      }
      const r = await api<{ product: { id: string }; results: Record<string, { ok: boolean; message: string }> }>('/api/products', {
        method: 'POST',
        body: {
          title: f.title.trim(), brand: f.brand.trim(), category: f.category.trim(), barcode: f.barcode.trim(), sku: f.sku.trim(),
          description: f.description, vatRate: n(f.vatRate), desi: n(f.desi), images: f.images,
          costPrice: n(f.costPrice), costVatRate: n(f.costVatRate), packagingCost: n(f.packagingCost) || 0,
          price: n(f.price), listPrice: f.listPrice ? n(f.listPrice) : undefined, stock: n(f.stock), lowStockThreshold: n(f.lowStockThreshold) || 0,
          marketplaces: selected, listingSettings, marketplaceAttributes,
        },
      });
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* yok say */ }
      setDone({ id: r.product.id, results: r.results });
      toast('Ürün kaydedildi ve pazaryerlerine gönderildi.', 'ok');
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="max-w-3xl mx-auto">
        <Card className="p-6">
          <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center"><Check className="w-5 h-5" /></div>
            <div><h2 className="text-lg font-semibold">{f.title}</h2><p className="text-sm text-slate-500">Ürün kaydedildi. Pazaryeri sonuçları:</p></div></div>
          <ul className="mt-4 divide-y divide-slate-100">
            {Object.entries(done.results).map(([mp, r]) => (
              <li key={mp} className="py-2 flex items-start gap-3 text-sm">
                <MarketplaceBadge name={mp} size="xs" />
                <span className={cx('flex-1', r.ok ? 'text-slate-700' : 'text-rose-700')}>{r.ok ? '✓ ' : '✗ '}{r.message}</span>
              </li>
            ))}
            {!Object.keys(done.results).length && <li className="py-2 text-sm text-slate-500">Hiçbir pazaryeri seçilmedi; ürün yalnızca stok havuzuna eklendi.</li>}
          </ul>
          <p className="text-xs text-slate-500 mt-3">Onay bekleyen (pending) ilanlar arka planda düzenli kontrol edilir; onaylanınca durum otomatik &quot;Aktif&quot; olur.</p>
          <div className="flex gap-2 mt-5">
            <Button onClick={() => router.push(`/products/${done.id}`)}>Ürün detayına git</Button>
            <Button variant="secondary" onClick={() => { setDone(null); setF(EMPTY); setStep(0); }}>Yeni ürün ekle</Button>
            <Link href="/products" className="ml-auto text-sm text-indigo-600 self-center">Yeni eklenen ürünler →</Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Adım göstergesi */}
      <ol className="grid grid-cols-5 gap-2">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const ok = i < step && problems[i].length === 0;
          return (
            <li key={s.key}>
              <button type="button" onClick={() => canGo(i) && setStep(i)} disabled={!canGo(i)}
                className={cx('w-full flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition',
                  i === step ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : ok ? 'border-emerald-200 bg-white text-slate-700' : 'border-slate-200 bg-white text-slate-500',
                  !canGo(i) && 'opacity-50 cursor-not-allowed')}>
                <span className={cx('w-6 h-6 rounded-full grid place-items-center text-xs shrink-0', i === step ? 'bg-indigo-600 text-white' : ok ? 'bg-emerald-500 text-white' : 'bg-slate-100')}>
                  {ok ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                </span>
                <span className="hidden md:inline truncate">{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <Card className="p-5">
        {step === 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2"><Field label="Ürün adı *" hint={`${f.title.length}/100 — Trendyol başlığı 100 karakterle sınırlar. Marka + ürün + öne çıkan özellik yazın.`}>
              <input className={inputClass} maxLength={150} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Örn. El Yapımı Saten Kurdele Toka 3'lü Set - Pudra" />
            </Field></div>
            <Field label="Marka *"><input className={inputClass} value={f.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Nuance Art" /></Field>
            <Field label="Kategori (iç kullanım) *" hint="Panelde gruplama için. Pazaryeri kategorisini 4. adımda seçeceksiniz."><input className={inputClass} value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="Saç Aksesuarı" /></Field>
            <Field label="Barkod *" hint="Ürünün üzerindeki barkod. Yoksa 'Oluştur' ile iç barkod üretebilirsiniz.">
              <div className="flex gap-2"><input className={inputClass} value={f.barcode} onChange={(e) => set('barcode', e.target.value.replace(/\s/g, ''))} />
                <Button variant="secondary" onClick={() => set('barcode', makeBarcode())}><Wand2 className="w-4 h-4" />Oluştur</Button></div>
            </Field>
            <Field label="Stok kodu (SKU) *" hint="Tüm pazaryerlerinde ortak stok kodu.">
              <div className="flex gap-2"><input className={inputClass} value={f.sku} onChange={(e) => set('sku', e.target.value.trim())} />
                <Button variant="secondary" onClick={() => set('sku', makeSku(f.title))}><Wand2 className="w-4 h-4" />Oluştur</Button></div>
            </Field>
            <div className="md:col-span-2"><Field label="Ürün açıklaması *" hint={`${f.description.length} karakter. Malzeme, ölçü, kullanım ve bakım bilgilerini yazın. Satır sonları korunur. Tüm pazaryerlerine aynı açıklama gider.`}>
              <textarea className={`${inputClass} min-h-[180px]`} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder={'• Malzeme: %100 saten\n• Ölçü: 8 cm\n• Paket içeriği: 3 adet\n• Bakım: Elde yıkayınız'} />
            </Field></div>
            <Field label="KDV oranı (satış)">
              <select className={inputClass} value={f.vatRate} onChange={(e) => set('vatRate', e.target.value)}>{['20', '10', '1', '0'].map((v) => <option key={v} value={v}>%{v}</option>)}</select>
            </Field>
            <Field label="Desi *" hint="Paketli (en × boy × yükseklik cm) ÷ 3000. Kargo ücreti buna göre hesaplanır.">
              <input className={inputClass} inputMode="decimal" value={f.desi} onChange={(e) => set('desi', e.target.value)} />
            </Field>
          </div>
        )}

        {step === 1 && <ImageUploader images={f.images} onChange={(v) => set('images', v)} />}

        {step === 2 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Ürün maliyeti (KDV hariç) *" hint="Birim alış / üretim maliyeti."><input className={inputClass} inputMode="decimal" value={f.costPrice} onChange={(e) => set('costPrice', e.target.value)} /></Field>
            <Field label="Maliyet KDV oranı"><select className={inputClass} value={f.costVatRate} onChange={(e) => set('costVatRate', e.target.value)}>{['20', '10', '1', '0'].map((v) => <option key={v} value={v}>%{v}</option>)}</select></Field>
            <Field label="Ambalaj maliyeti (KDV hariç)"><input className={inputClass} inputMode="decimal" value={f.packagingCost} onChange={(e) => set('packagingCost', e.target.value)} /></Field>
            <Field label="Satış fiyatı (KDV dahil) *" hint="Tüm pazaryerlerinde varsayılan fiyat; 4. adımda pazaryerine özel değiştirebilirsiniz."><input className={inputClass} inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value)} /></Field>
            <Field label="Liste fiyatı (üstü çizili)" hint="Boş bırakılırsa satış fiyatı."><input className={inputClass} inputMode="decimal" value={f.listPrice} onChange={(e) => set('listPrice', e.target.value)} /></Field>
            <div />
            <Field label="Başlangıç stoğu *" hint="Ortak stok havuzu: tüm pazaryerlerine aynı stok gönderilir, satış olunca hepsinde düşer."><input className={inputClass} inputMode="numeric" value={f.stock} onChange={(e) => set('stock', e.target.value)} /></Field>
            <Field label="Kritik stok eşiği" hint="Bu seviyenin altında uyarı verilir."><input className={inputClass} inputMode="numeric" value={f.lowStockThreshold} onChange={(e) => set('lowStockThreshold', e.target.value)} /></Field>
            {quotes.data && quotes.data.length > 0 && (
              <div className="md:col-span-3">
                <div className="text-sm font-medium mb-1">Bu fiyatta pazaryeri bazında kârınız</div>
                <ProfitTable results={quotes.data} compact />
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            {creds === null ? <div className="text-sm text-slate-500">Yükleniyor…</div> : creds.length === 0 ? (
              <div className="text-sm text-amber-800 bg-amber-50 rounded-lg p-3 flex gap-2"><AlertTriangle className="w-4 h-4 mt-0.5" />Henüz bağlı pazaryeri yok. Ürün yalnızca stok havuzuna kaydedilir. <Link href="/settings" className="underline">API Bağlantıları</Link>&apos;ndan pazaryeri bağlayın.</div>
            ) : creds.map(({ marketplace: mp }) => {
              const s = mps[mp];
              if (!s) return null;
              const q = quotes.data?.find((x) => x.marketplace === mp);
              return (
                <div key={mp} className={cx('rounded-xl border p-4 transition', s.publish ? 'border-slate-200' : 'border-slate-100 bg-slate-50 opacity-70')}>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" className="w-4 h-4 accent-indigo-600" checked={s.publish} onChange={(e) => setMp(mp, { publish: e.target.checked })} />
                      <MarketplaceBadge name={mp} />
                    </label>
                    {q && s.publish && (
                      <span className={cx('ml-auto text-sm font-semibold tabular-nums', q.netProfit < 0 ? 'text-rose-600' : 'text-emerald-700')}>
                        Net kâr {tl2(q.netProfit)} <span className="text-xs font-normal text-slate-500">(%{(q.marginOnRevenue * 100).toFixed(1)})</span>
                      </span>
                    )}
                  </div>
                  {s.publish && (
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3">
                      <Field label="Bu pazaryerinde fiyat" hint={`Boş = ${Number.isFinite(basePrice) ? tl2(basePrice) : 'ortak fiyat'}`}>
                        <input className={inputClass} inputMode="decimal" value={s.price} placeholder={f.price} onChange={(e) => setMp(mp, { price: e.target.value })} />
                      </Field>
                      <Field label="Komisyon %" hint="Kategorinizin oranı">
                        <input className={inputClass} inputMode="decimal" value={s.commissionRate} onChange={(e) => setMp(mp, { commissionRate: e.target.value })} />
                      </Field>
                      <Field label="Kargo firması">
                        <select className={inputClass} value={s.carrier} onChange={(e) => setMp(mp, { carrier: e.target.value })}>
                          {(CARRIERS_BY_MARKETPLACE[mp] ?? []).map((c) => <option key={c}>{c}</option>)}
                        </select>
                      </Field>
                      <Field label="Kargoya teslim (gün)">
                        <select className={inputClass} value={s.handlingDays} onChange={(e) => setMp(mp, { handlingDays: Number(e.target.value) })}>
                          {[0, 1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d === 0 ? 'Aynı gün' : `${d} iş günü`}</option>)}
                        </select>
                      </Field>
                      {(mp === 'trendyol' || mp === 'hepsiburada') && (
                        <div className="md:col-span-4 flex flex-wrap gap-4 text-sm">
                          <label className="flex items-center gap-2"><input type="checkbox" className="accent-indigo-600" checked={s.sameDayTag} onChange={(e) => setMp(mp, { sameDayTag: e.target.checked, ...(e.target.checked ? { handlingDays: 0 } : {}) })} /> Bugün Kargoda etiketi</label>
                          {mp === 'trendyol' && <label className="flex items-center gap-2"><input type="checkbox" className="accent-indigo-600" checked={s.fastTag} onChange={(e) => setMp(mp, { fastTag: e.target.checked })} /> Hızlı Teslimat</label>}
                          <span className="text-xs text-slate-500 flex items-center gap-1"><Info className="w-3.5 h-3.5" /> Etiketler kargo baremini ve platform bedelini etkiler; tablo otomatik güncellenir.</span>
                        </div>
                      )}
                      {mp === 'trendyol' ? (
                        <>
                          <div className="md:col-span-2"><SearchPicker marketplace={mp} kind="categories" label="Trendyol kategorisi *" value={s.category} onChange={(v) => setMp(mp, { category: v, attrs: {}, attrDefs: [] })} placeholder="Örn. toka, kurdele…" /></div>
                          <div className="md:col-span-2"><SearchPicker marketplace={mp} kind="brands" label="Trendyol markası *" value={s.brand} onChange={(v) => setMp(mp, { brand: v })} placeholder={f.brand || 'Marka adı'} /></div>
                          <div className="md:col-span-4"><AttributesForm marketplace={mp} categoryId={s.category?.id ?? null} value={s.attrs} onChange={(v) => setMp(mp, { attrs: v })} onLoaded={(d) => setMp(mp, { attrDefs: d })} /></div>
                        </>
                      ) : mp === 'koctas' ? (
                        <p className="md:col-span-4 text-xs text-slate-500">Koçtaş: ürün, Mirakl kataloğunda barkod ile eşleştirilir. Eşleşmezse Koçtaş paneli üzerinden ürün kartı açılması gerekir.</p>
                      ) : (
                        <>
                          <div className="md:col-span-2">
                            {manualIds[mp] ? (
                              <Field label={`${MARKETPLACE_META[mp].label} kategori numarası${mp === 'etsy' ? '' : ' *'}`} hint="Pazaryeri panelindeki kategori numarası.">
                                <input className={inputClass} value={s.categoryId} onChange={(e) => setMp(mp, { categoryId: e.target.value.trim(), category: null })} />
                              </Field>
                            ) : (
                              <SearchPicker marketplace={mp} kind="categories" label={`${MARKETPLACE_META[mp].label} kategorisi${mp === 'etsy' ? '' : ' *'}`}
                                value={s.category ?? (s.categoryId ? { id: s.categoryId, name: `Kategori #${s.categoryId}` } : null)}
                                onChange={(v) => setMp(mp, { category: v, categoryId: v ? String(v.id) : '' })} placeholder="Örn. toka, kurdele, mum…" />
                            )}
                            <button type="button" className="text-[11px] text-indigo-600 mt-1" onClick={() => setManualIds((x) => ({ ...x, [mp]: !x[mp] }))}>
                              {manualIds[mp] ? 'Listeden arayarak seç' : 'Kategori numarasını elle yaz'}
                            </button>
                          </div>
                          {(mp === 'pazarama' || mp === 'idefix') && (
                            <div className="md:col-span-2">
                              {manualIds[`${mp}:brand`] ? (
                                <Field label={`${MARKETPLACE_META[mp].label} marka numarası *`}>
                                  <input className={inputClass} value={s.brandId} onChange={(e) => setMp(mp, { brandId: e.target.value.trim(), brand: null })} />
                                </Field>
                              ) : (
                                <SearchPicker marketplace={mp} kind="brands" label={`${MARKETPLACE_META[mp].label} markası *`}
                                  value={s.brand ?? (s.brandId ? { id: s.brandId, name: `Marka #${s.brandId}` } : null)}
                                  onChange={(v) => setMp(mp, { brand: v, brandId: v ? String(v.id) : '' })} placeholder={f.brand || 'Marka adı'} />
                              )}
                              <button type="button" className="text-[11px] text-indigo-600 mt-1" onClick={() => setManualIds((x) => ({ ...x, [`${mp}:brand`]: !x[`${mp}:brand`] }))}>
                                {manualIds[`${mp}:brand`] ? 'Listeden arayarak seç' : 'Marka numarasını elle yaz'}
                              </button>
                            </div>
                          )}
                          {mp === 'etsy' && <p className="md:col-span-4 text-xs text-slate-500">Etsy: kategori seçmezseniz API Bağlantıları&apos;ndaki varsayılan kullanılır. Fiyat, mağaza para birimine güncel TCMB kuruyla çevrilir.</p>}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {quotes.data && quotes.data.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-1">Pazaryeri karşılaştırması</div>
                <ProfitTable results={quotes.data.filter((q) => mps[q.marketplace]?.publish)} />
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-5">
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {f.images[0] && <img src={f.images[0]} alt="" className="w-full aspect-[2/3] object-cover rounded-xl border" />}
              <div className="grid grid-cols-4 gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {f.images.slice(1).map((u, i) => <img key={u} src={u} alt="" className="aspect-square object-cover rounded border" title={`${i + 2}. fotoğraf`} />)}
              </div>
              <p className="text-[11px] text-slate-500">{f.images.length} fotoğraf bu sırayla gönderilecek.</p>
            </div>
            <div className="space-y-3 text-sm min-w-0">
              <h3 className="text-lg font-semibold">{f.title}</h3>
              <div className="text-slate-500 break-words">{f.brand} · {f.category} · SKU {f.sku} · Barkod {f.barcode} · KDV %{f.vatRate} · {f.desi} desi</div>
              <div className="flex flex-wrap gap-4">
                <div><div className="text-xs text-slate-500">Satış fiyatı</div><div className="font-semibold">{tl2(n(f.price))}</div></div>
                <div><div className="text-xs text-slate-500">Maliyet</div><div className="font-semibold">{tl2(n(f.costPrice))}</div></div>
                <div><div className="text-xs text-slate-500">Başlangıç stoğu</div><div className="font-semibold">{f.stock} adet</div></div>
              </div>
              <pre className="whitespace-pre-wrap font-sans text-slate-700 bg-slate-50 rounded-lg p-3 max-h-48 overflow-y-auto">{f.description}</pre>
              <div>
                <div className="font-medium mb-1">Yayınlanacak pazaryerleri ({selected.length})</div>
                {quotes.data && <ProfitTable results={quotes.data.filter((q) => mps[q.marketplace]?.publish)} />}
                {!selected.length && <p className="text-slate-500">Pazaryeri seçilmedi — ürün yalnızca stok havuzuna kaydedilecek.</p>}
              </div>
              {quotes.data?.some((q) => mps[q.marketplace]?.publish && q.netProfit < 0) && (
                <div className="text-amber-800 bg-amber-50 rounded-lg p-2 flex gap-2"><AlertTriangle className="w-4 h-4 mt-0.5" />Bazı pazaryerlerinde bu fiyatla zarar ediyorsunuz. Fiyatı 4. adımda pazaryerine özel yükseltebilirsiniz.</div>
              )}
            </div>
          </div>
        )}

        {problems[step].length > 0 && (step < 4) && (
          <ul className="mt-4 text-xs text-amber-800 bg-amber-50 rounded-lg p-3 space-y-0.5">{problems[step].map((p) => <li key={p}>• {p}</li>)}</ul>
        )}
      </Card>

      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={step === 0} onClick={() => setStep((s) => s - 1)}><ChevronLeft className="w-4 h-4" />Geri</Button>
        <button type="button" className="text-xs text-slate-400 hover:text-rose-600 ml-2" onClick={() => { if (confirm('Formdaki tüm bilgiler silinsin mi?')) { setF(EMPTY); setStep(0); } }}>Formu temizle</button>
        <div className="ml-auto">
          {step < 4 ? (
            <Button disabled={problems[step].length > 0} onClick={() => setStep((s) => s + 1)}>Devam<ChevronRight className="w-4 h-4" /></Button>
          ) : (
            <Button loading={saving} disabled={!canGo(4)} onClick={submit}><Rocket className="w-4 h-4" />{selected.length ? `Kaydet ve ${selected.length} pazaryerinde yayınla` : 'Kaydet'}</Button>
          )}
        </div>
      </div>
    </div>
  );
}
