// Fatura: alıcı bilgisi çıkarma ve KDV hesabı
import assert from 'node:assert/strict';
import { ANON_TCKN, buildLines, extractBuyer } from '../src/lib/invoicing/model';

// Trendyol: fatura adresi ayrı, bireysel alıcı TCKN'siz → 11111111111
const b = extractBuyer({
  customerEmail: 'a@b.com',
  invoiceAddress: { fullName: 'Ayşe Yılmaz', address1: 'Moda Cad. 12', district: 'Kadıköy', city: 'İstanbul' },
  shipmentAddress: { fullName: 'Başka Kişi', address1: 'x' },
}, 'Ayşe');
assert.equal(b.name, 'Ayşe Yılmaz');
assert.equal(b.taxNumber, ANON_TCKN);
assert.equal(b.city, 'İstanbul');
assert.equal(b.email, 'a@b.com');

// Kurumsal alıcı: VKN + şirket unvanı
const c = extractBuyer({ invoiceAddress: { fullName: 'Ali Veli', company: 'Örnek Ltd. Şti.', taxNumber: '1234567890', taxOffice: 'Kadıköy' } }, 'Ali');
assert.equal(c.name, 'Örnek Ltd. Şti.');
assert.equal(c.taxNumber, '1234567890');
assert.equal(c.taxOffice, 'Kadıköy');

// Veri yoksa sipariş adı + boş alanlar "-"
const d = extractBuyer(null, 'Mehmet');
assert.equal(d.name, 'Mehmet');
assert.equal(d.address, '-');

// KDV: 2 x 120 TL (%20) → net 200, KDV 40; 1 x 108 TL (%8) → net 100, KDV 8
const { lines, totals } = buildLines([
  { sku: 'A', title: 'Mum', quantity: 2, unitPrice: 120, vatRate: 20 },
  { sku: 'B', title: 'Kitap', quantity: 1, unitPrice: 108, vatRate: 8 },
]);
assert.equal(lines[0].net, 200); assert.equal(lines[0].vat, 40); assert.equal(lines[0].unitNet, 100);
assert.equal(totals.gross, 348); assert.equal(totals.net, 300); assert.equal(totals.vat, 48);
assert.deepEqual(totals.byRate['8'], { net: 100, vat: 8 });
// Kuruşlu: toplam KDV dahil tutar korunur
const k = buildLines([{ sku: 'C', title: 'x', quantity: 3, unitPrice: 99.99, vatRate: 20 }]).totals;
assert.equal(k.gross, 299.97); assert.equal(Math.round((k.net + k.vat) * 100) / 100, 299.97);
console.log('invoicing.test.ts: tüm kontroller geçti');

// ---- Sağlayıcılar: sahte sunucuyla istek akışı (gerçek hesapla ayrıca doğrulanmalı)
async function providers() {
  const { ParasutProvider } = await import('../src/lib/invoicing/providers/parasut');
  const { NilveraProvider } = await import('../src/lib/invoicing/providers/nilvera');
  const { DEFAULT_SETTINGS } = await import('../src/lib/invoicing/types');
  const draft = {
    orderId: 'o1', orderNo: '123', marketplace: 'trendyol', marketplaceLabel: 'Trendyol', orderDate: '2026-11-20T10:00:00Z', carrier: 'Yurtiçi',
    buyer: extractBuyer({ invoiceAddress: { fullName: 'Ayşe', city: 'İstanbul' } }, 'Ayşe'), ...buildLines([{ sku: 'A', title: 'Mum', quantity: 2, unitPrice: 120, vatRate: 20 }]),
  };
  const calls: Array<{ url: string; method: string; body: any }> = [];
  const respond = (fn: (url: string, method: string) => unknown) => {
    (globalThis as any).fetch = async (url: string, init: any = {}) => {
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ url, method: init.method ?? 'GET', body });
      const out = fn(url, init.method ?? 'GET');
      if (out instanceof Uint8Array) return new Response(out as unknown as BodyInit, { headers: { 'content-type': 'application/pdf' } });
      return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  };

  // Paraşüt: token → müşteri → satış faturası → e-Arşiv → iş bitti → numara + PDF
  respond((url) => {
    if (url.endsWith('/oauth/token')) return { access_token: 'T' };
    if (url.endsWith('/contacts')) return { data: { id: 'C1' } };
    if (url.endsWith('/sales_invoices')) return { data: { id: 'S1' } };
    if (url.endsWith('/e_archives')) return { data: { id: 'J1', type: 'trackable_jobs' } };
    if (url.includes('/trackable_jobs/J1')) return { data: { attributes: { status: 'done' } } };
    if (url.includes('/sales_invoices/S1?include')) return { data: { relationships: { active_e_document: { data: { id: 'E1', type: 'e_archives' } } } }, included: [{ id: 'E1', type: 'e_archives', attributes: { invoice_number: 'GIB2026000000001', uuid: 'U1' } }] };
    if (url.includes('/e_archives/E1/pdf')) return { data: { attributes: { url: 'https://files.example/x.pdf' } } };
    if (url === 'https://files.example/x.pdf') return new Uint8Array([37, 80, 68, 70]);
    return {};
  });
  const ps = { ...DEFAULT_SETTINGS, provider: 'parasut' as const, parasut: { ...DEFAULT_SETTINGS.parasut, clientId: 'id', username: 'u@x.com', companyId: '42' } };
  const pr = await new ParasutProvider(ps, { parasutClientSecret: 's', parasutPassword: 'p' }).issue(draft, { uuid: 'X', ref: {} });
  assert.equal(pr.status, 'issued'); assert.equal(pr.invoiceNumber, 'GIB2026000000001'); assert.equal(pr.pdf?.length, 4);
  const inv = calls.find((c) => c.url.endsWith('/v4/42/sales_invoices'))!;
  assert.equal(inv.body.data.relationships.details.data[0].attributes.unit_price, 100, 'KDV hariç birim fiyat');
  assert.equal(calls.find((c) => c.url.endsWith('/e_archives'))!.body.data.relationships.sales_invoice.data.id, 'S1');
  // Kaldığı yerden devam: müşteri/fatura tekrar oluşturulmaz
  calls.length = 0;
  await new ParasutProvider(ps, { parasutClientSecret: 's', parasutPassword: 'p' }).issue(draft, { uuid: 'X', ref: pr.ref! });
  assert.equal(calls.some((c) => c.url.endsWith('/contacts') || c.url.endsWith('/sales_invoices') || c.url.endsWith('/e_archives')), false);

  // Nilvera: model gönder → numara + PDF; aynı UUID gider
  calls.length = 0;
  respond((url, method) => {
    if (url.endsWith('/earchive/Send/Model') && method === 'POST') return { UUID: 'U9', InvoiceNumber: 'KRV2026000000007' };
    if (url.endsWith('/pdf')) return new Uint8Array([37, 80, 68, 70, 1]);
    return {};
  });
  const ns = { ...DEFAULT_SETTINGS, provider: 'nilvera' as const, seller: { ...DEFAULT_SETTINGS.seller, name: 'Atölye', taxNumber: '12345678901' } };
  const nr = await new NilveraProvider(ns, { nilveraApiKey: 'K' }).issue(draft, { uuid: 'U9', ref: {} });
  assert.equal(nr.status, 'issued'); assert.equal(nr.invoiceNumber, 'KRV2026000000007');
  const sent = calls.find((c) => c.url.endsWith('/earchive/Send/Model'))!;
  assert.equal(sent.url.startsWith('https://api.nilvera.com'), true);
  assert.equal(sent.body.ArchiveInvoice.InvoiceInfo.UUID, 'U9');
  assert.equal(sent.body.ArchiveInvoice.InvoiceInfo.PayableAmount, 240);
  assert.equal(sent.body.ArchiveInvoice.InvoiceLines[0].Price, 100);
  assert.equal(sent.body.ArchiveInvoice.CustomerInfo.TaxNumber, ANON_TCKN);

  // Uyumsoft: JSON servis, Action=SendInvoice, UBL-TR yapısı; numara + PDF
  const { UyumsoftProvider } = await import('../src/lib/invoicing/providers/uyumsoft');
  calls.length = 0;
  const pdfB64 = Buffer.from('%PDF-1.4 ' + 'x'.repeat(200)).toString('base64');
  respond(() => {
    const body = calls[calls.length - 1].body;
    if (body.Action === 'SendInvoice') return { IsSucceded: true, Value: [{ Id: 'U5', Number: 'UYM2026000000005' }] };
    if (body.Action === 'GetOutboxInvoicePdf') return { IsSucceded: true, Value: { Data: pdfB64 } };
    return { IsSucceded: true, Value: false };
  });
  const us = { ...DEFAULT_SETTINGS, provider: 'uyumsoft' as const, seller: { ...DEFAULT_SETTINGS.seller, name: 'Atölye', taxNumber: '1234567890' }, uyumsoft: { username: 'Uyumsoft', test: true, baseUrl: '' } };
  const ur = await new UyumsoftProvider(us, { uyumsoftPassword: 'Uyumsoft' }).issue(draft, { uuid: 'U5', ref: {} });
  assert.equal(ur.status, 'issued'); assert.equal(ur.invoiceNumber, 'UYM2026000000005'); assert.ok(ur.pdf && ur.pdf.length > 100);
  const us1 = calls.find((c) => c.body?.Action === 'SendInvoice')!;
  assert.equal(us1.url, 'https://efatura-test.uyumsoft.com.tr/api/BasicIntegrationApi');
  assert.equal(us1.body.parameters.userInfo.Username, 'Uyumsoft');
  const uinv = us1.body.parameters.invoices[0].Invoice;
  assert.equal(uinv.UUID.value, 'U5'); assert.equal(uinv.ProfileId.value, 'EARSIVFATURA');
  assert.equal(uinv.LegalMonetaryTotal.PayableAmount.value, 240); assert.equal(uinv.InvoiceLine[0].Price.PriceAmount.value, 100);
  assert.equal(uinv.AccountingCustomerParty.Party.PartyIdentification[0].Id.schemeId, 'TCKN');
  // Hata yanıtı açıkça iletilir
  respond(() => ({ IsSucceded: false, Message: 'Kullanıcı adı veya şifre hatalı' }));
  await assert.rejects(new UyumsoftProvider(us, { uyumsoftPassword: 'x' }).issue(draft, { uuid: 'U6', ref: {} }), /şifre hatalı/);
  console.log('invoicing.test.ts: sağlayıcı akışları geçti');
}
providers().catch((e) => { console.error(e); process.exit(1); });
