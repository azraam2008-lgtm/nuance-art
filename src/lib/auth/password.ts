import 'server-only';
import { randomBytes, scrypt, timingSafeEqual } from 'crypto';

const N = 16384, r = 8, p = 1, KEYLEN = 64;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((res, rej) => scrypt(password, salt, KEYLEN, { N, r, p }, (e, k) => (e ? rej(e) : res(k))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, , salt, key] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const k = await derive(password, Buffer.from(salt, 'base64'));
  const expected = Buffer.from(key, 'base64');
  return expected.length === k.length && timingSafeEqual(expected, k);
}

export function validatePassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 8) throw new Error('Şifre en az 8 karakter olmalı.');
  if (pw.length > 200) throw new Error('Şifre çok uzun.');
  return pw;
}
