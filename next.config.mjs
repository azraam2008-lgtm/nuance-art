// Supabase adresi ve herkese açık anahtar hangi adla girilmiş olursa olsun bulunur
// (Vercel'de NEXT_PUBLIC_ öneki unutulsa da çalışsın diye).
const pick = (...names) => {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return '';
};

// Supabase adresi yanlış biçimde girilmişse düzeltilir:
//  https://xxx.supabase.co/rest/v1/  → https://xxx.supabase.co
//  https://supabase.com/dashboard/project/xxx → https://xxx.supabase.co
const cleanUrl = (raw) => {
  let v = (raw || '').trim().replace(/^["']|["']$/g, '');
  if (!v) return '';
  const dash = v.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (dash) return `https://${dash[1]}.supabase.co`;
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try { return new URL(v).origin; } catch { return v; }
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: cleanUrl(pick('NEXT_PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_URL', 'SUPABASE_URL')),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: pick('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY'),
  },
};
export default nextConfig;
