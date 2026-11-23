import { handle, HttpError, readJson } from '@/lib/api';
import { isMarketplace } from '@/lib/marketplaces/meta';
import { simulateOrder } from '@/lib/sync/engine';
import { isDemoStore } from '@/lib/demo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Demo: "X pazaryerinden 1 sipariş simüle et" — gerçek sipariş akışıyla birebir aynı yol
export const POST = handle(async (req: Request) => {
  if (!(await isDemoStore())) throw new HttpError(404, 'Sipariş simülasyonu yalnızca deneme mağazasında çalışır.');
  const b = await readJson<{ marketplace?: string; productId?: string; quantity?: number }>(req);
  if (!isMarketplace(b.marketplace)) throw new HttpError(400, 'Geçersiz pazaryeri.');
  const qty = b.quantity !== undefined ? Math.trunc(Number(b.quantity)) : undefined;
  if (qty !== undefined && (!Number.isFinite(qty) || qty < 1 || qty > 1000)) throw new HttpError(400, 'Adet 1–1000 arasında olmalı.');
  try {
    return await simulateOrder(b.marketplace, b.productId || undefined, qty);
  } catch (e) {
    throw new HttpError(422, e instanceof Error ? e.message : String(e));
  }
});
