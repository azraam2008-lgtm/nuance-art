import 'server-only';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'crypto';

// scrypt parametreleri. N=65536 (~64 MB bellek) kaba kuvvet denemelerini pahalılaştırır.
// Eski (N=16384) şifreler doğrulanmaya devam eder ve ilk girişte yeni parametreyle yeniden kaydedilir.
const N = 65536, r = 8, p = 1, KEYLEN = 64;

function derive(password: string, salt: Buffer, n = N): Promise<Buffer> {
  return new Promise((res, rej) =>
    scrypt(password, salt, KEYLEN, { N: n, r, p, maxmem: 256 * n * r + 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, salt, key] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const cost = Number(n) || 16384;
  if (cost < 1024 || cost > 1 << 20) return false;
  const k = await derive(password, Buffer.from(salt, 'base64'), cost);
  const expected = Buffer.from(key, 'base64');
  return expected.length === k.length && timingSafeEqual(expected, k);
}

/** Şifre eski (daha zayıf) parametrelerle mi kaydedilmiş? */
export function needsRehash(stored: string): boolean {
  return Number(stored.split('$')[1]) < N;
}

const DUMMY = 'scrypt$65536$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==';
/** Kullanıcı bulunamadığında da aynı süreyi harcar (e-posta tahminini zorlaştırır) */
export async function fakeVerify(password: string) {
  await verifyPassword(password, DUMMY).catch(() => false);
}

/** En sık kullanılan şifreler (Türkçe ve genel) — bunlar kabul edilmez */
const COMMON = new Set([
  '123456789', '1234567890', '12345678910', 'qwertyuiop', 'qwerty123', 'password', 'password1', 'password123', 'sifre123',
  'şifre123', 'parola123', '1q2w3e4r5t', '1qaz2wsx3edc', 'asdfghjkl', 'iloveyou', 'galatasaray', 'fenerbahce', 'besiktas',
  'trabzonspor', 'istanbul', 'ankara', 'türkiye', 'turkiye', 'abc123456', 'a123456789', 'qwe123456', '11111111', '00000000',
  'aaaaaaaa', '12341234', 'admin123', 'welcome1', 'nuanceart', 'trendyol', 'hepsiburada',
]);

/**
 * Yeni şifre kuralları: en az 10 karakter, en az bir harf ve bir rakam,
 * çok bilinen şifrelerden olmamalı, e-posta adresini içermemeli.
 */
export function validatePassword(pw: unknown, email?: string): string {
  if (typeof pw !== 'string' || pw.length < 10) throw new Error('Şifre en az 10 karakter olmalı.');
  if (pw.length > 200) throw new Error('Şifre çok uzun.');
  if (!/\p{L}/u.test(pw) || !/\d/.test(pw)) throw new Error('Şifrede en az bir harf ve bir rakam olmalı.');
  const lower = pw.toLocaleLowerCase('tr');
  if (COMMON.has(lower) || /^(.)\1+$/.test(pw)) throw new Error('Bu şifre çok yaygın; tahmin edilmesi kolay. Başka bir şifre seçin.');
  const local = email?.split('@')[0]?.toLocaleLowerCase('tr');
  if (local && local.length >= 4 && lower.includes(local)) throw new Error('Şifre e-posta adresinizi içermemeli.');
  return pw;
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 200;

/** Sıfırlama bağlantısı jetonunun veritabanında saklanan özeti */
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
