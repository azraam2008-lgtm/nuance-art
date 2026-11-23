import { handle } from '@/lib/api';
import { db } from '@/lib/supabase/server';
import { currentStoreId } from '@/lib/tenant';
import { pollOrders, reconcile } from '@/lib/sync/engine';
import { processDueJobs } from '@/lib/sync/jobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const running = new Set<string>();

/**
 * Panel açıkken tarayıcı birkaç dakikada bir bunu çağırır (oturum gerekli):
 * yeni siparişleri çeker, onay bekleyen ilanları kontrol eder, sapan stokları yeniden gönderir.
 * Son çalışmadan 2 dakika geçmediyse hiçbir şey yapmaz — çok sekme açık olsa da pazaryerleri yorulmaz.
 */
export const POST = handle(async () => {
  const { data } = await db().from('app_settings').select('value').eq('key', 'last_auto_sync').maybeSingle();
  const last = Date.parse((data?.value as { at?: string } | null)?.at ?? '') || 0;
  const sid = currentStoreId();
  if (running.has(sid) || Date.now() - last < 120_000) return { skipped: true };
  running.add(sid);
  try {
    const at = new Date().toISOString();
    await db().from('app_settings').upsert({ key: 'last_auto_sync', value: { at } });
    const jobs = await processDueJobs({ storeId: sid, budgetMs: 15_000, limit: 50 });
    const orders = await pollOrders();
    const reconciliation = await reconcile();
    return { skipped: false, jobs, orders, reconciliation, at };
  } finally {
    running.delete(sid);
  }
});
