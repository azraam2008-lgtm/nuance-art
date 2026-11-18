import { handle, HttpError, readJson } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { decryptSecret } from '@/lib/crypto';
import { isMarketplace } from '@/lib/marketplaces/meta';
import { createAdapter } from '@/lib/marketplaces/registry';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// "Bağlantıyı Test Et": formdaki (kaydedilmemiş olabilir) veya kayıtlı bilgilerle gerçek API'ye kimlik doğrulama isteği
export const POST = handle(async (req: Request) => {
  const b = await readJson<{ marketplace?: string; apiKey?: string; apiSecret?: string; sellerId?: string; extraConfig?: Record<string, unknown> }>(req);
  if (!isMarketplace(b.marketplace)) throw new HttpError(400, 'Geçersiz pazaryeri.');
  const stored = must(await db().from('marketplace_credentials').select('*').eq('marketplace_name', b.marketplace).maybeSingle()) as
    { api_key: string; api_secret: string; seller_id: string; extra_config: Record<string, unknown> } | null;

  const apiKey = (b.apiKey ?? stored?.api_key ?? '').trim();
  const sellerId = (b.sellerId ?? stored?.seller_id ?? '').trim();
  const apiSecret = (b.apiSecret || (stored?.api_secret ? decryptSecret(stored.api_secret) : '')).trim();
  if (!apiKey || !sellerId) throw new HttpError(400, 'Test için API Key ve Satıcı ID girin.');

  const adapter = createAdapter(b.marketplace, { apiKey, apiSecret, sellerId, extra: b.extraConfig ?? stored?.extra_config ?? {} }, true);
  if (!adapter) throw new HttpError(400, 'API Key ve Satıcı ID gerekli.');
  const result = await adapter.testConnection();
  await db().from('marketplace_credentials').update({ last_tested_at: new Date().toISOString(), last_test_ok: result.ok }).eq('marketplace_name', b.marketplace);
  return { ...result, mode: adapter.mode };
});
