import { handle, HttpError, readJson, requireNumber } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { log, pushStock } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Manuel stok girişi (+) veya düzeltme (+/-), ardından tüm pazaryerlerine gönderim
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const b = await readJson<{ change?: unknown; reason?: string }>(req);
  const change = requireNumber(b.change, 'Miktar', { min: -1_000_000, int: true });
  if (change === 0) throw new HttpError(400, 'Miktar 0 olamaz.');
  const reason = b.reason === 'manual_adjust' ? 'manual_adjust' : 'restock';
  const newStock = must(await db().rpc('adjust_stock', { p_product_id: id, p_change: change, p_reason: reason })) as number;
  const p = must(await db().from('products').select('sku').eq('id', id).single()) as { sku: string };
  await log('info', 'stock', null, `${p.sku}: ${reason === 'restock' ? 'stok girişi' : 'stok düzeltme'} ${change > 0 ? '+' : ''}${change} → ${newStock}`);
  const sync = await pushStock([id], null);
  return { totalStock: newStock, sync };
});
