import { handle, readJson } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { isMarketplace } from '@/lib/marketplaces/meta';
import type { ListingDefaults } from '@/lib/marketplaces/guides';

export const dynamic = 'force-dynamic';


export const GET = handle(async () => {
  const rows = must(await db().from('app_settings').select('key, value').in('key', ['company', 'listing_defaults', 'onboarding'])) as Array<{ key: string; value: unknown }>;
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  return { company: get('company'), listingDefaults: get('listing_defaults') ?? {}, onboarding: get('onboarding') };
});

/** Sihirbaz adımlarını kaydeder: şirket bilgisi, pazaryeri bazlı kargo/termin varsayılanları, tamamlandı işareti */
export const POST = handle(async (req: Request) => {
  const b = await readJson<{ company?: { name?: string; email?: string; phone?: string }; listingDefaults?: ListingDefaults; complete?: boolean }>(req);
  const now = new Date().toISOString();
  if (b.company) {
    must(await db().from('app_settings').upsert({ key: 'company', value: { name: String(b.company.name ?? '').slice(0, 120), email: String(b.company.email ?? '').slice(0, 200), phone: String(b.company.phone ?? '').slice(0, 40) }, updated_at: now }));
  }
  if (b.listingDefaults) {
    const clean = Object.fromEntries(Object.entries(b.listingDefaults).filter(([k]) => isMarketplace(k)));
    must(await db().from('app_settings').upsert({ key: 'listing_defaults', value: clean, updated_at: now }));
  }
  if (b.complete) must(await db().from('app_settings').upsert({ key: 'onboarding', value: { completedAt: now }, updated_at: now }));
  return { ok: true };
});
