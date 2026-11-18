// İmzalı oturum çerezi — Web Crypto kullanır (hem Edge middleware hem Node'da çalışır)

export const SESSION_COOKIE = 'na_session';
export const SESSION_DAYS = 14;

export interface SessionPayload {
  uid: string;
  email: string;
  name: string;
  exp: number; // ms
}

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error('SESSION_SECRET tanımlı değil.');
  return s;
}

async function hmac(data: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function signSession(p: Omit<SessionPayload, 'exp'>, secret = sessionSecret()): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ ...p, exp: Date.now() + SESSION_DAYS * 86_400_000 })));
  return `${body}.${await hmac(body, secret)}`;
}

export async function verifySession(token: string | undefined | null, secret = sessionSecret()): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = await hmac(body, secret);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body))) as SessionPayload;
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}
