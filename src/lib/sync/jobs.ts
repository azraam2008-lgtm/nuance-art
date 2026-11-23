import 'server-only';
import { rawDb } from '@/lib/supabase/server';
import { withStore } from '@/lib/tenant';
import { isMarketplace, type MarketplaceName, type OrderStatus } from '@/lib/marketplaces/meta';
import { errorMessage } from '@/lib/marketplaces/http';
import { publishProduct, pushContent, pushOrderStatus, pushStock, type ShipInfo } from './engine';
import { noteResults, type JobKind } from './job-log';

/**
 * İş kuyruğu çalışanı: zamanı gelen işleri alır ve yeniden dener.
 * Her işlem (pushStock, publishProduct…) sonucunu kendisi kuyruğa bildirir (job-log.ts):
 * başarılıysa iş kapanır, değilse bir sonraki denemeye ertelenir veya "başarısız" olur.
 * İş, ilgili ürün/ilan artık yoksa (ör. ilan kaldırıldı) sessizce kapatılır.
 */
interface JobRow {
  id: string; store_id: string; kind: JobKind; marketplace_name: string | null; ref_id: string | null;
  payload: Record<string, unknown>; dedupe_key: string; attempts: number;
}

export interface WorkerSummary { processed: number; ok: number; failed: number; stoppedEarly: boolean }

export async function processDueJobs(opts: { storeId?: string; budgetMs?: number; limit?: number } = {}): Promise<WorkerSummary> {
  const deadline = Date.now() + (opts.budgetMs ?? 40_000);
  const sum: WorkerSummary = { processed: 0, ok: 0, failed: 0, stoppedEarly: false };
  while (Date.now() < deadline && sum.processed < (opts.limit ?? 200)) {
    const { data, error } = await rawDb().rpc('claim_sync_jobs', { p_limit: 10, p_store_id: opts.storeId ?? null });
    if (error) throw new Error(`İş kuyruğu okunamadı: ${error.message}`);
    const jobs = (data ?? []) as JobRow[];
    if (!jobs.length) return sum;
    for (const job of jobs) {
      if (Date.now() > deadline) {
        // Süre doldu: alınan ama çalıştırılamayan işleri sıraya geri koy
        await rawDb().from('sync_jobs').update({ status: 'pending', locked_at: null, attempts: Math.max(0, job.attempts - 1) }).eq('id', job.id).eq('status', 'running');
        sum.stoppedEarly = true;
        continue;
      }
      sum.processed++;
      const ok = await withStore(job.store_id, () => runJob(job));
      if (ok) sum.ok++; else sum.failed++;
    }
  }
  sum.stoppedEarly = sum.stoppedEarly || Date.now() >= deadline;
  return sum;
}

async function runJob(job: JobRow): Promise<boolean> {
  const mp = job.marketplace_name;
  try {
    if (!mp || !isMarketplace(mp) || !job.ref_id) throw new Error('Geçersiz iş kaydı.');
    const only: MarketplaceName[] = [mp];
    switch (job.kind) {
      case 'push_stock': await pushStock([job.ref_id], null, only); break;
      case 'publish': await publishProduct(job.ref_id, only); break;
      case 'update_product': await pushContent(job.ref_id, only); break;
      case 'order_status': {
        const p = job.payload as { status?: OrderStatus; info?: ShipInfo };
        if (!p.status) throw new Error('Sipariş durumu eksik.');
        await pushOrderStatus(job.ref_id, p.status, p.info ?? {});
        break;
      }
    }
  } catch (e) {
    // İşlem kendi sonucunu bildiremeden hata verdi (ör. ürün silinmiş): kalıcı hata olarak işaretle
    await noteResults([{ key: job.dedupe_key, kind: job.kind, mp: (mp ?? 'trendyol') as MarketplaceName, ref: job.ref_id ?? '', ok: false, error: errorMessage(e), retryable: false }]);
    return false;
  }
  // İşlem gönderilecek bir şey bulamadıysa (ilan pasif, pazaryeri bağlantısı kapalı…) iş hâlâ "running" kalır: kapat
  const { data } = await rawDb().from('sync_jobs').update({ status: 'done', finished_at: new Date().toISOString(), locked_at: null })
    .eq('id', job.id).eq('status', 'running').select('id');
  const { data: after } = await rawDb().from('sync_jobs').select('status').eq('id', job.id).maybeSingle();
  return !!data?.length || after?.status === 'done';
}
