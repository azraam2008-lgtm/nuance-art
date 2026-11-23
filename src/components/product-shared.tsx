import type { MarketplaceName } from '@/lib/marketplaces/meta';

export type LStatus = 'pending' | 'active' | 'error' | 'passive';
export interface Listing { marketplace_name: MarketplaceName; listing_status: LStatus; external_product_id: string | null; sync_error_message: string | null; last_synced_at: string | null; last_pushed_stock: number | null;
  commission_rate: number | null; handling_days: number; same_day_tag: boolean; fast_tag: boolean; carrier: string | null; manual_shipping_cost: number | null; price_override: number | null }
export interface Profit { price: number; netProfit: number; margin: number; commission: number; fee: number; shipping: number }
export interface Product {
  id: string; sku: string; barcode: string; title: string; brand: string; category: string; vat_rate: number; price: number; cost_price: number; created_at: string;
  total_stock: number; low_stock_threshold: number; image_url: string | null; images: string[]; listings: Listing[];
  cost_vat_rate: number | null; desi: number; packaging_cost: number; profits: Record<string, Profit>;
  group_code?: string | null; variant_attrs?: Record<string, string> | null; safety_stock?: number | null; min_margin?: number | null;
}

/** Seçenek etiketi: {Renk: Kırmızı, Beden: M} → "Kırmızı / M" */
export const variantText = (a?: Record<string, string> | null) => Object.values(a ?? {}).filter(Boolean).join(' / ');

export const STATUS_STYLE: Record<LStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  pending: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  error: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  passive: 'bg-slate-100 text-slate-500',
};
export const STATUS_LABEL: Record<LStatus, string> = { active: 'Yayında', pending: 'Onay bekliyor', error: 'Hata', passive: 'Pasif' };

/** İlan stoğu pazaryerine gönderilen son değerle aynı mı? */
export function stockSynced(p: { total_stock: number; safety_stock?: number | null }, l: Listing) {
  return l.listing_status !== 'active' || l.last_pushed_stock === null || l.last_pushed_stock === Math.max(0, p.total_stock - (p.safety_stock ?? 0));
}

