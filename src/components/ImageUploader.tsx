'use client';
import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, ImagePlus, Images, Loader2, Star, Trash2 } from 'lucide-react';
import { useToast } from './live';
import { cx } from './ui';

const MAX_IMAGES = 8; // Trendyol ürün başına en fazla 8 görsel kabul eder
const MAX_SIDE = 2400;

const OK_TYPES = /^image\/(jpeg|png|webp)$/;

/**
 * Çok büyük fotoğrafları tarayıcıda küçültür (pazaryerleri 5 MB üstünü reddedebilir).
 * Telefon galerisinden gelen HEIC vb. biçimler de (tarayıcı açabiliyorsa) JPG'ye çevrilir.
 */
async function prepare(file: File): Promise<{ file: File; width: number; height: number }> {
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { throw new Error(`${file.name}: bu fotoğraf biçimi açılamadı. Telefonunuzda fotoğrafı JPG olarak kaydedip tekrar deneyin.`); }
  const { width, height } = bmp;
  if (OK_TYPES.test(file.type) && Math.max(width, height) <= MAX_SIDE && file.size <= 5 * 1024 * 1024) { bmp.close(); return { file, width, height }; }
  const k = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * k); canvas.height = Math.round(height * k);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Görsel işlenemedi'))), 'image/jpeg', 0.9));
  return { file: new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }), width: canvas.width, height: canvas.height };
}

/**
 * Fotoğraf yükleme: galeriden/bilgisayardan seç, telefon kamerasıyla çek veya sürükle-bırak. Fotoğraflar seçildiği sırayla yüklenir;
 * sürükleyerek veya oklarla sıralanır. İlk fotoğraf kapak görselidir ve tüm pazaryerlerine bu sırayla gönderilir.
 */
export default function ImageUploader({ images, onChange }: { images: string[]; onChange: (urls: string[]) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [over, setOver] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const [warn, setWarn] = useState<string[]>([]);

  async function add(files: FileList | File[]) {
    const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    if (!list.length) { toast('Lütfen fotoğraf dosyası seçin.', 'err'); return; }
    const room = MAX_IMAGES - images.length;
    if (room <= 0) { toast(`En fazla ${MAX_IMAGES} fotoğraf eklenebilir.`, 'warn'); return; }
    const chosen = list.slice(0, room);
    if (list.length > room) toast(`İlk ${room} fotoğraf eklendi (sınır ${MAX_IMAGES}).`, 'warn');
    setUploading(chosen.length);
    const w: string[] = [];
    try {
      const fd = new FormData();
      for (const f of chosen) {
        const p = await prepare(f);
        if (Math.min(p.width, p.height) < 600) w.push(`${f.name}: ${p.width}×${p.height} px — pazaryerleri en az 600 px (Trendyol için önerilen 1200×1800) ister.`);
        fd.append('files', p.file);
      }
      const r = await fetch('/api/uploads', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Yükleme başarısız');
      onChange([...images, ...(d.files as Array<{ url: string }>).map((x) => x.url)]);
      setWarn(w);
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setUploading(0);
      if (input.current) input.current.value = '';
      if (camera.current) camera.current.value = '';
    }
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= images.length || from === to) return;
    const n = [...images];
    const [x] = n.splice(from, 1);
    n.splice(to, 0, x);
    onChange(n);
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); if (drag === null) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (drag === null && e.dataTransfer.files.length) add(e.dataTransfer.files); }}
        className={cx('border-2 border-dashed rounded-xl p-6 text-center transition', over ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-slate-50')}>
        <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files && add(e.target.files)} />
        <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files && add(e.target.files)} />
        {uploading ? (
          <div className="flex items-center justify-center gap-2 text-slate-600 py-4"><Loader2 className="w-5 h-5 animate-spin" /> {uploading} fotoğraf yükleniyor…</div>
        ) : (
          <>
            <ImagePlus className="w-8 h-8 mx-auto text-slate-400" />
            <div className="mt-2 font-medium">Ürün fotoğraflarınızı ekleyin</div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => input.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700">
                <Images className="w-4 h-4" /> Galeriden / bilgisayardan seç
              </button>
              <button type="button" onClick={() => camera.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-50">
                <Camera className="w-4 h-4" /> Kamerayla çek
              </button>
            </div>
            <div className="text-xs text-slate-500 mt-3">Birden fazla fotoğrafı aynı anda seçebilir veya buraya sürükleyip bırakabilirsiniz · en fazla {MAX_IMAGES} fotoğraf · önerilen 1200×1800 px, beyaz arka plan · {images.length}/{MAX_IMAGES}</div>
          </>
        )}
      </div>
      {warn.length > 0 && <ul className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2 space-y-0.5">{warn.map((w, i) => <li key={i}>⚠ {w}</li>)}</ul>}
      {images.length > 0 && (
        <>
          <p className="text-xs text-slate-500">Sıralamak için sürükleyin veya oklara dokunun. <b>1. fotoğraf kapak görselidir</b>; fotoğraflar tüm pazaryerlerine bu sırayla gönderilir.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {images.map((url, i) => (
              <div key={url} draggable
                onDragStart={() => setDrag(i)} onDragEnd={() => setDrag(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (drag !== null) move(drag, i); setDrag(null); }}
                className={cx('relative group rounded-xl overflow-hidden border-2 bg-white aspect-[2/3]', i === 0 ? 'border-amber-400' : 'border-slate-200', drag === i && 'opacity-40')}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Fotoğraf ${i + 1}`} className="w-full h-full object-cover" />
                <span className={cx('absolute top-1.5 left-1.5 text-[11px] font-bold rounded-md px-1.5 py-0.5', i === 0 ? 'bg-amber-400 text-slate-900' : 'bg-white/90 text-slate-700')}>
                  {i === 0 ? <span className="inline-flex items-center gap-0.5"><Star className="w-3 h-3" /> Kapak</span> : i + 1}
                </span>
                <div className="absolute bottom-0 inset-x-0 flex justify-between p-1.5 bg-gradient-to-t from-black/60 to-transparent opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition">
                  <button type="button" title="Sola al" onClick={() => move(i, i - 1)} className="p-1 rounded bg-white/90 disabled:opacity-30" disabled={i === 0}><ArrowLeft className="w-3.5 h-3.5" /></button>
                  <button type="button" title="Kaldır" onClick={() => onChange(images.filter((_, j) => j !== i))} className="p-1 rounded bg-white/90 text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>
                  <button type="button" title="Sağa al" onClick={() => move(i, i + 1)} className="p-1 rounded bg-white/90 disabled:opacity-30" disabled={i === images.length - 1}><ArrowRight className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
