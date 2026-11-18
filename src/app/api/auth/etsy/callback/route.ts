import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/supabase/server';
import { currentUser } from '@/lib/auth/server';
import { log } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';

/** Etsy OAuth dönüşü: kodu jetona çevirir, mağaza ID'sini bulur, bağlantıyı etkinleştirir */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const [verifier, state, back = '/settings'] = (jar.get('etsy_pkce')?.value ?? '').split('.');
  const fail = (msg: string) => NextResponse.redirect(new URL(`${back}?etsy=error&msg=${encodeURIComponent(msg)}`, req.url));
  if (!(await currentUser())) return NextResponse.redirect(new URL('/login', req.url));
  if (!verifier || url.searchParams.get('state') !== state) return fail('Güvenlik doğrulaması başarısız (state). Tekrar deneyin.');
  const code = url.searchParams.get('code');
  if (!code) return fail(url.searchParams.get('error_description') ?? 'Etsy izni verilmedi.');
  const { data: cred } = await db().from('marketplace_credentials').select('api_key, api_secret, extra_config').eq('marketplace_name', 'etsy').maybeSingle();
  if (!cred?.api_key) return fail('Etsy anahtarı bulunamadı.');
  const origin = process.env.APP_URL?.replace(/\/$/, '') || url.origin;
  try {
    const tokRes = await fetch('https://api.etsy.com/v3/public/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: cred.api_key, redirect_uri: `${origin}/api/auth/etsy/callback`, code, code_verifier: verifier }),
    });
    const tok = (await tokRes.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
    if (!tok.access_token) return fail(tok.error_description ?? 'Jeton alınamadı.');
    const userId = tok.access_token.split('.')[0];
    const { decryptSecret } = await import('@/lib/crypto');
    const secret = cred.api_secret ? decryptSecret(cred.api_secret) : '';
    const shopsRes = await fetch(`https://openapi.etsy.com/v3/application/users/${userId}/shops`, {
      headers: { 'x-api-key': secret ? `${cred.api_key}:${secret}` : cred.api_key, Authorization: `Bearer ${tok.access_token}` },
    });
    const shop = (await shopsRes.json()) as { shop_id?: number; shop_name?: string; currency_code?: string };
    const extra = { ...(cred.extra_config ?? {}), accessToken: tok.access_token, refreshToken: tok.refresh_token, accessTokenExpiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000, shopCurrency: shop.currency_code ?? (cred.extra_config as Record<string, unknown>)?.shopCurrency ?? 'USD' };
    await db().from('marketplace_credentials').update({ extra_config: extra, seller_id: shop.shop_id ? String(shop.shop_id) : undefined, is_active: true, last_tested_at: new Date().toISOString(), last_test_ok: true }).eq('marketplace_name', 'etsy');
    await log('success', 'system', 'etsy', `Etsy bağlandı: ${shop.shop_name ?? 'mağaza'} (#${shop.shop_id ?? '-'})`);
    const res = NextResponse.redirect(new URL(`${back}?etsy=ok`, req.url));
    res.cookies.set('etsy_pkce', '', { path: '/', maxAge: 0 });
    return res;
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
