import { handle, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/supabase/server';
import { buildDraft, getInvoicingSettings, processDueInvoices, queueInvoices, setManualInvoice } from '@/lib/invoicing/service';
import { isDemoStore } from '@/lib/demo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

/** Bir siparişin fatura durumu + faturaya girecek bilgiler (alıcı, satırlar, KDV) */
export const GET = handle(async (req: Request) => {
  const orderId = new URL(req.url).searchParams.get('orderId');
  if (!isId(orderId)) throw new HttpError(400, 'Sipariş seçilmedi.');
  const { data: invoice } = await db().from('invoices')
    .select('id, provider, status, kind, invoice_number, issued_at, total, pdf_path, last_error, attempts, next_try_at, marketplace_sent').eq('order_id', orderId).maybeSingle();
  const draft = await buildDraft(orderId);
  const s = await getInvoicingSettings();
  return { invoice, draft: { ...draft, raw: undefined }, provider: (await isDemoStore()) ? 'demo' : s.provider };
});

/**
 * action=issue: seçilen siparişleri sıraya alır ve hemen keser (sonuç sipariş bazında döner).
 * action=manual: kendi programında kesilen faturanın numarasını (ve isteğe bağlı PDF'ini) kaydeder.
 */
export const POST = handle(async (req: Request) => {
  const b = await readJson<{ action?: string; ids?: unknown[]; orderId?: string; number?: string; pdfBase64?: string }>(req);
  if (b.action === 'issue') {
    const ids = (Array.isArray(b.ids) ? b.ids : []).filter(isId);
    if (!ids.length) throw new HttpError(400, 'Sipariş seçilmedi.');
    if (ids.length > 50) throw new HttpError(400, 'Tek seferde en fazla 50 fatura kesilebilir.');
    const s = await getInvoicingSettings();
    if (!(await isDemoStore()) && (s.provider === 'none' || s.provider === 'manual')) {
      throw new HttpError(400, 'Otomatik fatura için Ayarlar → Fatura bölümünden Paraşüt, Nilvera veya Uyumsoft bağlayın. Kendi programınızla kesiyorsanız fatura numarasını siparişe yazın.');
    }
    await queueInvoices(ids);
    const results = await processDueInvoices({ orderIds: ids, budgetMs: 50_000 });
    return { results };
  }
  if (b.action === 'manual') {
    if (!isId(b.orderId)) throw new HttpError(400, 'Sipariş seçilmedi.');
    const number = String(b.number ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3}\d{13}$/.test(number) && !/^[A-Z0-9-]{3,30}$/.test(number)) throw new HttpError(400, 'Geçerli bir fatura numarası girin (ör. ABC2026000000001).');
    let pdf: Uint8Array | null = null;
    if (b.pdfBase64) {
      const buf = Buffer.from(b.pdfBase64.replace(/^data:[^,]+,/, ''), 'base64');
      if (buf.length > 4_000_000) throw new HttpError(400, 'PDF en fazla 4 MB olabilir.');
      if (buf.subarray(0, 4).toString() !== '%PDF') throw new HttpError(400, 'Yüklenen dosya PDF değil.');
      pdf = new Uint8Array(buf);
    }
    return setManualInvoice(b.orderId, number, pdf);
  }
  throw new HttpError(400, 'Geçersiz işlem.');
});
