import { NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { db } from '@/lib/supabase/server';
import { activeUser } from '@/lib/auth/server';
import { withStore } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

const SCOPES = ['listings_r', 'listings_w', 'transactions_r', 'transactions_w', 'shops_r', 'profile_r'];
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Etsy OAuth 2.0 (PKCE) bağlantısını başlatır */
export async function GET(req: Request) {
  const user = await activeUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));
  return withStore(user.storeId, async () => {
    const { data } = await db().from('marketplace_credentials').select('api_key').eq('marketplace_name', 'etsy').maybeSingle();
    if (!data?.api_key) return NextResponse.json({ error: 'Önce Etsy Keystring değerini kaydedin.' }, { status: 400 });
    const origin = process.env.APP_URL?.replace(/\/$/, '') || new URL(req.url).origin;
    const back = new URL(req.url).searchParams.get('back') === 'onboarding' ? '/onboarding' : '/settings';
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const state = b64url(randomBytes(16));
    const url = new URL('https://www.etsy.com/oauth/connect');
    url.search = new URLSearchParams({
      response_type: 'code', client_id: data.api_key, redirect_uri: `${origin}/api/auth/etsy/callback`, scope: SCOPES.join(' '),
      state, code_challenge: challenge, code_challenge_method: 'S256',
    }).toString();
    const res = NextResponse.redirect(url);
    res.cookies.set('etsy_pkce', `${verifier}.${state}.${back}`, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 600 });
    return res;
  }, user.id);
}
