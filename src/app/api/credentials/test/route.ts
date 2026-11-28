import { handle, HttpError, readJson } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { decryptSecret } from '@/lib/crypto';
import { MARKETPLACE_META, baseOf, isMarketplace, isSecondAccount, type MarketplaceName } from '@/lib/marketplaces/meta';
import { createAdapter } from '@/lib/marketplaces/registry';
import { hasRequiredKeys } from '@/lib/marketplaces/guides';

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
  if (!hasRequiredKeys(b.marketplace, { apiKey, apiSecret, sellerId })) throw new HttpError(400, 'Test için gerekli bilgileri girin.');

  // Aynı pazaryerinin diğer mağazasının (ör. Trendyol ↔ Trendyol 2) anahtarı yanlışlıkla girilmiş mi?
  const twin = isSecondAccount(b.marketplace) ? baseOf(b.marketplace) : `${b.marketplace}_2`;
  const { data: other } = await db().from('marketplace_credentials').select('api_key, seller_id').eq('marketplace_name', twin).maybeSingle();
  if (other?.api_key && other.api_key.trim() === apiKey) {
    return { ok: false, message: `Bu API Key ${MARKETPLACE_META[twin as MarketplaceName].label} kartında zaten kayıtlı. Her mağazanın kendi Satıcı ID, API Key ve API Secret bilgisi vardır: diğer mağazanın ${MARKETPLACE_META[baseOf(b.marketplace)].label} paneline girip onun API bilgilerini kopyalayın.`, mode: 'live' };
  }

  const adapter = createAdapter(b.marketplace, { apiKey, apiSecret, sellerId, extra: b.extraConfig ?? stored?.extra_config ?? {} }, true);
  if (!adapter) throw new HttpError(400, 'Gerekli bilgiler eksik.');
  const result = await adapter.testConnection();
  await db().from('marketplace_credentials').update({ last_tested_at: new Date().toISOString(), last_test_ok: result.ok }).eq('marketplace_name', b.marketplace);
  return { ...result, mode: adapter.mode };
});
