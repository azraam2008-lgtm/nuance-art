import { handle, HttpError, readJson } from '@/lib/api';
import { isOrderStatus } from '@/lib/marketplaces/meta';
import { changeOrderStatus } from '@/lib/sync/engine';
import { ORDER_STATUS_META } from '@/lib/marketplaces/meta';
import { audit, orderNo } from '@/lib/audit';
import { autoQueueOnShip } from '@/lib/invoicing/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Sipariş durumunu güncelle ve siparişin geldiği pazaryerine bildir. "cancelled" → stok havuza iade edilir ve tüm pazaryerlerine gönderilir.
export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const b = await readJson<{ status?: string; trackingNumber?: string; carrier?: string; invoiceNumber?: string; returnReason?: string }>(req);
  if (!isOrderStatus(b.status)) throw new HttpError(400, 'Geçersiz sipariş durumu.');
  const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : null);
  try {
    const r = await changeOrderStatus(id, b.status, { trackingNumber: clean(b.trackingNumber), carrier: clean(b.carrier), invoiceNumber: clean(b.invoiceNumber), returnReason: clean(b.returnReason) });
    await audit('Sipariş durumu', `${await orderNo(id)} → ${ORDER_STATUS_META[b.status]?.label ?? b.status}`);
    if (b.status === 'shipped') await autoQueueOnShip(id);
    return r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('yeniden açılamaz')) throw new HttpError(409, msg);
    throw e;
  }
});
