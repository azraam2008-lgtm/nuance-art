import 'server-only';
import { request, errorMessage, rec, recs, str } from '@/lib/marketplaces/http';
import type { InvoiceDraft } from '../model';
import type { InvoiceProvider, InvoicingSecrets, InvoicingSettings, IssueResult, IssueState } from '../types';

/**
 * Paraşüt (API v4, JSON:API). Akış: müşteri → satış faturası → (alıcı e-Fatura mükellefiyse e-Fatura, değilse e-Arşiv)
 * → iş takibi (trackable_jobs) → PDF. Her adımın sonucu ref'e yazılır; tekrar denemede tamamlanan adım tekrarlanmaz.
 * Kaynak: Paraşüt API v4 (api.parasut.com/v4) ve açık kaynak istemcileri. Gerçek hesapla doğrulanmalı.
 */
export class ParasutProvider implements InvoiceProvider {
  readonly name = 'parasut' as const;
  private token: string | null = null;
  constructor(private s: InvoicingSettings, private sec: InvoicingSecrets) {}

  private get host() { return (this.s.parasut.baseUrl || 'https://api.parasut.com').replace(/\/+$/, ''); }
  private get base() { return `${this.host}/v4/${encodeURIComponent(this.s.parasut.companyId)}`; }

  private async auth(): Promise<string> {
    if (this.token) return this.token;
    const p = this.s.parasut;
    if (!p.clientId || !this.sec.parasutClientSecret || !p.username || !this.sec.parasutPassword || !p.companyId) {
      throw new Error('Paraşüt bilgileri eksik (Client ID, Client Secret, kullanıcı adı, şifre, firma numarası).');
    }
    const res = rec(await request(`${this.host}/oauth/token`, {
      method: 'POST', retries: 1,
      json: { grant_type: 'password', client_id: p.clientId, client_secret: this.sec.parasutClientSecret, username: p.username, password: this.sec.parasutPassword, redirect_uri: 'urn:ietf:wg:oauth:2.0:oob' },
    }));
    this.token = str(res.access_token);
    if (!this.token) throw new Error('Paraşüt oturum açılamadı (access_token gelmedi).');
    return this.token;
  }
  private async call(path: string, opts: { method?: 'GET' | 'POST'; json?: unknown } = {}) {
    const token = await this.auth();
    return rec(await request(`${this.base}${path}`, { method: opts.method ?? 'GET', json: opts.json, headers: { Authorization: `Bearer ${token}` } }));
  }

  async test() {
    try {
      await this.call('/contacts?page[size]=1');
      return { ok: true, message: 'Paraşüt bağlantısı başarılı.' };
    } catch (e) { return { ok: false, message: `Paraşüt: ${errorMessage(e)}` }; }
  }

  async issue(d: InvoiceDraft, st: IssueState): Promise<IssueResult> {
    const ref = { ...st.ref };
    const date = d.orderDate.slice(0, 10);
    // 1) Müşteri
    if (!ref.contactId) {
      const company = d.buyer.taxNumber.length === 10;
      const c = await this.call('/contacts', { method: 'POST', json: { data: { type: 'contacts', attributes: {
        name: d.buyer.name, email: d.buyer.email || undefined, contact_type: company ? 'company' : 'person', account_type: 'customer',
        tax_number: d.buyer.taxNumber, tax_office: d.buyer.taxOffice || undefined, city: d.buyer.city, district: d.buyer.district, address: d.buyer.address, phone: d.buyer.phone || undefined,
      } } } });
      ref.contactId = str(rec(c.data).id);
    }
    // 2) Satış faturası (KDV hariç birim fiyatlarla)
    if (!ref.salesInvoiceId) {
      const productId = this.s.parasut.productId;
      const inv = await this.call('/sales_invoices', { method: 'POST', json: { data: { type: 'sales_invoices',
        attributes: { item_type: 'invoice', description: `${d.marketplaceLabel} sipariş #${d.orderNo}`, issue_date: date, due_date: date, currency: 'TRL', order_no: d.orderNo, order_date: date },
        relationships: {
          contact: { data: { id: ref.contactId, type: 'contacts' } },
          details: { data: d.lines.map((l) => ({ type: 'sales_invoice_details',
            attributes: { quantity: l.quantity, unit_price: l.unitNet, vat_rate: l.vatRate, description: l.name },
            ...(productId ? { relationships: { product: { data: { id: productId, type: 'products' } } } } : {}),
          })) },
        } } } });
      ref.salesInvoiceId = str(rec(inv.data).id);
    }
    // 3) e-Fatura mı e-Arşiv mi?
    if (!ref.jobId) {
      let inbox = '';
      if (d.buyer.taxNumber.length === 10) {
        const ib = await this.call(`/e_invoice_inboxes?filter[vkn]=${d.buyer.taxNumber}`);
        inbox = str(rec(recs(ib.data)[0]?.attributes).e_invoice_address);
      }
      ref.kind = inbox ? 'e_invoice' : 'e_archive';
      const body = inbox
        ? { data: { type: 'e_invoices', attributes: { scenario: 'basic', to: inbox }, relationships: { invoice: { data: { id: ref.salesInvoiceId, type: 'sales_invoices' } } } } }
        : { data: { type: 'e_archives', attributes: { internet_sale: { url: this.s.seller.website || 'https://www.trendyol.com', payment_type: 'ODEMEARACISI', payment_platform: d.marketplaceLabel, payment_date: date } },
            relationships: { sales_invoice: { data: { id: ref.salesInvoiceId, type: 'sales_invoices' } } } } };
      const job = await this.call(inbox ? '/e_invoices' : '/e_archives', { method: 'POST', json: body });
      ref.jobId = str(rec(job.data).id);
    }
    // 4) İş durumu (birkaç saniye bekle; bitmezse zamanlayıcı sonra tekrar bakar)
    for (let i = 0; i < 4; i++) {
      const j = rec(rec((await this.call(`/trackable_jobs/${ref.jobId}`)).data).attributes);
      const status = str(j.status);
      if (status === 'error') {
        const errs = Array.isArray(j.errors) ? j.errors.map(String).join('; ') : '';
        delete ref.jobId; // düzeltip tekrar denendiğinde yeniden gönderilsin
        return { status: 'failed', ref, message: `Paraşüt e-belge hatası: ${errs || 'bilinmiyor'}` };
      }
      if (status === 'done') break;
      if (i === 3) return { status: 'processing', ref, message: 'Paraşüt faturayı işliyor; birkaç dakika içinde tekrar kontrol edilecek.' };
      await new Promise((r) => setTimeout(r, 2000));
    }
    // 5) Fatura numarası ve PDF
    const si = await this.call(`/sales_invoices/${ref.salesInvoiceId}?include=active_e_document`);
    const docRel = rec(rec(rec(rec(si.data).relationships).active_e_document).data);
    const docId = str(docRel.id);
    const docType = str(docRel.type) || (ref.kind === 'e_invoice' ? 'e_invoices' : 'e_archives');
    const inc = recs(si.included).find((x) => str(x.id) === docId);
    const attrs = rec(inc?.attributes);
    let pdf: Uint8Array | null = null;
    if (docId) {
      try {
        const p = await this.call(`/${docType}/${docId}/pdf`);
        const url = str(rec(rec(p.data).attributes).url);
        if (url) { const r = await fetch(url); if (r.ok) pdf = new Uint8Array(await r.arrayBuffer()); }
      } catch { /* PDF henüz hazır değilse numara yine kaydedilir */ }
    }
    return {
      status: 'issued', kind: ref.kind as 'e_archive' | 'e_invoice', ref, pdf,
      invoiceNumber: str(attrs.invoice_number) || str(attrs.invoice_id) || null, uuid: str(attrs.uuid) || null, issuedAt: new Date().toISOString(),
      message: `Paraşüt'te ${ref.kind === 'e_invoice' ? 'e-Fatura' : 'e-Arşiv fatura'} kesildi.`,
    };
  }
}
