import { handle, HttpError, readJson } from '@/lib/api';
import { markShipped } from '@/lib/sync/engine';
import { audit, orderNo } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * Siparişi "kargoya verildi" olarak işaretler; Bugün Kargoda / termin kuralları bu saate göre
 * değerlendirilir, kâr kesinleşir ve durum siparişin geldiği pazaryerine bildirilir (takip numarası varsa o da).
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const b = await readJson<{ at?: string; trackingNumber?: string; carrier?: string }>(req).catch(() => ({} as { at?: string; trackingNumber?: string; carrier?: string }));
  const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : null);
  if (b.at && Number.isNaN(Date.parse(b.at))) throw new HttpError(400, 'Geçersiz tarih.');
  try {
    const r = await markShipped(id, b.at ? new Date(b.at).toISOString() : undefined, { trackingNumber: clean(b.trackingNumber), carrier: clean(b.carrier) });
    await audit('Kargoya verildi', await orderNo(id));
    return r;
  } catch (e) {
    throw new HttpError(409, e instanceof Error ? e.message : String(e));
  }
});
