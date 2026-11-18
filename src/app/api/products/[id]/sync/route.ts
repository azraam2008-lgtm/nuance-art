import { handle } from '@/lib/api';
import { pushStock, reconcile } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Ürünün güncel fiyat ve stoğunu tüm bağlı pazaryerlerine hemen gönderir (onay bekleyen ilanları da kontrol eder)
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const r = await reconcile().catch(() => null);
  return { stock: await pushStock([id], null), reconcile: r };
});
