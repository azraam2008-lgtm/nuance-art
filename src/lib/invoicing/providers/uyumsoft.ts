import 'server-only';
import { request, errorMessage, rec, str } from '@/lib/marketplaces/http';
import type { InvoiceDraft, Party } from '../model';
import type { InvoiceProvider, InvoicingSecrets, InvoicingSettings, IssueResult, IssueState } from '../types';

/**
 * Uyumsoft (özel entegratör) — BasicIntegration JSON servisi: POST {taban}/api/BasicIntegrationApi
 * gövde: { Action, parameters: { ..., userInfo: { Username, Password } } }.
 * Fatura UBL-TR yapısında (JSON) gönderilir; senaryo "otomatik": alıcı e-Fatura mükellefiyse e-Fatura, değilse e-Arşiv.
 * Faturanın UUID'si (ETTN) bizde tutulur ve tekrar denemede aynı gider → aynı fatura iki kez kesilmez.
 * Kimlik: Uyumsoft web servis kullanıcı adı ve şifresi (Uyumsoft'tan istenir). Test ortamı kullanıcısı: Uyumsoft / Uyumsoft.
 * Kaynak: Uyumsoft BasicIntegration servisi ve açık kaynak istemcisi (gkvdt/uyumsoft-einvoice). Gerçek hesapla doğrulanmalı.
 */
const v = <T,>(value: T) => ({ value });
const amt = (n: number) => ({ currencyId: 'TRY', value: Math.round(n * 100) / 100 });
const KDV = { TaxScheme: { Name: v('KDV'), TaxTypeCode: v('0015') } };

function party(p: Party) {
  const tckn = p.taxNumber.length === 11;
  const [first, ...rest] = p.name.trim().split(/\s+/);
  return {
    PartyIdentification: [{ Id: { schemeId: tckn ? 'TCKN' : 'VKN', value: p.taxNumber } }],
    PartyName: v_name(p.name),
    PostalAddress: { StreetName: v(p.address || '-'), CitySubdivisionName: v(p.district || '-'), CityName: v(p.city || '-'), PostalZone: v(p.postalCode || ''), Country: { Name: v(p.country || 'Türkiye') } },
    PartyTaxScheme: { TaxScheme: { Name: v(p.taxOffice || '') } },
    Contact: { Telephone: v(p.phone || ''), ElectronicMail: v(p.email || '') },
    ...(tckn ? { Person: { FirstName: v(first || p.name), FamilyName: v(rest.join(' ') || '-') } } : {}),
  };
}
const v_name = (name: string) => ({ Name: v(name) });

/** Yanıtın içinde (iç içe) verilen adlardaki ilk dolu değeri bulur */
function deep(o: unknown, keys: string[], depth = 5): string {
  if (depth < 0 || !o || typeof o !== 'object') return '';
  if (Array.isArray(o)) { for (const x of o) { const r = deep(x, keys, depth - 1); if (r) return r; } return ''; }
  const r = o as Record<string, unknown>;
  for (const k of keys) { const x = r[k]; if ((typeof x === 'string' || typeof x === 'number') && String(x)) return String(x); }
  for (const x of Object.values(r)) { const y = deep(x, keys, depth - 1); if (y) return y; }
  return '';
}

export function buildUyumsoftInvoice(d: InvoiceDraft, seller: Party, uuid: string, eInvoiceBuyer: boolean, now = new Date()) {
  const ist = new Date(now.getTime() + 3 * 3600_000).toISOString();
  return {
    UblVersionId: v('2.1'), CustomizationId: v('TR1.2'), ProfileId: v(eInvoiceBuyer ? 'TEMELFATURA' : 'EARSIVFATURA'),
    CopyIndicator: v(false), UUID: v(uuid), IssueDate: v(ist.slice(0, 10)), IssueTime: v(ist.slice(11, 19)),
    InvoiceTypeCode: v('SATIS'), Note: [v(`${d.marketplaceLabel} sipariş no: ${d.orderNo}`)], DocumentCurrencyCode: v('TRY'), LineCountNumeric: v(d.lines.length),
    AccountingSupplierParty: { Party: party(seller) },
    AccountingCustomerParty: { Party: party(d.buyer) },
    TaxTotal: [{
      TaxAmount: amt(d.totals.vat),
      TaxSubtotal: Object.entries(d.totals.byRate).map(([rate, t]) => ({ TaxableAmount: amt(t.net), TaxAmount: amt(t.vat), Percent: v(Number(rate)), TaxCategory: KDV })),
    }],
    LegalMonetaryTotal: { LineExtensionAmount: amt(d.totals.net), TaxExclusiveAmount: amt(d.totals.net), TaxInclusiveAmount: amt(d.totals.gross), AllowanceTotalAmount: amt(0), PayableAmount: amt(d.totals.gross) },
    InvoiceLine: d.lines.map((l, i) => ({
      Id: v(String(i + 1)),
      InvoicedQuantity: { unitCode: 'C62', value: l.quantity },
      LineExtensionAmount: amt(l.net),
      TaxTotal: { TaxAmount: amt(l.vat), TaxSubtotal: [{ TaxableAmount: amt(l.net), TaxAmount: amt(l.vat), Percent: v(l.vatRate), TaxCategory: KDV }] },
      Item: { Name: v(l.name), SellersItemIdentification: { Id: v(l.sku) } },
      Price: { PriceAmount: amt(l.unitNet) },
    })),
  };
}

export class UyumsoftProvider implements InvoiceProvider {
  readonly name = 'uyumsoft' as const;
  constructor(private s: InvoicingSettings, private sec: InvoicingSecrets) {}
  private get url() {
    const base = (this.s.uyumsoft.baseUrl || (this.s.uyumsoft.test ? 'https://efatura-test.uyumsoft.com.tr' : 'https://efatura.uyumsoft.com.tr')).replace(/\/+$/, '');
    return `${base}/api/BasicIntegrationApi`;
  }
  private async call(action: string, parameters: Record<string, unknown>) {
    if (!this.s.uyumsoft.username || !this.sec.uyumsoftPassword) throw new Error('Uyumsoft web servis kullanıcı adı ve şifresi girilmemiş.');
    const res = rec(await request(this.url, { method: 'POST', json: { Action: action, parameters: { ...parameters, userInfo: { Username: this.s.uyumsoft.username, Password: this.sec.uyumsoftPassword } } } }));
    const ok = res.IsSucceded ?? res.IsSucceeded ?? rec(res.Data).IsSucceded;
    if (ok === false) throw new Error(`Uyumsoft: ${str(res.Message) || str(rec(res.Data).Message) || 'işlem başarısız'}`);
    return res;
  }

  async test() {
    try {
      await this.call('IsEInvoiceUser', { vknTckn: this.s.seller.taxNumber || '1111111111', alias: '' });
      return { ok: true, message: 'Uyumsoft bağlantısı başarılı.' };
    } catch (e) { return { ok: false, message: `Uyumsoft: ${errorMessage(e)}` }; }
  }

  async issue(d: InvoiceDraft, st: IssueState): Promise<IssueResult> {
    const ref = { ...st.ref };
    if (ref.eInvoiceBuyer === undefined) {
      ref.eInvoiceBuyer = false;
      if (d.buyer.taxNumber.length === 10) {
        const r = await this.call('IsEInvoiceUser', { vknTckn: d.buyer.taxNumber, alias: '' }).catch(() => null);
        const val = r ? (r.Value ?? rec(r.Data).Value) : false;
        ref.eInvoiceBuyer = val === true || val === 'true';
      }
    }
    let number = '';
    if (!ref.sent) {
      try {
        const res = await this.call('SendInvoice', {
          invoices: [{
            Invoice: buildUyumsoftInvoice(d, this.s.seller, st.uuid, !!ref.eInvoiceBuyer),
            ...(ref.eInvoiceBuyer ? {} : { EArchiveInvoiceInfo: { DeliveryType: 'Electronic' } }),
            Scenario: 0, // otomatik: e-Fatura / e-Arşiv'i Uyumsoft alıcıya göre seçer
            ...(d.buyer.email ? { Notification: { Mailing: [{ Subject: `${d.marketplaceLabel} ${d.orderNo} numaralı siparişinizin faturası`, EnableNotification: true, To: d.buyer.email, Attachment: { Xml: false, Pdf: true } }] } } : {}),
            LocalDocumentId: d.orderNo,
          }],
        });
        number = deep(res, ['Number', 'InvoiceNumber', 'DocumentNumber']);
      } catch (e) {
        if (!/uuid|ettn|zaten|already|mevcut|daha önce/i.test(errorMessage(e))) throw e;
      }
      ref.sent = true;
    }
    if (!number) {
      const info = await this.call('GetOutboxInvoice', { invoiceId: st.uuid }).catch(() => null);
      number = info ? deep(info, ['Number', 'InvoiceNumber', 'DocumentNumber', 'InvoiceId']) : '';
    }
    let pdf: Uint8Array | null = null;
    try {
      const p = await this.call('GetOutboxInvoicePdf', { invoiceId: st.uuid });
      const b64 = deep(p, ['Data', 'Value', 'Content', 'Pdf']);
      if (b64.length > 100) pdf = new Uint8Array(Buffer.from(b64, 'base64'));
      if (pdf && Buffer.from(pdf.subarray(0, 4)).toString() !== '%PDF') pdf = null;
    } catch { /* PDF sonra tekrar alınabilir */ }
    if (!number) return { status: 'processing', ref, pdf, uuid: st.uuid, message: 'Uyumsoft faturayı aldı; fatura numarası birazdan kontrol edilecek.' };
    return {
      status: 'issued', kind: ref.eInvoiceBuyer ? 'e_invoice' : 'e_archive', ref, pdf, uuid: st.uuid, invoiceNumber: number, issuedAt: new Date().toISOString(),
      message: `Uyumsoft'ta ${ref.eInvoiceBuyer ? 'e-Fatura' : 'e-Arşiv fatura'} kesildi.`,
    };
  }
}
