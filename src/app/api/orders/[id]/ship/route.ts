import { handle, HttpError, readJson } from '@/lib/api';
import { markShipped } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';

/**
 * Siparişi "kargoya verildi" olarak işaretler; Bugün Kargoda / termin kuralları bu saate göre
 * değerlendirilir ve kâr kesinleşir. Canlı pazaryerlerinde bu bilgi zaten sipariş senkronuyla gelir.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const b = await readJson<{ at?: string }>(req).catch(() => ({} as { at?: string }));
  if (b.at && Number.isNaN(Date.parse(b.at))) throw new HttpError(400, 'Geçersiz tarih.');
  try {
    return { cost: await markShipped(id, b.at ? new Date(b.at).toISOString() : undefined) };
  } catch (e) {
    throw new HttpError(409, e instanceof Error ? e.message : String(e));
  }
});
