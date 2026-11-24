import 'server-only';
import { request, errorMessage, rec, str } from '@/lib/marketplaces/http';
import type { InvoiceDraft } from '../model';
import type { InvoiceProvider, InvoicingSecrets, InvoicingSettings, IssueResult, IssueState } from '../types';

/**
 * Nilvera e-Arşiv: POST /earchive/Send/Model (JSON model), PDF: GET /earchive/Invoices/{uuid}/pdf.
 * Kimlik: Nilvera portalındaki API anahtarı (Bearer). Fatura UUID'sini biz üretiriz ve kayıtta tutarız;
 * tekrar denemede aynı UUID gider, böylece aynı fatura iki kez kesilmez.
 * Alıcı e-Fatura mükellefiyse (kurumsal) e-Fatura gerekir: bu sürümde desteklenmiyor, açıkça bildirilir.
 * Kaynak: Nilvera geliştirici belgeleri ve açık kaynak istemcisi. Gerçek hesapla doğrulanmalı.
 */
export class NilveraProvider implements InvoiceProvider {
  readonly name = 'nilvera' as const;
  constructor(private s: InvoicingSettings, private sec: InvoicingSecrets) {}
  private get base() { return (this.s.nilvera.baseUrl || (this.s.nilvera.test ? 'https://apitest.nilvera.com' : 'https://api.nilvera.com')).replace(/\/+$/, ''); }
  private get headers() {
    if (!this.sec.nilveraApiKey) throw new Error('Nilvera API anahtarı girilmemiş.');
    return { Authorization: `Bearer ${this.sec.nilveraApiKey}` };
  }

  async test() {
    try {
      await request(`${this.base}/general/Company`, { headers: this.headers, retries: 0 });
      return { ok: true, message: 'Nilvera bağlantısı başarılı.' };
    } catch (e) { return { ok: false, message: `Nilvera: ${errorMessage(e)}` }; }
  }

  async issue(d: InvoiceDraft, st: IssueState): Promise<IssueResult> {
    const ref = { ...st.ref };
    if (d.buyer.taxNumber.length === 10 && !ref.checkedEInvoice) {
      const chk = await request(`${this.base}/general/GlobalCompany/Check/TaxNumber/${d.buyer.taxNumber}`, { headers: this.headers }).catch(() => null);
      ref.checkedEInvoice = true;
      const registered = Array.isArray(chk) ? chk.length > 0 : chk === true || !!rec(chk).TaxNumber;
      if (registered) {
        return { status: 'failed', ref, message: 'Alıcı e-Fatura mükellefi (kurumsal). Bu fatura e-Fatura olarak kesilmeli: Nilvera panelinden kesip numarasını bu siparişe yazın. (Otomatik e-Fatura Nilvera için henüz desteklenmiyor.)' };
      }
    }
    const seller = this.s.seller;
    const date = new Date().toISOString();
    const party = (p: typeof seller | typeof d.buyer) => ({
      TaxNumber: p.taxNumber, Name: p.name, TaxOffice: p.taxOffice, Address: p.address, District: p.district, City: p.city,
      Country: p.country || 'Türkiye', PostalCode: p.postalCode, Phone: p.phone || undefined, Mail: p.email || undefined,
    });
    const kdvTotal = (rate: number) => d.totals.byRate[String(rate)]?.vat ?? 0;
    const body = { ArchiveInvoice: {
      InvoiceInfo: {
        UUID: st.uuid, InvoiceType: 'SATIS', InvoiceSerieOrNumber: (this.s.series || 'KRV').slice(0, 3).toUpperCase(),
        IssueDate: date, CurrencyCode: 'TRY', ExchangeRate: 1, ISDespatch: false,
        SalesPlatform: 'INTERNET', SendType: 'ELEKTRONIK',
        InternetInfo: { WebSite: seller.website || 'www.trendyol.com', PaymentMethod: 'ODEMEARACISI', PaymentMethodName: 'Pazaryeri', PaymentAgentName: d.marketplaceLabel,
          PaymentDate: d.orderDate, TransporterName: d.carrier ?? '', TransporterRegisterNumber: '', TransportDate: date },
        LineExtensionAmount: d.totals.net, KdvTotal: d.totals.vat, PayableAmount: d.totals.gross, GeneralAllowanceTotal: 0,
        GeneralKDV1Total: kdvTotal(1), GeneralKDV8Total: kdvTotal(8), GeneralKDV10Total: kdvTotal(10), GeneralKDV18Total: kdvTotal(18), GeneralKDV20Total: kdvTotal(20),
      },
      CompanyInfo: party(seller),
      CustomerInfo: party(d.buyer),
      InvoiceLines: d.lines.map((l, i) => ({ Index: String(i + 1), SellerCode: l.sku, Name: l.name, Quantity: l.quantity, UnitType: 'C62', Price: l.unitNet, AllowanceTotal: 0, KDVPercent: l.vatRate, KDVTotal: l.vat })),
      Notes: [`${d.marketplaceLabel} sipariş no: ${d.orderNo}`],
    } };
    let res: Record<string, unknown> = {};
    if (!ref.sent) {
      try {
        res = rec(await request(`${this.base}/earchive/Send/Model`, { method: 'POST', headers: this.headers, json: body }));
      } catch (e) {
        const m = errorMessage(e);
        // Aynı UUID daha önce gönderilmişse fatura zaten kesilmiştir → bilgilerini çek
        if (!/uuid|zaten|already|mevcut/i.test(m)) throw e;
      }
      ref.sent = true;
    }
    const detail = rec(await request(`${this.base}/earchive/Invoices/${st.uuid}`, { headers: this.headers }).catch(() => ({})));
    const number = str(res.InvoiceNumber) || str(detail.InvoiceNumber) || str(rec(detail.Content).InvoiceNumber) || null;
    let pdf: Uint8Array | null = null;
    try {
      const r = await fetch(`${this.base}/earchive/Invoices/${st.uuid}/pdf`, { headers: this.headers });
      if (r.ok) {
        const type = r.headers.get('content-type') ?? '';
        if (type.includes('pdf') || type.includes('octet')) pdf = new Uint8Array(await r.arrayBuffer());
        else { const t = (await r.text()).replace(/^"|"$/g, ''); if (t.length > 100) pdf = new Uint8Array(Buffer.from(t, 'base64')); }
      }
    } catch { /* PDF sonra tekrar alınabilir */ }
    if (!number) return { status: 'processing', ref, pdf, uuid: st.uuid, message: 'Nilvera faturayı aldı; fatura numarası birazdan kontrol edilecek.' };
    return { status: 'issued', kind: 'e_archive', ref, pdf, uuid: st.uuid, invoiceNumber: number, issuedAt: date, message: 'Nilvera\'da e-Arşiv fatura kesildi.' };
  }
}
