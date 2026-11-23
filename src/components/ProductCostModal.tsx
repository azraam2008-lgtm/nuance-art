'use client';
import { useEffect, useState } from 'react';
import { MARKETPLACES, MARKETPLACE_META, type MarketplaceName } from '@/lib/marketplaces/meta';
import { CARRIERS_BY_MARKETPLACE } from '@/lib/fees/carriers';
import { api, useLive, useToast } from './live';
import { Button, Field, MarketplaceBadge, Modal, inputClass } from './ui';

export interface ListingCfg {
  marketplace_name: string; commission_rate: number | null; handling_days: number; same_day_tag: boolean; fast_tag: boolean;
  carrier: string | null; manual_shipping_cost: number | null;
}
export interface ProductCfg {
  id: string; sku: string; title: string; cost_price: number; cost_vat_rate: number | null; vat_rate: number; desi: number; packaging_cost: number;
  safety_stock?: number | null; min_margin?: number | null;
  listings: ListingCfg[];
}

type Row = { commissionRate: string; handlingDays: string; sameDayTag: boolean; fastTag: boolean; carrier: string; manualShippingCost: string };

const toRow = (l?: ListingCfg): Row => ({
  commissionRate: l?.commission_rate != null ? String(l.commission_rate) : '',
  handlingDays: String(l?.handling_days ?? 1),
  sameDayTag: !!l?.same_day_tag,
  fastTag: !!l?.fast_tag,
  carrier: l?.carrier ?? '',
  manualShippingCost: l?.manual_shipping_cost != null ? String(l.manual_shipping_cost) : '',
});

/** Ürünün maliyet bilgileri + 8 pazaryeri için komisyon / termin / Bugün Kargoda / kargo firması */
export default function ProductCostModal({ product, onClose }: { product: ProductCfg | null; onClose: () => void }) {
  const toast = useToast();
  const { bump } = useLive();
  const [p, setP] = useState({ costPrice: '', costVatRate: '', desi: '', packagingCost: '', safetyStock: '0', minMargin: '' });
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!product) return;
    setP({ costPrice: String(product.cost_price), costVatRate: product.cost_vat_rate != null ? String(product.cost_vat_rate) : '', desi: String(product.desi ?? 1), packagingCost: String(product.packaging_cost ?? 0), safetyStock: String(product.safety_stock ?? 0), minMargin: product.min_margin != null ? String(product.min_margin) : '' });
    setRows(Object.fromEntries(MARKETPLACES.map((m) => [m, toRow(product.listings.find((l) => l.marketplace_name === m))])));
  }, [product]);

  const set = (m: string, k: keyof Row, v: string | boolean) => setRows((r) => ({ ...r, [m]: { ...r[m], [k]: v } }));

  async function save() {
    if (!product) return;
    setBusy(true);
    try {
      const r = await api<{ recomputed: number }>(`/api/products/${product.id}/listings`, {
        method: 'PUT',
        body: {
          product: { costPrice: p.costPrice, costVatRate: p.costVatRate === '' ? null : p.costVatRate, desi: p.desi, packagingCost: p.packagingCost, safetyStock: p.safetyStock || 0, minMargin: p.minMargin === '' ? null : p.minMargin },
          listings: MARKETPLACES.map((m) => ({
            marketplace: m,
            commissionRate: rows[m].commissionRate === '' ? null : rows[m].commissionRate,
            handlingDays: rows[m].handlingDays,
            sameDayTag: rows[m].sameDayTag,
            fastTag: rows[m].fastTag,
            carrier: rows[m].carrier || null,
            manualShippingCost: rows[m].manualShippingCost === '' ? null : rows[m].manualShippingCost,
          })),
        },
      });
      toast(`Kaydedildi. ${r.recomputed} siparişin kârı yeniden hesaplandı.`);
      bump();
      onClose();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!product} onClose={onClose} wide title={`Maliyet & Pazaryeri Ayarları — ${product?.sku ?? ''}`}>
      {product && Object.keys(rows).length > 0 && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Birim maliyet (KDV hariç ₺)"><input type="number" step="0.01" min="0" className={inputClass} value={p.costPrice} onChange={(e) => setP({ ...p, costPrice: e.target.value })} /></Field>
            <Field label="Maliyet KDV oranı (%)" hint={`Boşsa satış KDV'si (%${Number(product.vat_rate)})`}><input type="number" step="1" min="0" className={inputClass} value={p.costVatRate} onChange={(e) => setP({ ...p, costVatRate: e.target.value })} /></Field>
            <Field label="Desi (tek adet paket)"><input type="number" step="0.5" min="0" className={inputClass} value={p.desi} onChange={(e) => setP({ ...p, desi: e.target.value })} /></Field>
            <Field label="Ambalaj (adet, KDV hariç ₺)"><input type="number" step="0.01" min="0" className={inputClass} value={p.packagingCost} onChange={(e) => setP({ ...p, packagingCost: e.target.value })} /></Field>
            <Field label="Güvenlik stoğu (adet)" hint="Pazaryerlerine bu kadar eksik gösterilir; son adetlerin iki yerde aynı anda satılmasını önler."><input type="number" step="1" min="0" className={inputClass} value={p.safetyStock} onChange={(e) => setP({ ...p, safetyStock: e.target.value })} /></Field>
            <Field label="En düşük kâr marjı (%)" hint="Fiyat bunun altına düşerse (veya zarar ederse) panel uyarır. Boş = yalnızca zarar uyarısı."><input type="number" step="0.5" className={inputClass} value={p.minMargin} onChange={(e) => setP({ ...p, minMargin: e.target.value })} /></Field>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="text-left py-2">Pazaryeri</th>
                  <th className="text-left py-2 px-1" title="Boş bırakılırsa kuraldaki varsayılan oran">Komisyon %</th>
                  <th className="text-left py-2 px-1" title="Kargoya veriliş süresi (iş günü)">Termin (gün)</th>
                  <th className="text-center py-2 px-1">Bugün Kargoda</th>
                  <th className="text-center py-2 px-1">Hızlı Teslimat</th>
                  <th className="text-left py-2 px-1">Kargo firması</th>
                  <th className="text-left py-2 px-1" title="Tarife tablosu yoksa paket başı (KDV hariç)">Elle kargo ₺</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {MARKETPLACES.map((m: MarketplaceName) => (
                  <tr key={m}>
                    <td className="py-2"><MarketplaceBadge name={m} /></td>
                    <td className="px-1"><input className={`${inputClass} w-20 py-1`} type="number" step="0.1" min="0" placeholder="varsayılan" value={rows[m].commissionRate} onChange={(e) => set(m, 'commissionRate', e.target.value)} /></td>
                    <td className="px-1"><input className={`${inputClass} w-16 py-1`} type="number" step="1" min="0" value={rows[m].handlingDays} onChange={(e) => set(m, 'handlingDays', e.target.value)} /></td>
                    <td className="px-1 text-center"><input type="checkbox" className="accent-indigo-600" checked={rows[m].sameDayTag} onChange={(e) => set(m, 'sameDayTag', e.target.checked)} /></td>
                    <td className="px-1 text-center"><input type="checkbox" className="accent-indigo-600" checked={rows[m].fastTag} onChange={(e) => set(m, 'fastTag', e.target.checked)} /></td>
                    <td className="px-1">
                      <select className={`${inputClass} py-1`} value={rows[m].carrier} onChange={(e) => set(m, 'carrier', e.target.value)}>
                        <option value="">Varsayılan</option>
                        {(CARRIERS_BY_MARKETPLACE[m] ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="px-1"><input className={`${inputClass} w-24 py-1`} type="number" step="0.01" min="0" value={rows[m].manualShippingCost} onChange={(e) => set(m, 'manualShippingCost', e.target.value)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">
            {MARKETPLACE_META.trendyol.label}: "Bugün Kargoda" + aynı gün kargoya veriliş → platform hizmet bedeli 4,99 TL + KDV ve hızlı barem fiyatı; termin 1 gün de hızlı barem fiyatını sağlar.
            Hepsiburada bareminden yararlanmak için termin 0–1 gün ve HepsiJET/Sürat gerekir.
          </p>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <Button variant="secondary" onClick={onClose}>Vazgeç</Button>
            <Button loading={busy} onClick={save}>Kaydet ve kârı yeniden hesapla</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
