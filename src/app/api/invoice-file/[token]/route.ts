import { handlePublic, HttpError } from '@/lib/api';
import { rawDb } from '@/lib/supabase/server';
import { withStore } from '@/lib/tenant';
import { invoicePdf } from '@/lib/invoicing/service';

export const dynamic = 'force-dynamic';

/**
 * Pazaryerine verilen herkese açık fatura bağlantısı (Trendyol bunu müşteriye gösterir; yasal olarak uzun süre erişilebilir olmalı).
 * Yalnızca tahmin edilemeyen 32 karakterlik anahtarla açılır.
 */
export const GET = handlePublic(async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) throw new HttpError(404, 'Fatura bulunamadı.');
  const { data } = await rawDb().from('invoices').select('store_id, pdf_path, invoice_number').eq('public_token', token).maybeSingle();
  if (!data?.pdf_path) throw new HttpError(404, 'Fatura bulunamadı.');
  const blob = await withStore(data.store_id, () => invoicePdf(data.pdf_path));
  if (!blob) throw new HttpError(404, 'Fatura bulunamadı.');
  return new Response(blob, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${data.invoice_number ?? 'fatura'}.pdf"`, 'Cache-Control': 'private, max-age=3600' } });
});
