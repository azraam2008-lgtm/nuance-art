import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { handle, HttpError } from '@/lib/api';
import { isMarketplace } from '@/lib/marketplaces/meta';
import { log, pollOrders } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Pazaryeri webhook alıcısı: /api/webhooks/trendyol?token=WEBHOOK_SECRET
 * Doğrulama: ?token=, "x-webhook-token" başlığı veya Basic Auth parolası WEBHOOK_SECRET olmalı.
 * Strateji: Webhook "tetikleyici", API "gerçek kaynak". Gövde ayrıştırılmaz; ilgili pazaryerinden
 * son siparişler hemen çekilir. Böylece payload format değişikliklerinden etkilenmez ve
 * apply_order idempotent olduğu için aynı sipariş iki kez stok düşmez.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ marketplace: string }> }) => {
  const { marketplace } = await ctx.params;
  if (!isMarketplace(marketplace)) throw new HttpError(404, 'Bilinmeyen pazaryeri.');

  const secret = process.env.WEBHOOK_SECRET ?? '';
  const url = new URL(req.url);
  const auth = req.headers.get('authorization') ?? '';
  const basicPass = auth.startsWith('Basic ') ? Buffer.from(auth.slice(6), 'base64').toString().split(':').slice(1).join(':') : '';
  const provided = url.searchParams.get('token') ?? req.headers.get('x-webhook-token') ?? basicPass;
  if (!secret || !provided || !safeEq(provided, secret)) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 401 });
  }

  const body = await req.text();
  await log('info', 'order', marketplace, `Webhook alındı (${body.length} bayt) — siparişler çekiliyor.`);
  const summary = await pollOrders([marketplace]);
  return { received: true, summary };
});
