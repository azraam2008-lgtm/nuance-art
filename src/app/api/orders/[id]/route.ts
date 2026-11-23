import { handle, HttpError, readJson } from '@/lib/api';
import { isOrderStatus } from '@/lib/marketplaces/meta';
import { changeOrderStatus } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Sipariş durumunu güncelle ve siparişin geldiği pazaryerine bildir. "cancelled" → stok havuza iade edilir ve tüm pazaryerlerine gönderilir.
export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const b = await readJson<{ status?: string; trackingNumber?: string; carrier?: string; invoiceNumber?: string }>(req);
  if (!isOrderStatus(b.status)) throw new HttpError(400, 'Geçersiz sipariş durumu.');
  const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : null);
  try {
    return await changeOrderStatus(id, b.status, { trackingNumber: clean(b.trackingNumber), carrier: clean(b.carrier), invoiceNumber: clean(b.invoiceNumber) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('yeniden açılamaz')) throw new HttpError(409, msg);
    throw e;
  }
});
