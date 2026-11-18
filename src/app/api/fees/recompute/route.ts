import { handle, readJson } from '@/lib/api';
import { recomputeAll } from '@/lib/fees/service';
import { log } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Kural veya tarife değiştikten sonra tüm siparişlerin kârlılığını yeniden hesaplar
export const POST = handle(async (req: Request) => {
  const b = await readJson<{ marketplace?: string; since?: string }>(req).catch(() => ({} as { marketplace?: string; since?: string }));
  const count = await recomputeAll(b);
  await log('success', 'system', null, `${count} siparişin kârlılığı yeniden hesaplandı.`);
  return { count };
});
