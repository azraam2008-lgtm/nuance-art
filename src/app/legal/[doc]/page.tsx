import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BrandMark, BrandName } from '@/components/Brand';
import { LEGAL, LEGAL_UPDATED } from '@/lib/legal-texts';

export function generateStaticParams() {
  return Object.keys(LEGAL).map((doc) => ({ doc }));
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  return { title: LEGAL[doc as keyof typeof LEGAL]?.title ?? 'Yasal' };
}

/** Kullanım şartları / gizlilik / KVKK — herkese açık */
export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const d = LEGAL[doc as keyof typeof LEGAL];
  if (!d) notFound();
  const [y, m, day] = LEGAL_UPDATED.split('-');
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/welcome" className="flex items-center gap-2"><BrandMark size={30} /><BrandName /></Link>
          <nav className="ml-auto flex gap-3 text-xs sm:text-sm text-slate-600">
            {(Object.keys(LEGAL) as Array<keyof typeof LEGAL>).map((k) => (
              <Link key={k} href={`/legal/${k}`} className={k === doc ? 'font-semibold text-slate-900' : 'hover:text-slate-900'}>{LEGAL[k].title.replace(' Aydınlatma Metni', '')}</Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold">{d.title}</h1>
        <p className="text-xs text-slate-500 mt-1">Son güncelleme: {day}.{m}.{y}</p>
        <p className="mt-4 text-sm text-slate-700 leading-relaxed">{d.intro}</p>
        {d.sections.map((s) => (
          <section key={s.h} className="mt-6">
            <h2 className="font-semibold">{s.h}</h2>
            {s.p.map((p, i) => <p key={i} className="mt-2 text-sm text-slate-700 leading-relaxed">{p}</p>)}
          </section>
        ))}
        <p className="mt-10 text-[11px] text-slate-400">Bu metin taslaktır; köşeli parantezli alanlar işletme bilgileriyle doldurulmalı ve bir hukukçu tarafından kontrol edilmelidir.</p>
      </main>
    </div>
  );
}
