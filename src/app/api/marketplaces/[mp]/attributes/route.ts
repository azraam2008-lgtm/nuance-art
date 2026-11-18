import { handle, HttpError } from '@/lib/api';
import { isMarketplace } from '@/lib/marketplaces/meta';
import { getAdapter } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';

// Kategorinin ürün özellikleri (zorunlu olanlar işaretli) — Trendyol onayı için gerekli
export const GET = handle(async (req: Request, ctx: { params: Promise<{ mp: string }> }) => {
  const { mp } = await ctx.params;
  if (!isMarketplace(mp)) throw new HttpError(404, 'Bilinmeyen pazaryeri.');
  const id = Number(new URL(req.url).searchParams.get('categoryId'));
  if (!id) throw new HttpError(400, 'categoryId gerekli.');
  const a = await getAdapter(mp).catch((e: Error) => { throw new HttpError(409, e.message); });
  if (!a.categoryAttributes) return { supported: false, items: [] };
  return { supported: true, items: await a.categoryAttributes(id) };
});
