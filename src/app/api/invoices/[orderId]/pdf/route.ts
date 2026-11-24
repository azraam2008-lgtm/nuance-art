import { handle, HttpError } from '@/lib/api';
import { db } from '@/lib/supabase/server';
import { invoicePdf } from '@/lib/invoicing/service';

export const dynamic = 'force-dynamic';

/** Faturanın PDF'i (oturum gerekir) */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ orderId: string }> }) => {
  const { orderId } = await ctx.params;
  const { data } = await db().from('invoices').select('pdf_path, invoice_number').eq('order_id', orderId).maybeSingle();
  if (!data?.pdf_path) throw new HttpError(404, 'Bu faturanın PDF dosyası yok.');
  const blob = await invoicePdf(data.pdf_path);
  if (!blob) throw new HttpError(404, 'PDF bulunamadı.');
  return new Response(blob, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${data.invoice_number ?? 'fatura'}.pdf"` } });
});
