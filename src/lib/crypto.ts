import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// API Secret'larını veritabanında AES-256-GCM ile saklar.
// CREDENTIALS_ENCRYPTION_KEY tanımlı değilse düz metin saklanır (yalnızca lokal geliştirme için).

const PREFIX = 'enc:v1:';

function key(): Buffer | null {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) return null;
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('CREDENTIALS_ENCRYPTION_KEY base64 kodlu 32 bayt olmalıdır.');
  return buf;
}

export function encryptSecret(plain: string): string {
  const k = key();
  if (!k || !plain) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, data].map((b) => b.toString('base64')).join(':');
}

export function decryptSecret(stored: string): string {
  if (!stored || !stored.startsWith(PREFIX)) return stored;
  const k = key();
  if (!k) throw new Error('Şifreli API anahtarı var ama CREDENTIALS_ENCRYPTION_KEY tanımlı değil.');
  const [iv, tag, data] = stored.slice(PREFIX.length).split(':').map((s) => Buffer.from(s, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export const maskSecret = (s: string) => (s ? '••••••••' + (s.startsWith(PREFIX) ? '' : s.slice(-4)) : '');
