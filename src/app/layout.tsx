import { BRAND } from '@/lib/brand';
import type { Metadata } from 'next';
import './globals.css';
import Shell from '@/components/Shell';

export const metadata: Metadata = {
  title: `${BRAND.name} — ${BRAND.short}`,
  description: 'Trendyol, Hepsiburada, N11 ve Çiçeksepeti için tek merkezden ürün, stok ve sipariş yönetimi',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="app-bg text-slate-800 antialiased">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
