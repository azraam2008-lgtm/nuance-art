import { handle, HttpError, readJson } from '@/lib/api';
import { isMarketplace, type MarketplaceName } from '@/lib/marketplaces/meta';
import { publishProduct } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Mevcut ürünü ek pazaryerlerinde yayınla / hatalı ilanı yeniden dene
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const b = await readJson<{ marketplaces?: unknown[] }>(req);
  const marketplaces = (b.marketplaces ?? []).filter(isMarketplace) as MarketplaceName[];
  if (!marketplaces.length) throw new HttpError(400, 'En az bir pazaryeri seçin.');
  return { results: await publishProduct(id, marketplaces) };
});
