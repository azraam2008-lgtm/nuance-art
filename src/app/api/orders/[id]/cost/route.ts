import { handle, HttpError } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { recompute } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';

// Sipariş maliyet dökümü (komisyon, bedeller, kargo, stopaj, KDV, net kâr)
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const order = must(await db().from('orders').select('id, external_order_id, marketplace_name, customer_name, status, order_date, shipped_at, carrier, desi, currency, fx_rate, items:order_items(sku, product_title, quantity, unit_price)').eq('id', id).maybeSingle());
  if (!order) throw new HttpError(404, 'Sipariş bulunamadı.');
  let cost = must(await db().from('order_costs').select('*').eq('order_id', id).maybeSingle());
  if (!cost) {
    await recompute([id]);
    cost = must(await db().from('order_costs').select('*').eq('order_id', id).maybeSingle());
  }
  return { order, cost };
});

// Tek siparişi yeniden hesapla
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await recompute([id]);
  return must(await db().from('order_costs').select('*').eq('order_id', id).maybeSingle());
});
