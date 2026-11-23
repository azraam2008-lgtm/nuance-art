import 'server-only';
import { db } from '@/lib/supabase/server';
import type { MarketplaceName } from '@/lib/marketplaces/meta';

/**
 * İş kuyruğu kaydı: pazaryerine yapılan her gönderimin sonucu buraya bildirilir.
 *  - Başarılıysa: aynı işin açık kaydı (önceki hata) kapatılır.
 *  - Başarısızsa: iş açılır ve zamanlayıcı artan aralıklarla tekrar dener (1, 5, 15, 60, 180, 360 dk).
 *    Tekrar denemekle düzelmeyecek hatalar (ör. eksik kategori, yanlış anahtar) hemen "başarısız" olur
 *    ve İşlem Merkezi'nde kullanıcıya gösterilir.
 */
export type JobKind = 'push_stock' | 'publish' | 'update_product' | 'order_status';

export interface JobResult {
  key: string;
  kind: JobKind;
  mp: MarketplaceName;
  ref: string;
  payload?: Record<string, unknown>;
  ok: boolean;
  error?: string;
  retryable?: boolean;
}

export const jobKey = {
  stock: (productId: string, mp: string) => `stock:${productId}:${mp}`,
  publish: (productId: string, mp: string) => `publish:${productId}:${mp}`,
  content: (productId: string, mp: string) => `content:${productId}:${mp}`,
  order: (orderId: string) => `order:${orderId}`,
};

/**
 * Hata tekrar denenince düzelebilir mi? Bağlantı hatası, zaman aşımı, 408/425/429 ve 5xx: evet.
 * 400/401/403/404/422 gibi veri veya yetki hataları: hayır (kullanıcının düzeltmesi gerekir).
 */
export function isRetryable(message: string): boolean {
  const m = message.match(/HTTP (\d{3})/);
  if (m) {
    const code = Number(m[1]);
    return code === 408 || code === 425 || code === 429 || code >= 500;
  }
  return /bağlantı hatası|zaman aşımı|timeout|fetch failed|econnreset|enotfound|socket/i.test(message);
}

export async function noteResults(items: JobResult[]) {
  if (!items.length) return;
  const payload = items.map((i) => ({
    key: i.key, kind: i.kind, mp: i.mp, ref: i.ref, payload: i.payload ?? {}, ok: i.ok,
    error: i.error ?? null, retryable: i.ok ? null : i.retryable ?? isRetryable(i.error ?? ''),
  }));
  // Kuyruk kaydı asıl işlemi asla bozmamalı: hata olursa yalnızca sunucu günlüğüne yazılır
  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await db().rpc('note_job_results', { p_items: payload.slice(i, i + 200) });
    if (error) console.error('[sync_jobs]', error.message);
  }
}
