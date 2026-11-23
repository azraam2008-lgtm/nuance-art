import 'server-only';
import nodemailer from 'nodemailer';

/**
 * E-posta gönderimi (Gmail).
 * Vercel ortam değişkenleri:
 *   GMAIL_USER          → gönderen Gmail adresi
 *   GMAIL_APP_PASSWORD  → Google Hesabı > Güvenlik > Uygulama şifreleri'nden alınan 16 haneli şifre
 * (İsteğe bağlı: SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS ile başka bir sunucu da kullanılabilir.)
 */
export function mailConfigured(): boolean {
  return !!((process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) || (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS));
}

function transport() {
  if (process.env.SMTP_HOST) {
    const port = Number(process.env.SMTP_PORT || 465);
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: (process.env.GMAIL_APP_PASSWORD ?? '').replace(/\s+/g, '') },
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export async function sendMail(to: string, subject: string, text: string, html?: string) {
  if (!mailConfigured()) throw new Error('E-posta gönderimi ayarlanmamış (GMAIL_USER ve GMAIL_APP_PASSWORD).');
  const from = process.env.MAIL_FROM || `Nuance Art Panel <${process.env.GMAIL_USER || process.env.SMTP_USER}>`;
  await transport().sendMail({ from, to, subject, text, html });
}

export async function sendResetMail(to: string, name: string, link: string) {
  const text = `Merhaba ${name || ''},

Nuance Art panelinde şifrenizi sıfırlamak için bir istek aldık.
Yeni şifre oluşturmak için bu bağlantıya tıklayın (1 saat geçerlidir, tek kullanımlıktır):

${link}

Bu isteği siz yapmadıysanız bu e-postayı yok sayın; şifreniz değişmez.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#0f172a">
<h2 style="color:#4f46e5">Şifre sıfırlama</h2>
<p>Merhaba ${esc(name || '')},</p>
<p>Nuance Art panelinde şifrenizi sıfırlamak için bir istek aldık. Yeni şifre oluşturmak için butona tıklayın:</p>
<p style="text-align:center;margin:28px 0"><a href="${esc(link)}" style="background:#4f46e5;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Yeni şifre oluştur</a></p>
<p style="font-size:13px;color:#475569">Bağlantı 1 saat geçerlidir ve yalnızca bir kez kullanılabilir.<br>Bu isteği siz yapmadıysanız bu e-postayı yok sayın; şifreniz değişmez.</p>
</div>`;
  await sendMail(to, 'Nuance Art — şifre sıfırlama', text, html);
}

export async function sendPasswordChangedMail(to: string, name: string) {
  await sendMail(to, 'Nuance Art — şifreniz değiştirildi',
    `Merhaba ${name || ''},\n\nNuance Art panelindeki şifreniz az önce değiştirildi ve diğer cihazlardaki oturumlar kapatıldı.\nBu değişikliği siz yapmadıysanız hemen "Şifremi unuttum" ile yeni şifre oluşturun.`);
}
