import { NextResponse } from 'next/server';
import { handlePublic } from '@/lib/api';
import { rawDb } from '@/lib/supabase/server';
import { withStore } from '@/lib/tenant';
import { pollOrders, reconcile } from '@/lib/sync/engine';
import { refreshFx } from '@/lib/fees/service';
import { errorMessage } from '@/lib/marketplaces/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Zamanlanmış senkron — pazaryeri bağlı olan HER mağaza için sırayla:
 * (1) yeni/değişen siparişleri çek, (2) onay bekleyen ilanları kontrol et, (3) sapan stokları yeniden gönder.
 * Vercel Cron "Authorization: Bearer $CRON_SECRET" başlığı ile, cron-job.org ise ?token=CRON_SECRET ile çağırır.
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  const token = new URL(req.url).searchParams.get('token');
  if (!secret || (auth !== `Bearer ${secret}` && token !== secret)) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 401 });
  }
  const { data, error } = await rawDb().from('marketplace_credentials').select('store_id').eq('is_active', true);
  if (error) throw new Error(error.message);
  const stores = [...new Set((data ?? []).map((r) => r.store_id as string))];
  const results: Record<string, unknown> = {};
  for (const sid of stores) {
    results[sid] = await withStore(sid, async () => {
      try {
        const fx = await refreshFx();
        const orders = await pollOrders();
        const reconciliation = await reconcile();
        return { fx: !!fx, orders, reconciliation };
      } catch (e) {
        return { error: errorMessage(e) };
      }
    });
  }
  return { stores: stores.length, results, at: new Date().toISOString() };
}

export const GET = handlePublic(run);
export const POST = handlePublic(run);
