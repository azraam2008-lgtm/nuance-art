// Kargo etiketi: barkod doğruluğu ve pazaryeri verisinden bilgi çıkarma
import assert from 'node:assert/strict';
import { code128Widths, decodeCode128, encodable } from '../src/lib/shipping/code128';
import { extractLabel } from '../src/lib/shipping/label';

for (const t of ['7330012345678', 'TY123456789', 'abc-XYZ 09']) {
  const w = code128Widths(t);
  assert.equal(w.reduce((a, b) => a + b, 0), 11 * (t.length + 3) + 2, 'modül sayısı');
  assert.equal(decodeCode128(w), t, 'geri çözme');
}
assert.equal(encodable('Çiçek'), false);

// Trendyol paketi
const ty = extractLabel({
  cargoTrackingNumber: 7330012345678, cargoProviderName: 'Yurtiçi Kargo Marketplace',
  shipmentAddress: { fullName: 'Ayşe Yılmaz', fullAddress: 'Atatürk Mah. 1. Sok. No:3 Kadıköy İstanbul', district: 'Kadıköy', city: 'İstanbul' },
  lines: [{ barcode: '8690000000001' }],
}, { customerName: 'Ayşe Y.' });
assert.equal(ty.trackingNumber, '7330012345678');
assert.equal(ty.source, 'marketplace');
assert.equal(ty.recipient, 'Ayşe Yılmaz');
assert.match(ty.address, /Kadıköy/);
assert.equal(ty.carrier, 'Yurtiçi Kargo Marketplace');

// Etsy (adres düz alanlarda)
const et = extractLabel({ name: 'John Smith', first_line: '1 Main St', city: 'Boston', zip: '02101', shipments: [] }, { customerName: 'John' });
assert.equal(et.recipient, 'John Smith');
assert.match(et.address, /1 Main St.*Boston/);
assert.equal(et.trackingNumber, null);

// Ürün barkodu kargo numarası sanılmaz; panelde girilen takip numarası kullanılır
const m = extractLabel({ lines: [{ barcode: '8690000000001' }] }, { customerName: 'Ali', trackingNumber: 'MNG123' });
assert.equal(m.trackingNumber, 'MNG123');
assert.equal(m.source, 'manual');
assert.equal(extractLabel(null, { customerName: 'X' }).source, 'none');
console.log('shipping.test.ts: tüm kontroller geçti');
