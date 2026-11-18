import { NextResponse } from 'next/server';
import { handle } from '@/lib/api';
import { pollOrders, reconcile } from '@/lib/sync/engine';
import { refreshFx } from '@/lib/fees/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Zamanlanmış senkron: (1) tüm canlı pazaryerlerinden yeni/değişen siparişleri çek,
 * (2) onay bekleyen ilanları kontrol et, (3) gönderilemeyen veya sapan stokları yeniden gönder.
 * Vercel Cron "Authorization: Bearer $CRON_SECRET" başlığı ile çağırır.
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  const token = new URL(req.url).searchParams.get('token');
  if (!secret || (auth !== `Bearer ${secret}` && token !== secret)) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 401 });
  }
  const fx = await refreshFx();
  const orders = await pollOrders();
  const reconciliation = await reconcile();
  return { fx, orders, reconciliation, at: new Date().toISOString() };
}

export const GET = handle(run);
export const POST = handle(run);
