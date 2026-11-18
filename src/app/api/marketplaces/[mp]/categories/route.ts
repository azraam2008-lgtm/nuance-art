import { handle, HttpError } from '@/lib/api';
import { isMarketplace } from '@/lib/marketplaces/meta';
import { getAdapter } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';

// Pazaryeri kategori araması (destekleyen adaptörlerde: Trendyol)
export const GET = handle(async (req: Request, ctx: { params: Promise<{ mp: string }> }) => {
  const { mp } = await ctx.params;
  if (!isMarketplace(mp)) throw new HttpError(404, 'Bilinmeyen pazaryeri.');
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  const a = await getAdapter(mp).catch((e: Error) => { throw new HttpError(409, e.message); });
  if (!a.searchCategories) return { supported: false, items: [] };
  return { supported: true, items: q.length < 2 ? [] : await a.searchCategories(q) };
});
