-- =====================================================================
--  Nuance Art — Otomatik senkron zamanlayıcısı (5 dakikada bir)
--  Panel kapalıyken de siparişleri çeker, stokları eşitler ve
--  gönderilemeyen işlemleri tekrar dener.
--
--  KURULUM: Önce schema.sql'i çalıştırın. Sonra bu dosyanın tamamını
--  Supabase → SQL Editor'e yapıştırıp Run'a basın. Tekrar çalıştırılabilir.
--  Site adresiniz farklıysa aşağıdaki SITE_ADRESI satırını değiştirin.
--  Anahtar veritabanında otomatik üretilir; Vercel'den kopyalamanız gerekmez.
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  v_site  text := 'https://nuance-art-aras25.vercel.app';   -- SITE_ADRESI
  v_token text;
begin
  insert into system_config(key, value) values ('cron_token', encode(gen_random_bytes(24), 'hex')) on conflict (key) do nothing;
  select value into v_token from system_config where key = 'cron_token';
  perform cron.unschedule(jobid) from cron.job where jobname = 'nuance-senkron';
  perform cron.schedule(
    'nuance-senkron',
    '*/5 * * * *',
    format('select net.http_get(url := %L, timeout_milliseconds := 60000)', v_site || '/api/cron/sync?token=' || v_token)
  );
end $$;

-- Kontrol: aşağıdaki sorgu "nuance-senkron" satırını göstermeli
select jobname, schedule, active from cron.job where jobname = 'nuance-senkron';

-- Son çalışmaların sonucu (birkaç dakika sonra bakın; status_code 200 olmalı):
-- select status_code, created from net._http_response order by created desc limit 5;
