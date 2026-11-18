import { handle, HttpError, readJson } from '@/lib/api';
import { isOrderStatus } from '@/lib/marketplaces/meta';
import { changeOrderStatus } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Sipariş durumunu güncelle. "cancelled" → stok havuza iade edilir ve tüm pazaryerlerine gönderilir.
export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { status } = await readJson<{ status?: string }>(req);
  if (!isOrderStatus(status)) throw new HttpError(400, 'Geçersiz sipariş durumu.');
  try {
    return await changeOrderStatus(id, status);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('yeniden açılamaz')) throw new HttpError(409, msg);
    throw e;
  }
});
