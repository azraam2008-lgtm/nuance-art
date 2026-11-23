import { handle, HttpError, readJson } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { encryptSecret, maskSecret } from '@/lib/crypto';
import { isMarketplace, MARKETPLACE_META, MARKETPLACES } from '@/lib/marketplaces/meta';
import { GUIDES, hasRequiredKeys } from '@/lib/marketplaces/guides';
import { log } from '@/lib/sync/engine';
import { isDemoStore } from '@/lib/demo';

export const dynamic = 'force-dynamic';

interface Row {
  marketplace_name: string; api_key: string; api_secret: string; seller_id: string; is_active: boolean;
  extra_config: Record<string, unknown>; last_tested_at: string | null; last_test_ok: boolean | null; last_order_sync_at: string | null;
}

// API Secret asla tarayıcıya gönderilmez; yalnızca maskeli hali döner.
export const GET = handle(async () => {
  const rows = must(await db().from('marketplace_credentials').select('*')) as Row[];
  const demoMode = await isDemoStore();
  return {
    demoMode,
    encryption: Boolean(process.env.CREDENTIALS_ENCRYPTION_KEY),
    credentials: MARKETPLACES.map((name) => {
      const r = rows.find((x) => x.marketplace_name === name);
      const live = !!r?.is_active && hasRequiredKeys(name, { apiKey: r.api_key, hasSecret: !!r.api_secret, sellerId: r.seller_id });
      return {
        marketplace: name,
        apiKey: r?.api_key ?? '',
        apiSecretMasked: maskSecret(r?.api_secret ?? ''),
        hasSecret: !!r?.api_secret,
        sellerId: r?.seller_id ?? '',
        isActive: r?.is_active ?? false,
        extraConfig: r?.extra_config ?? {},
        lastTestedAt: r?.last_tested_at ?? null,
        lastTestOk: r?.last_test_ok ?? null,
        lastOrderSyncAt: r?.last_order_sync_at ?? null,
        mode: demoMode ? 'demo' : live ? 'live' : 'off',
      };
    }),
  };
});

export const PUT = handle(async (req: Request) => {
  const b = await readJson<{ marketplace?: string; apiKey?: string; apiSecret?: string; sellerId?: string; isActive?: boolean; extraConfig?: unknown }>(req);
  if (!isMarketplace(b.marketplace)) throw new HttpError(400, 'Geçersiz pazaryeri.');
  if (b.extraConfig !== undefined && (typeof b.extraConfig !== 'object' || Array.isArray(b.extraConfig) || b.extraConfig === null)) {
    throw new HttpError(400, 'Gelişmiş ayarlar geçerli bir JSON nesnesi olmalı.');
  }
  const update: Record<string, unknown> = {
    marketplace_name: b.marketplace,
    api_key: (b.apiKey ?? '').trim(),
    seller_id: (b.sellerId ?? '').trim(),
    is_active: Boolean(b.isActive),
    updated_at: new Date().toISOString(),
  };
  if (b.extraConfig !== undefined) update.extra_config = b.extraConfig;
  if (b.apiSecret) update.api_secret = encryptSecret(b.apiSecret.trim()); // boş gelirse mevcut secret korunur
  if (update.is_active) {
    const { data: cur } = await db().from('marketplace_credentials').select('api_secret').eq('marketplace_name', b.marketplace).maybeSingle();
    const ok = hasRequiredKeys(b.marketplace, { apiKey: update.api_key as string, sellerId: update.seller_id as string, hasSecret: !!(update.api_secret || cur?.api_secret) });
    if (!ok) {
      const meta = MARKETPLACE_META[b.marketplace];
      const g = GUIDES[b.marketplace];
      const need = [meta.apiKeyLabel, g.needs.secret === 'required' ? meta.apiSecretLabel : null, g.needs.seller === 'required' ? meta.sellerIdLabel : null].filter(Boolean).join(', ');
      throw new HttpError(400, `Bağlanmak için şu bilgiler gerekli: ${need}.`);
    }
  }
  must(await db().from('marketplace_credentials').upsert(update, { onConflict: 'marketplace_name' }).select('id'));
  await log('info', 'system', b.marketplace, `API ayarları güncellendi (${update.is_active ? 'bağlı' : 'bağlantı kapalı'}).`);
  return { ok: true };
});
