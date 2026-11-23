import { randomUUID } from 'crypto';
import { handle, HttpError } from '@/lib/api';
import { db } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BUCKET = 'product-images';
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX = 10 * 1024 * 1024;

/**
 * Ürün fotoğrafı yükleme (multipart, alan adı "files", birden fazla).
 * Fotoğraflar Supabase Storage'daki herkese açık "product-images" kovasına yazılır;
 * pazaryerleri görseli bu adresten indirir. Sıra, istemcinin gönderdiği sıradır.
 */
export const POST = handle(async (req: Request) => {
  let form: FormData;
  try { form = await req.formData(); } catch { throw new HttpError(400, 'Dosya bulunamadı.'); }
  const files = form.getAll('files').filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f);
  if (!files.length) throw new HttpError(400, 'Dosya seçilmedi.');
  if (files.length > 10) throw new HttpError(400, 'Tek seferde en fazla 10 fotoğraf yüklenebilir.');
  const now = new Date();
  const out: Array<{ url: string; path: string; name: string; size: number }> = [];
  for (const f of files) {
    const ext = TYPES[f.type];
    if (!ext) throw new HttpError(400, `${f.name}: yalnızca JPG, PNG veya WEBP yüklenebilir.`);
    if (f.size > MAX) throw new HttpError(400, `${f.name}: dosya 10 MB'tan büyük.`);
    const path = `${db().storeId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`;
    const { error } = await db().storage.from(BUCKET).upload(path, Buffer.from(await f.arrayBuffer()), { contentType: f.type, upsert: false, cacheControl: '31536000' });
    if (error) throw new Error(`Fotoğraf yüklenemedi (${f.name}): ${error.message}. Supabase'de "product-images" kovasının olduğundan emin olun (schema.sql).`);
    out.push({ url: db().storage.from(BUCKET).getPublicUrl(path).data.publicUrl, path, name: f.name, size: f.size });
  }
  return { files: out };
});
