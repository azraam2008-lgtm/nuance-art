// Şifre kuralları ve eski şifrelerin yeni sürümde de açılabildiği
import assert from 'node:assert/strict';
import { scryptSync, randomBytes } from 'node:crypto';

async function main() {
  const { hashPassword, verifyPassword, needsRehash, validatePassword } = await import('../src/lib/auth/password');

  // Eski (N=16384) biçimde kaydedilmiş şifre doğrulanmalı ve yenilenmesi gerektiği anlaşılmalı
  const salt = randomBytes(16);
  const old = `scrypt$16384$${salt.toString('base64')}$${scryptSync('EskiSifre123', salt, 64, { N: 16384, r: 8, p: 1 }).toString('base64')}`;
  assert.equal(await verifyPassword('EskiSifre123', old), true, 'eski şifre açılmalı');
  assert.equal(await verifyPassword('yanlis', old), false);
  assert.equal(needsRehash(old), true);

  const fresh = await hashPassword('YeniSifre2026!');
  assert.equal(await verifyPassword('YeniSifre2026!', fresh), true);
  assert.equal(needsRehash(fresh), false);

  assert.throws(() => validatePassword('kisa1'), /10 karakter/);
  assert.throws(() => validatePassword('sadeceharfler'), /harf ve bir rakam/);
  assert.throws(() => validatePassword('1234567890'), /harf ve bir rakam/);
  assert.throws(() => validatePassword('qwerty123'), /10 karakter/);
  assert.throws(() => validatePassword('password123'), /yaygın/);
  assert.throws(() => validatePassword('elifyilmaz2026', 'elifyilmaz@gmail.com'), /e-posta/);
  assert.equal(validatePassword('Atolye-Tasarim7'), 'Atolye-Tasarim7');
  console.log('password.test.ts: tüm kontroller geçti');
}
main().catch((e) => { console.error(e); process.exit(1); });
