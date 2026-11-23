import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { handlePublic } from '@/lib/api';
import { db, rawDb } from '@/lib/supabase/server';
import { withStore } from '@/lib/tenant';
import { pollOrders, reconcile } from '@/lib/sync/engine';
import { processDueJobs } from '@/lib/sync/jobs';
import { refreshFx } from '@/lib/fees/service';
import { errorMessage } from '@/lib/marketplaces/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Zamanlayıcı anahtarı: Vercel'deki CRON_SECRET veya veritabanında üretilen anahtar (system_config.cron_token) */
async function authorized(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') ?? '';
  const given = new URL(req.url).searchParams.get('token') ?? (auth.startsWith('Bearer ') ? auth.slice(7) : '');
  if (!given) return false;
  const secret = process.env.CRON_SECRET;
  if (secret && safeEq(given, secret)) return true;
  const { data } = await rawDb().from('system_config').select('value').eq('key', 'cron_token').maybeSingle();
  return !!data?.value && safeEq(given, data.value);
}

/**
 * Zamanlanmış senkron (Supabase zamanlayıcısı 5 dakikada bir, Vercel Cron günde bir çağırır):
 *  1) İş kuyruğu: gönderilemeyen stok / ürün / sipariş durumu işlerini tekrar dener.
 *  2) Pazaryeri bağlı mağazalar, en uzun süredir senkronlanmayandan başlayarak:
 *     yeni/değişen siparişleri çeker (stok düşer ve diğer pazaryerlerine gider), onay bekleyen ilanları ve sapan stokları kontrol eder.
 * Süre sınırına yaklaşınca durur; kalan mağazalar bir sonraki çalışmada önce alınır.
 */
async function run(req: Request) {
  if (!(await authorized(req))) return NextResponse.json({ error: 'Yetkisiz' }, { status: 401 });
  const started = Date.now();
  const deadline = started + 50_000;

  const jobs = await processDueJobs({ budgetMs: 20_000 }).catch((e) => ({ error: errorMessage(e) }));

  const { data, error } = await rawDb().from('marketplace_credentials').select('store_id, last_order_sync_at').eq('is_active', true);
  if (error) throw new Error(error.message);
  const oldest = new Map<string, number>();
  for (const r of data ?? []) {
    const t = r.last_order_sync_at ? Date.parse(r.last_order_sync_at) : 0;
    oldest.set(r.store_id, Math.min(oldest.get(r.store_id) ?? Infinity, t));
  }
  const stores = [...oldest.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);

  const results: Record<string, unknown> = {};
  let skipped = 0;
  for (const sid of stores) {
    if (Date.now() > deadline - 8_000) { skipped++; continue; }
    results[sid] = await withStore(sid, async () => {
      try {
        // Döviz kuru 6 saatte bir yeter
        const { data: fx } = await db().from('app_settings').select('value').eq('key', 'fx').maybeSingle();
        if (Date.now() - (Date.parse((fx?.value as { updatedAt?: string } | null)?.updatedAt ?? '') || 0) > 6 * 3600_000) await refreshFx();
        const orders = await pollOrders();
        const reconciliation = await reconcile();
        return { orders, reconciliation };
      } catch (e) {
        return { error: errorMessage(e) };
      }
    });
  }
  return { jobs, stores: stores.length, skipped, results, ms: Date.now() - started, at: new Date().toISOString() };
}

export const GET = handlePublic(run);
export const POST = handlePublic(run);
