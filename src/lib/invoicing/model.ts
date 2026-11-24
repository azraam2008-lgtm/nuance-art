// Fatura modeli: siparişten alıcı ve satır bilgisi çıkarma (saf fonksiyonlar, test edilir).
// Pazaryerlerinin sipariş verisindeki (orders.raw) fatura adresi alanları gerçek siparişle doğrulanmalı.

export interface Party {
  name: string;
  taxNumber: string;       // 10 hane VKN (şirket) veya 11 hane TCKN (kişi)
  taxOffice: string;
  address: string;
  district: string;
  city: string;
  postalCode: string;
  country: string;
  email: string;
  phone: string;
}
export interface InvoiceLine { sku: string; name: string; quantity: number; unitNet: number; vatRate: number; net: number; vat: number; gross: number }
export interface InvoiceDraft {
  orderId: string;
  orderNo: string;
  marketplace: string;
  marketplaceLabel: string;
  orderDate: string;
  buyer: Party;
  lines: InvoiceLine[];
  totals: { net: number; vat: number; gross: number; byRate: Record<string, { net: number; vat: number }> };
  carrier: string | null;
}

/** e-Arşiv'de kimlik numarası bilinmeyen bireysel alıcı için GİB'in kabul ettiği numara */
export const ANON_TCKN = '11111111111';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const s = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
const pick = (o: Obj, keys: string[]) => { for (const k of keys) { const v = s(o[k]); if (v) return v; } return ''; };
const r2 = (n: number) => Math.round(n * 100) / 100;

function firstObj(root: unknown, keys: string[]): Obj | null {
  if (!isObj(root)) return null;
  for (const k of keys) {
    const v = root[k];
    if (isObj(v)) return v;
    if (Array.isArray(v) && isObj(v[0])) return v[0];
  }
  return null;
}

/** Alıcı: önce fatura adresi, yoksa teslimat adresi, yoksa siparişteki ad */
export function extractBuyer(raw: unknown, customerName: string): Party {
  const root = isObj(raw) ? raw : {};
  const a = firstObj(root, ['invoiceAddress', 'billingAddress', 'invoice_address', 'billing_address', 'shipmentAddress', 'shippingAddress', 'deliveryAddress', 'shipping_address']) ?? root;
  const company = pick(a, ['company', 'companyName', 'title']);
  const person = pick(a, ['fullName', 'name', 'recipientName']) || [s(a.firstName), s(a.lastName)].filter(Boolean).join(' ') || customerName;
  let tax = pick(a, ['taxNumber', 'taxId', 'vkn', 'tcId', 'tcIdentityNumber', 'identityNumber', 'tckn'])
    || pick(root, ['taxNumber', 'identityNumber', 'tcIdentityNumber', 'customerTaxNumber', 'tcId']);
  tax = tax.replace(/\D/g, '');
  if (!(tax.length === 10 || tax.length === 11)) tax = ANON_TCKN;
  const street = pick(a, ['fullAddress', 'address1', 'address', 'first_line', 'addressLine', 'openAddress']);
  const street2 = pick(a, ['address2', 'second_line']);
  return {
    name: (tax.length === 10 && company ? company : person) || 'Nihai Tüketici',
    taxNumber: tax,
    taxOffice: pick(a, ['taxOffice', 'taxHouse', 'tax_office']),
    address: [street, street2].filter(Boolean).join(' ') || '-',
    district: pick(a, ['district', 'town', 'county']) || '-',
    city: pick(a, ['city', 'province', 'state']) || '-',
    postalCode: pick(a, ['postalCode', 'postCode', 'zip', 'zipCode']),
    country: pick(a, ['country', 'countryCode', 'country_iso']) || 'Türkiye',
    email: pick(a, ['email', 'mail']) || pick(root, ['customerEmail', 'buyer_email', 'email']),
    phone: pick(a, ['phone', 'gsm', 'phoneNumber']),
  };
}

/**
 * Satırlar: pazaryeri birim fiyatı KDV dahildir; KDV hariç birim fiyat ve KDV ayrılır.
 * Kuruş farkı olmasın diye KDV dahil toplam esas alınır.
 */
export function buildLines(items: Array<{ sku: string; title: string; quantity: number; unitPrice: number; vatRate: number }>): { lines: InvoiceLine[]; totals: InvoiceDraft['totals'] } {
  const lines = items.filter((i) => i.quantity > 0).map((i) => {
    const rate = Number.isFinite(i.vatRate) && i.vatRate >= 0 ? i.vatRate : 20;
    const gross = r2(i.quantity * i.unitPrice);
    const net = r2(gross / (1 + rate / 100));
    return { sku: i.sku, name: i.title || i.sku, quantity: i.quantity, unitNet: r2(net / i.quantity), vatRate: rate, net, vat: r2(gross - net), gross };
  });
  const byRate: Record<string, { net: number; vat: number }> = {};
  for (const l of lines) {
    const k = String(l.vatRate);
    byRate[k] = { net: r2((byRate[k]?.net ?? 0) + l.net), vat: r2((byRate[k]?.vat ?? 0) + l.vat) };
  }
  return {
    lines,
    totals: { net: r2(lines.reduce((t, l) => t + l.net, 0)), vat: r2(lines.reduce((t, l) => t + l.vat, 0)), gross: r2(lines.reduce((t, l) => t + l.gross, 0)), byRate },
  };
}
