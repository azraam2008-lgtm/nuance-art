import type { InvoiceDraft } from '../model';
import type { InvoiceProvider, IssueResult, IssueState } from '../types';

/** Deneme mağazası: gerçek fatura kesmez, örnek numara üretir */
export class DemoInvoiceProvider implements InvoiceProvider {
  readonly name = 'demo' as const;
  async test() { return { ok: true, message: 'Deneme mağazası: fatura bağlantısı simülasyon.' }; }
  async issue(d: InvoiceDraft, st: IssueState): Promise<IssueResult> {
    const n = `DMO${new Date().getFullYear()}${st.uuid.replace(/\D/g, '').padEnd(9, '0').slice(0, 9)}`;
    return { status: 'issued', kind: 'e_archive', invoiceNumber: n, uuid: st.uuid, issuedAt: new Date().toISOString(), ref: st.ref, message: `Örnek fatura oluşturuldu (${d.orderNo}). Gerçek değildir.` };
  }
}
