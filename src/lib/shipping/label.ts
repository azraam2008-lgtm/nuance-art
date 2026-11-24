// Kargo etiketi bilgisi: pazaryerinin sipariş verisinden (orders.raw) kargo takip numarası ve alıcı adresi çıkarılır.
// Pazaryerleri bu alanlara farklı adlar veriyor; bilinen adlar öncelik sırasıyla aranır.
// NOT: Gerçek hesaplarla doğrulanmalı (bkz. CLAUDE.md "Doğrulanmamış uç noktalar").

export interface LabelInfo {
  trackingNumber: string | null;
  carrier: string | null;
  recipient: string;
  address: string;
  phone: string | null;
  /** Bilgi nereden geldi: pazaryeri verisi, panelde girilen takip no, yok */
  source: 'marketplace' | 'manual' | 'none';
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const s = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

/** Nesne ağacında (en fazla 4 seviye) verilen anahtarlardan ilk dolu olanı bulur */
function findKey(root: unknown, keys: string[], depth = 4): string {
  for (const k of keys) {
    const hit = walk(root, k, depth);
    if (hit) return hit;
  }
  return '';
}
function walk(v: unknown, key: string, depth: number): string {
  if (depth < 0) return '';
  if (Array.isArray(v)) {
    for (const x of v) { const r = walk(x, key, depth - 1); if (r) return r; }
    return '';
  }
  if (!isObj(v)) return '';
  const own = s(v[key]);
  if (own) return own;
  for (const x of Object.values(v)) {
    if (x && typeof x === 'object') { const r = walk(x, key, depth - 1); if (r) return r; }
  }
  return '';
}
function findObj(root: unknown, keys: string[]): Obj | null {
  if (!isObj(root)) return null;
  for (const k of keys) {
    const v = root[k];
    if (isObj(v)) return v;
    if (Array.isArray(v) && isObj(v[0])) return v[0];
  }
  for (const x of Object.values(root)) {
    if (Array.isArray(x) && isObj(x[0])) { const r = findObj(x[0], keys); if (r) return r; }
  }
  return null;
}

// Ürün barkodu ("barcode") karışmasın diye yalnızca kargoya özgü adlar
const TRACKING_KEYS = [
  'cargoTrackingNumber', 'cargoSenderNumber', 'cargoTrackingCode', 'shippingTrackingNumber', 'trackingNumber',
  'trackingInfoCode', 'cargoCode', 'shipmentCode', 'tracking_code', 'tracking_number', 'barcodeForCargo', 'cargoBarcode',
];
const CARRIER_KEYS = ['cargoProviderName', 'cargoCompanyName', 'cargoCompany', 'shippingCompany', 'shipping_company', 'carrier_name', 'carrier', 'companyName'];
const ADDRESS_OBJ_KEYS = ['shipmentAddress', 'shippingAddress', 'deliveryAddress', 'shipping_address', 'customerAddress', 'address', 'recipient'];

export function extractLabel(raw: unknown, fallback: { customerName: string; trackingNumber?: string | null; carrier?: string | null }): LabelInfo {
  const tracking = findKey(raw, TRACKING_KEYS);
  const carrier = findKey(raw, CARRIER_KEYS) || fallback.carrier || null;
  const a = findObj(raw, ADDRESS_OBJ_KEYS) ?? (isObj(raw) ? raw : {});
  const name = s(a.fullName) || [s(a.firstName), s(a.lastName)].filter(Boolean).join(' ') || s(a.name) || s(a.recipientName) || fallback.customerName;
  const line = s(a.fullAddress) || [s(a.address1), s(a.address2), s(a.first_line), s(a.second_line), s(a.addressLine), typeof a.address === 'string' ? s(a.address) : '', s(a.neighborhood)]
    .filter(Boolean).join(' ');
  const place = [s(a.district) || s(a.town), s(a.city), s(a.zip) || s(a.postalCode) || s(a.postCode)].filter(Boolean).join(' / ');
  const address = s(a.fullAddress) ? line : [line, place].filter(Boolean).join(' — ');
  const phone = s(a.phone) || s(a.gsm) || s(a.phoneNumber) || null;
  const manual = s(fallback.trackingNumber);
  return {
    trackingNumber: tracking || manual || null,
    carrier: carrier || null,
    recipient: name,
    address,
    phone,
    source: tracking ? 'marketplace' : manual ? 'manual' : 'none',
  };
}
