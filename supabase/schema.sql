-- =====================================================================
--  Nuance Art — Pazaryeri Entegrasyon ve Yönetim Paneli
--  Supabase / PostgreSQL kurulum şeması
--  Supabase Dashboard > SQL Editor'e yapıştırıp tek seferde çalıştırın.
--  Tekrar çalıştırılabilir (idempotent) şekilde yazılmıştır.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 0) Pazaryerleri (yeni pazaryeri = bu tabloya 1 satır + 1 adaptör dosyası)
-- ---------------------------------------------------------------------
create table if not exists marketplaces (
  name        text primary key,
  label       text not null,
  color       text not null,
  sort_order  int  not null default 0
);

insert into marketplaces (name, label, color, sort_order) values
  ('trendyol',    'Trendyol',    '#F27A1A', 1),
  ('hepsiburada', 'Hepsiburada', '#FF6000', 2),
  ('n11',         'N11',         '#7B2CBF', 3),
  ('ciceksepeti', 'Çiçeksepeti', '#1E88E5', 4),
  ('pazarama',    'Pazarama',    '#0FA0DC', 5),
  ('idefix',      'idefix',      '#FFB300', 6),
  ('koctas',      'Koçtaş',      '#D7141E', 7),
  ('etsy',        'Etsy',        '#F1641E', 8)
on conflict (name) do update set label = excluded.label, color = excluded.color, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------
-- 1) Ürünler (ortak stok havuzu: total_stock tek gerçek kaynaktır)
-- ---------------------------------------------------------------------
create table if not exists products (
  id                   uuid primary key default gen_random_uuid(),
  sku                  text not null unique,
  barcode              text not null unique,
  title                text not null,
  description          text not null default '',
  category             text not null default '',
  brand                text not null default '',
  vat_rate             numeric(5,2) not null default 20 check (vat_rate >= 0),
  price                numeric(12,2) not null check (price >= 0),
  list_price           numeric(12,2),
  cost_price           numeric(12,2) not null default 0 check (cost_price >= 0),
  total_stock          int  not null default 0,
  low_stock_threshold  int  not null default 5 check (low_stock_threshold >= 0),
  image_url            text,
  images               text[] not null default '{}',
  -- Pazaryerine özel kategori/marka/özellik eşlemeleri. Örn:
  -- {"trendyol":{"categoryId":411,"brandId":1791,"attributes":[...]}, "n11":{"categoryId":1000}}
  marketplace_attributes jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2) Pazaryeri ilanları
-- ---------------------------------------------------------------------
create table if not exists marketplace_listings (
  id                   uuid primary key default gen_random_uuid(),
  product_id           uuid not null references products(id) on delete cascade,
  marketplace_name     text not null references marketplaces(name),
  external_product_id  text,
  listing_status       text not null default 'pending'
                       check (listing_status in ('pending','active','error','passive')),
  sync_error_message   text,
  sync_ref             text,          -- batchRequestId / trackingId / taskId (onay takibi için)
  last_pushed_stock    int,           -- pazaryerine en son gönderilen stok (mutabakat için)
  last_synced_at       timestamptz,
  created_at           timestamptz not null default now(),
  unique (product_id, marketplace_name)
);
create index if not exists idx_listings_mp on marketplace_listings(marketplace_name, listing_status);

-- ---------------------------------------------------------------------
-- 3) Siparişler
-- ---------------------------------------------------------------------
create table if not exists orders (
  id                 uuid primary key default gen_random_uuid(),
  external_order_id  text not null,
  marketplace_name   text not null references marketplaces(name),
  customer_name      text not null default '',
  total_amount       numeric(12,2) not null default 0,
  status             text not null default 'new'
                     check (status in ('new','preparing','shipped','delivered','cancelled')),
  order_date         timestamptz not null default now(),
  raw                jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (marketplace_name, external_order_id)   -- idempotent içe aktarım
);
create index if not exists idx_orders_date on orders(order_date desc);
create index if not exists idx_orders_mp_status on orders(marketplace_name, status);

-- ---------------------------------------------------------------------
-- 4) Sipariş kalemleri
-- ---------------------------------------------------------------------
create table if not exists order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references orders(id) on delete cascade,
  product_id     uuid references products(id) on delete set null,
  sku            text not null default '',
  product_title  text not null default '',
  quantity       int  not null check (quantity > 0),
  unit_price     numeric(12,2) not null default 0
);
create index if not exists idx_order_items_order on order_items(order_id);
create index if not exists idx_order_items_product on order_items(product_id);

-- ---------------------------------------------------------------------
-- 5) Stok hareketleri (her değişimin denetim kaydı)
-- ---------------------------------------------------------------------
create table if not exists stock_movements (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references products(id) on delete cascade,
  marketplace_name  text references marketplaces(name),
  change_amount     int  not null,
  reason            text not null check (reason in ('initial','restock','manual_adjust','sale','cancel_restore')),
  order_id          uuid references orders(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists idx_movements_product on stock_movements(product_id, reason);

-- ---------------------------------------------------------------------
-- 6) API kimlik bilgileri (yalnızca sunucu / service role erişir)
-- ---------------------------------------------------------------------
create table if not exists marketplace_credentials (
  id                  uuid primary key default gen_random_uuid(),
  marketplace_name    text not null unique references marketplaces(name),
  api_key             text not null default '',
  api_secret          text not null default '',   -- uygulama tarafında AES-256-GCM ile şifrelenir
  seller_id           text not null default '',
  is_active           boolean not null default false,  -- false = Demo/Simülasyon adaptörü
  extra_config        jsonb not null default '{}'::jsonb, -- baseUrl, varsayılan kategori/marka/kargo vb.
  last_tested_at      timestamptz,
  last_test_ok        boolean,
  last_order_sync_at  timestamptz,
  updated_at          timestamptz not null default now()
);
insert into marketplace_credentials (marketplace_name)
select name from marketplaces on conflict (marketplace_name) do nothing;

-- ---------------------------------------------------------------------
-- 7) Senkronizasyon günlüğü (canlı akış paneli)
-- ---------------------------------------------------------------------
create table if not exists sync_logs (
  id                bigserial primary key,
  level             text not null default 'info' check (level in ('info','success','warning','error')),
  kind              text not null default 'system', -- order | stock | listing | system
  marketplace_name  text references marketplaces(name),
  message           text not null,
  context           jsonb,
  created_at        timestamptz not null default now()
);
create index if not exists idx_sync_logs_created on sync_logs(created_at desc);

-- ---------------------------------------------------------------------
-- 8) MALİYET / KÂRLILIK MOTORU
-- ---------------------------------------------------------------------
-- Ürün: desi, maliyet KDV oranı (boşsa satış KDV'si), birim ambalaj maliyeti (KDV hariç)
alter table products add column if not exists desi numeric(8,2) not null default 1;
alter table products add column if not exists cost_vat_rate numeric(5,2);
alter table products add column if not exists packaging_cost numeric(12,2) not null default 0;
comment on column products.cost_price is 'Birim alış maliyeti, KDV HARİÇ';

-- Ürün × pazaryeri ayarları: kategori komisyonu, termin, Bugün Kargoda / Hızlı Teslimat, kargo firması
alter table marketplace_listings add column if not exists commission_rate numeric(6,3);      -- % (20 = %20); boşsa kural varsayılanı
alter table marketplace_listings add column if not exists handling_days int not null default 1; -- kargoya veriliş süresi (termin)
alter table marketplace_listings add column if not exists same_day_tag boolean not null default false; -- "Bugün Kargoda"
alter table marketplace_listings add column if not exists fast_tag boolean not null default false;     -- "Hızlı Teslimat"
alter table marketplace_listings add column if not exists carrier text;
alter table marketplace_listings add column if not exists manual_shipping_cost numeric(12,2);   -- tablo yoksa paket başı kargo (KDV hariç)
alter table marketplace_listings add column if not exists price_override numeric(12,2);         -- pazaryerine özel satış fiyatı

-- Sipariş: kargo/termin bilgileri ve pazaryerinin bildirdiği gerçek tutarlar
alter table orders add column if not exists order_group text generated always as (split_part(external_order_id, '/', 1)) stored;
alter table orders add column if not exists shipped_at timestamptz;
alter table orders add column if not exists carrier text;
alter table orders add column if not exists desi numeric(8,2);
alter table orders add column if not exists marketplace_same_day boolean;
alter table orders add column if not exists marketplace_fast boolean;
alter table orders add column if not exists actual_commission_net numeric(12,2);
alter table orders add column if not exists actual_shipping_net numeric(12,2);
alter table orders add column if not exists buyer_shipping_gross numeric(12,2) not null default 0;
alter table orders add column if not exists seller_discount_gross numeric(12,2) not null default 0;
alter table orders add column if not exists micro_export boolean not null default false;
alter table orders add column if not exists kiosk boolean not null default false;
alter table orders add column if not exists currency text not null default 'TRY';
alter table orders add column if not exists fx_rate numeric(14,6) not null default 1;
create index if not exists idx_orders_group on orders(marketplace_name, order_group);

-- Sipariş anındaki maliyet fotoğrafı (sonradan ürün maliyeti değişse de geçmiş kâr bozulmaz)
alter table order_items add column if not exists vat_rate numeric(5,2);
alter table order_items add column if not exists unit_cost_net numeric(12,2);
alter table order_items add column if not exists cost_vat_rate numeric(5,2);
alter table order_items add column if not exists commission_rate numeric(6,3); -- pazaryerinin bildirdiği oran (%)

-- Versiyonlu pazaryeri kuralları (komisyon, hizmet bedelleri, barem, stopaj …)
create table if not exists fee_rules (
  id               uuid primary key default gen_random_uuid(),
  marketplace_name text not null references marketplaces(name),
  effective_from   date not null,
  config           jsonb not null,
  verified         boolean not null default false,
  notes            jsonb not null default '[]'::jsonb,
  sources          jsonb not null default '[]'::jsonb,
  updated_at       timestamptz not null default now(),
  unique (marketplace_name, effective_from)
);

-- Desi/kg kargo tarifeleri: prices[i] = i desi fiyatı (KDV hariç)
create table if not exists carrier_rates (
  id             uuid primary key default gen_random_uuid(),
  rate_table     text not null,      -- "trendyol", "idefix", "hepsiburada" …
  carrier        text not null,
  effective_from date not null,
  prices         jsonb not null,
  source         text,
  updated_at     timestamptz not null default now(),
  unique (rate_table, carrier, effective_from)
);

create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Sipariş (paket) başına hesaplanan maliyet ve net kâr
create table if not exists order_costs (
  order_id           uuid primary key references orders(id) on delete cascade,
  status             text not null check (status in ('estimate','final')),
  rule_effective_from date,
  revenue_gross      numeric(12,2) not null default 0,
  revenue_net        numeric(12,2) not null default 0,
  commission         numeric(12,2) not null default 0,
  fees               numeric(12,2) not null default 0,
  shipping           numeric(12,2) not null default 0,
  tax                numeric(12,2) not null default 0,
  product_cost       numeric(12,2) not null default 0,
  other              numeric(12,2) not null default 0,
  total_cost         numeric(12,2) not null default 0,
  vat_payable        numeric(12,2) not null default 0,
  net_profit         numeric(12,2) not null default 0,
  margin_on_revenue  numeric(10,4) not null default 0,
  same_day_eligible  boolean,
  same_day_met       boolean,
  fast_eligible      boolean,
  fast_met           boolean,
  deadline           timestamptz,
  lines              jsonb not null default '[]'::jsonb,
  notes              text[] not null default '{}',
  computed_at        timestamptz not null default now()
);
create index if not exists idx_order_costs_status on order_costs(status);

-- ---------------------------------------------------------------------
-- 9) KULLANICILAR (panel girişi) ve ÜRÜN GÖRSELLERİ
-- ---------------------------------------------------------------------
create table if not exists app_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  name          text not null default '',
  password_hash text not null,           -- scrypt (uygulama tarafında)
  role          text not null default 'admin' check (role in ('admin','staff')),
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

-- Ürün fotoğrafları için herkese açık Storage kovası (pazaryerleri görseli bu adresten indirir)
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('product-images', 'product-images', true, 10485760, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do update set public = true;
exception when others then
  raise notice 'storage şeması bulunamadı (Supabase dışı PostgreSQL) — kova oluşturulmadı';
end $$;

-- =====================================================================
-- FONKSİYONLAR
-- =====================================================================

-- updated_at
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_products_touch on products;
create trigger trg_products_touch before update on products for each row execute function touch_updated_at();
drop trigger if exists trg_orders_touch on orders;
create trigger trg_orders_touch before update on orders for each row execute function touch_updated_at();

-- Yeni ürünün başlangıç stoğunu hareket tablosuna yaz
create or replace function products_initial_movement() returns trigger language plpgsql as $$
begin
  if new.total_stock <> 0 then
    insert into stock_movements(product_id, change_amount, reason) values (new.id, new.total_stock, 'initial');
  end if;
  return new;
end $$;
drop trigger if exists trg_products_initial on products;
create trigger trg_products_initial after insert on products for each row execute function products_initial_movement();

-- ---------------------------------------------------------------------
-- apply_order: Siparişi atomik ve idempotent olarak işler.
--  * Aynı (pazaryeri, sipariş no) ikinci kez gelirse stok tekrar düşülmez.
--  * Ürün satırları FOR UPDATE ile kilitlenir → eşzamanlı siparişlerde yarış durumu olmaz.
--  * Dönen affected_product_ids, diğer pazaryerlerine stok gönderimi için kullanılır.
-- p_items: [{"sku":"KRD-001","barcode":"869...","title":"...","quantity":3,"unit_price":49.9}]
-- ---------------------------------------------------------------------
create or replace function apply_order(
  p_marketplace        text,
  p_external_order_id  text,
  p_customer_name      text,
  p_status             text,
  p_order_date         timestamptz,
  p_items              jsonb,
  p_total_amount       numeric default null,
  p_raw                jsonb default null
) returns jsonb language plpgsql as $$
declare
  v_order_id   uuid;
  v_existing   orders%rowtype;
  v_item       jsonb;
  v_product_id uuid;
  v_qty        int;
  v_affected   uuid[] := '{}';
  v_unmatched  text[] := '{}';
  v_total      numeric := 0;
  v_status_res jsonb;
begin
  select * into v_existing from orders
   where marketplace_name = p_marketplace and external_order_id = p_external_order_id
   for update;

  if found then
    -- Mevcut sipariş: yalnızca durum değişikliğini uygula (iptal → stok iadesi)
    if v_existing.status <> p_status then
      v_status_res := set_order_status(v_existing.id, p_status);
      return jsonb_build_object('order_id', v_existing.id, 'is_new', false,
        'affected_product_ids', coalesce(v_status_res->'affected_product_ids', '[]'::jsonb), 'unmatched_skus', '[]'::jsonb);
    end if;
    return jsonb_build_object('order_id', v_existing.id, 'is_new', false,
      'affected_product_ids', '[]'::jsonb, 'unmatched_skus', '[]'::jsonb);
  end if;

  select coalesce(sum((i->>'quantity')::int * coalesce((i->>'unit_price')::numeric, 0)), 0)
    into v_total from jsonb_array_elements(p_items) i;

  insert into orders(external_order_id, marketplace_name, customer_name, total_amount, status, order_date, raw)
  values (p_external_order_id, p_marketplace, coalesce(p_customer_name, ''),
          coalesce(p_total_amount, v_total), p_status, coalesce(p_order_date, now()), p_raw)
  returning id into v_order_id;

  -- Kilitleri deterministik sırada al (deadlock önleme)
  perform 1 from products
   where sku in (select i->>'sku' from jsonb_array_elements(p_items) i)
      or barcode in (select i->>'barcode' from jsonb_array_elements(p_items) i where i ? 'barcode')
   order by id for update;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::int;
    select id into v_product_id from products
     where sku = v_item->>'sku' or (v_item ? 'barcode' and barcode = v_item->>'barcode')
     order by (sku = v_item->>'sku') desc limit 1;

    insert into order_items(order_id, product_id, sku, product_title, quantity, unit_price,
                            vat_rate, unit_cost_net, cost_vat_rate, commission_rate)
    select v_order_id, v_product_id, coalesce(v_item->>'sku', ''), coalesce(v_item->>'title', ''),
           v_qty, coalesce((v_item->>'unit_price')::numeric, 0),
           p.vat_rate, p.cost_price, coalesce(p.cost_vat_rate, p.vat_rate),
           nullif(v_item->>'commission_rate', '')::numeric
      from (select 1) x left join products p on p.id = v_product_id;

    if v_product_id is null then
      v_unmatched := v_unmatched || coalesce(v_item->>'sku', v_item->>'barcode', '?');
      continue;
    end if;

    if p_status <> 'cancelled' then
      update products set total_stock = total_stock - v_qty where id = v_product_id;
      insert into stock_movements(product_id, marketplace_name, change_amount, reason, order_id)
      values (v_product_id, p_marketplace, -v_qty, 'sale', v_order_id);
      v_affected := array_append(v_affected, v_product_id);
    end if;
  end loop;

  return jsonb_build_object(
    'order_id', v_order_id, 'is_new', true,
    'affected_product_ids', to_jsonb(array(select distinct unnest(v_affected))),
    'unmatched_skus', to_jsonb(v_unmatched));
end $$;

-- ---------------------------------------------------------------------
-- set_order_status: Durum değişimi. İptal/İade → stok havuza geri eklenir.
-- ---------------------------------------------------------------------
create or replace function set_order_status(p_order_id uuid, p_status text)
returns jsonb language plpgsql as $$
declare
  v_order    orders%rowtype;
  v_affected uuid[] := '{}';
  r          record;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then raise exception 'Sipariş bulunamadı: %', p_order_id; end if;
  if v_order.status = p_status then
    return jsonb_build_object('order_id', p_order_id, 'affected_product_ids', '[]'::jsonb);
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'İptal edilmiş sipariş yeniden açılamaz (%).', v_order.external_order_id;
  end if;

  if p_status = 'cancelled' then
    for r in select oi.product_id, sum(oi.quantity)::int as qty
               from order_items oi
               join products p on p.id = oi.product_id
              where oi.order_id = p_order_id
              group by oi.product_id
              order by oi.product_id
    loop
      perform 1 from products where id = r.product_id for update;
      update products set total_stock = total_stock + r.qty where id = r.product_id;
      insert into stock_movements(product_id, marketplace_name, change_amount, reason, order_id)
      values (r.product_id, v_order.marketplace_name, r.qty, 'cancel_restore', p_order_id);
      v_affected := array_append(v_affected, r.product_id);
    end loop;
  end if;

  update orders set status = p_status where id = p_order_id;
  return jsonb_build_object('order_id', p_order_id, 'affected_product_ids', to_jsonb(v_affected));
end $$;

-- ---------------------------------------------------------------------
-- adjust_stock: Manuel stok girişi / düzeltme
-- ---------------------------------------------------------------------
create or replace function adjust_stock(p_product_id uuid, p_change int, p_reason text default 'restock')
returns int language plpgsql as $$
declare v_new int;
begin
  if p_reason not in ('restock','manual_adjust') then
    raise exception 'Geçersiz neden: %', p_reason;
  end if;
  update products set total_stock = total_stock + p_change where id = p_product_id returning total_stock into v_new;
  if not found then raise exception 'Ürün bulunamadı'; end if;
  insert into stock_movements(product_id, change_amount, reason) values (p_product_id, p_change, p_reason);
  return v_new;
end $$;

-- =====================================================================
-- GÖRÜNÜMLER (raporlama)
-- =====================================================================

-- Başlangıç Stoğu | Pazaryeri Satışları | Kalan Net Stok
create or replace view v_stock_breakdown as
select
  p.id, p.sku, p.barcode, p.title, p.image_url, p.price, p.total_stock, p.low_stock_threshold,
  coalesce(sum(m.change_amount) filter (where m.reason in ('initial','restock','manual_adjust')), 0)::int as start_stock,
  coalesce(-sum(m.change_amount) filter (where m.reason in ('sale','cancel_restore') and m.marketplace_name = 'trendyol'),    0)::int as trendyol_sales,
  coalesce(-sum(m.change_amount) filter (where m.reason in ('sale','cancel_restore') and m.marketplace_name = 'hepsiburada'), 0)::int as hepsiburada_sales,
  coalesce(-sum(m.change_amount) filter (where m.reason in ('sale','cancel_restore') and m.marketplace_name = 'n11'),         0)::int as n11_sales,
  coalesce(-sum(m.change_amount) filter (where m.reason in ('sale','cancel_restore') and m.marketplace_name = 'ciceksepeti'), 0)::int as ciceksepeti_sales,
  -- Yeni eklenen pazaryerleri için genel kırılım
  coalesce((
    select jsonb_object_agg(s.marketplace_name, s.qty) from (
      select sm.marketplace_name, -sum(sm.change_amount)::int as qty
        from stock_movements sm
       where sm.product_id = p.id and sm.reason in ('sale','cancel_restore') and sm.marketplace_name is not null
       group by sm.marketplace_name) s), '{}'::jsonb) as sales_by_marketplace,
  (p.total_stock < p.low_stock_threshold) as is_critical
from products p
left join stock_movements m on m.product_id = p.id
group by p.id;

-- Günlük ciro (iptaller hariç)
create or replace view v_daily_revenue as
select
  date_trunc('day', order_date at time zone 'Europe/Istanbul')::date as day,
  marketplace_name,
  sum(total_amount)::numeric(14,2) as revenue,
  count(*)::int as order_count
from orders
where status <> 'cancelled'
group by 1, 2;

-- =====================================================================
-- REALTIME: Tablolarda değişiklik olduğunda "panel" kanalına yayın (broadcast)
-- Veri değil yalnızca "yenile" sinyali gider; böylece anon anahtarla hassas veri sızmaz.
-- =====================================================================
create or replace function notify_panel() returns trigger language plpgsql security definer as $$
begin
  begin
    perform realtime.send(jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP), 'refresh', 'panel', false);
  exception when others then
    null; -- realtime şeması yoksa (ör. düz PostgreSQL) sessizce geç
  end;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['products','orders','marketplace_listings','sync_logs','stock_movements','order_costs'] loop
    execute format('drop trigger if exists trg_%s_notify on %I', t, t);
    execute format('create trigger trg_%s_notify after insert or update or delete on %I for each statement execute function notify_panel()', t, t);
  end loop;
end $$;

-- =====================================================================
-- GÜVENLİK (RLS): Tarayıcı tablolara doğrudan erişemez.
-- Tüm okuma/yazma Next.js API Routes üzerinden service_role ile yapılır.
-- =====================================================================
alter table marketplaces            enable row level security;
alter table products                enable row level security;
alter table marketplace_listings    enable row level security;
alter table orders                  enable row level security;
alter table order_items             enable row level security;
alter table stock_movements         enable row level security;
alter table marketplace_credentials enable row level security;
alter table sync_logs               enable row level security;
alter table fee_rules               enable row level security;
alter table carrier_rates           enable row level security;
alter table app_settings            enable row level security;
alter table order_costs             enable row level security;
alter table app_users               enable row level security;

-- =====================================================================
-- DEMO VERİSİ: select seed_demo_data();  (Ayarlar ekranındaki butonla da çağrılır)
-- Tüm sipariş/ürün verisini siler, 10 ürün ve ~6 aylık gerçekçi sipariş geçmişi üretir.
-- "Kurdele" ürünü 25 stokla ve hiç satışsız başlar (25 → 20 senaryosunu test etmek için).
-- =====================================================================
create or replace function seed_demo_data() returns jsonb language plpgsql as $$
declare
  -- sku, barkod, ad, kategori, fiyat (KDV dahil), maliyet (KDV hariç), stok, eşik, desi
  v_products jsonb := '[
    ["KRD-001","8690000000011","Saten Kurdele 2,5 cm x 10 m - Kırmızı","Hediye Paketleme",49.90,14,25,5,1],
    ["VZO-014","8690000000028","Cam Silindir Vazo 25 cm","Ev Dekorasyon",289.90,110,60,8,4],
    ["MUM-220","8690000000035","Kokulu Mum - Vanilya & Amber 200 g","Ev Dekorasyon",179.90,48,140,10,2],
    ["KUT-105","8690000000042","Kraft Hediye Kutusu Seti (3 Boy)","Hediye Paketleme",129.90,32,90,10,5],
    ["TER-330","8690000000059","Seramik Saksı Beyaz 14 cm","Bahçe & Bitki",149.90,45,110,8,3],
    ["KRT-010","8690000000066","El Yapımı Tebrik Kartı - Doğum Günü","Kırtasiye",39.90,7,200,15,1],
    ["SPR-450","8690000000073","Kuru Çiçek Buketi - Lavanta","Çiçek",219.90,72,70,6,3],
    ["TPS-777","8690000000080","Ahşap Servis Tepsisi 40x25","Mutfak",349.90,125,45,5,6],
    ["ORG-212","8690000000097","Organze Kese 10x15 (50 Adet)","Hediye Paketleme",89.90,21,160,12,1],
    ["BAL-090","8690000000103","Metalik Balon Seti - Altın (12 Adet)","Parti",99.90,24,18,6,1]
  ]'::jsonb;
  v_carriers jsonb := '{"trendyol":"TEX","hepsiburada":"HepsiJET","n11":"PTT","ciceksepeti":"Aras","pazarama":"Aras","idefix":"Aras","koctas":"Yurtiçi","etsy":"PTT Global"}'::jsonb;
  v_comm jsonb := '{"trendyol":20,"hepsiburada":18,"n11":18,"ciceksepeti":20,"pazarama":17,"idefix":15,"koctas":15,"etsy":6.5}'::jsonb;
  v_first text[] := array['Ayşe','Mehmet','Zeynep','Ahmet','Elif','Mustafa','Fatma','Emre','Selin','Burak','Merve','Can','Deniz','Hakan','Gizem','Oğuz','Ebru','Kerem','Ceren','Murat'];
  v_last  text[] := array['Yılmaz','Kaya','Demir','Şahin','Çelik','Yıldız','Aydın','Öztürk','Arslan','Doğan','Kılıç','Aslan','Çetin','Koç','Kurt','Özdemir'];
  v_p jsonb; v_prod products%rowtype; v_day int; v_n int; v_mp text; v_r float; v_qty int;
  v_date timestamptz; v_status text; v_res jsonb; v_orders int := 0; v_seq int := 0; v_oid uuid; v_ship timestamptz;
begin
  delete from order_costs; delete from order_items; delete from orders; delete from stock_movements;
  delete from marketplace_listings; delete from products; delete from sync_logs;

  for v_p in select * from jsonb_array_elements(v_products) loop
    insert into products(sku, barcode, title, description, category, brand, price, list_price, cost_price, total_stock,
                         low_stock_threshold, vat_rate, cost_vat_rate, desi, packaging_cost, image_url, created_at)
    values (v_p->>0, v_p->>1, v_p->>2, (v_p->>2) || ' — yüksek kaliteli, aynı gün kargo.', v_p->>3, 'Nuance Art',
            (v_p->>4)::numeric, round((v_p->>4)::numeric * 1.2, 2), (v_p->>5)::numeric, (v_p->>6)::int, (v_p->>7)::int,
            20, 20, (v_p->>8)::numeric, 1.5, null, now() - interval '181 days')
    returning * into v_prod;
    update stock_movements set created_at = now() - interval '181 days' where product_id = v_prod.id;
    insert into marketplace_listings(product_id, marketplace_name, external_product_id, listing_status, last_synced_at, last_pushed_stock,
                                     commission_rate, handling_days, same_day_tag, fast_tag, carrier, manual_shipping_cost)
    select v_prod.id, m.name, upper(left(m.name, 2)) || '-' || (100000 + floor(random() * 899999))::int, 'active', now() - interval '1 hour', v_prod.total_stock,
           (v_comm->>m.name)::numeric, case when m.name in ('trendyol','hepsiburada','idefix') then 0 else 1 end,
           m.name = 'trendyol', m.name in ('trendyol','hepsiburada'), v_carriers->>m.name,
           case when m.name = 'etsy' then 420 else null end
      from marketplaces m;
  end loop;

  for v_day in reverse 180..0 loop
    v_n := 1 + floor(random() * 4)::int + case when v_day < 30 then 1 else 0 end;
    for i in 1..v_n loop
      v_r := random();
      v_mp := case when v_r < 0.34 then 'trendyol' when v_r < 0.54 then 'hepsiburada' when v_r < 0.66 then 'n11'
                   when v_r < 0.76 then 'ciceksepeti' when v_r < 0.83 then 'pazarama' when v_r < 0.89 then 'idefix'
                   when v_r < 0.95 then 'koctas' else 'etsy' end;
      select * into v_prod from products where sku not in ('KRD-001','BAL-090') order by random() limit 1;
      v_qty := 1 + floor(random() * 2)::int;
      v_date := date_trunc('day', now() - make_interval(days => v_day)) + make_interval(hours => 5 + floor(random() * 14)::int, mins => floor(random() * 60)::int);
      if v_date > now() then v_date := now() - interval '5 minutes'; end if;
      if v_prod.total_stock - v_qty < v_prod.low_stock_threshold + 2 then
        perform adjust_stock(v_prod.id, 60, 'restock');
        update stock_movements set created_at = v_date - interval '1 hour'
         where id = (select id from stock_movements where product_id = v_prod.id order by created_at desc limit 1);
      end if;
      v_status := case when random() < 0.05 then 'cancelled'
                       when v_day > 7 then 'delivered' when v_day > 3 then 'shipped'
                       when v_day > 1 then 'preparing' else 'new' end;
      v_seq := v_seq + 1;
      v_res := apply_order(
        v_mp,
        case v_mp when 'trendyol' then 'TY' when 'hepsiburada' then 'HB' when 'n11' then 'N11' when 'ciceksepeti' then 'CS'
                  when 'pazarama' then 'PZ' when 'idefix' then 'IDF' when 'koctas' then 'KT' else 'ETSY' end
          || (1000000000 + v_seq * 7919 + floor(random() * 7000)::int)::text,
        v_first[1 + floor(random() * array_length(v_first, 1))::int] || ' ' || v_last[1 + floor(random() * array_length(v_last, 1))::int],
        case when v_status = 'cancelled' then 'new' else v_status end,
        v_date,
        jsonb_build_array(jsonb_build_object('sku', v_prod.sku, 'barcode', v_prod.barcode, 'title', v_prod.title, 'quantity', v_qty, 'unit_price', v_prod.price)));
      v_oid := (v_res->>'order_id')::uuid;
      update stock_movements set created_at = v_date where order_id = v_oid;
      -- Kargo: %80 aynı gün, %15 ertesi gün, %5 geç
      v_r := random();
      v_ship := case when v_status in ('shipped','delivered') or (v_status = 'cancelled' and random() < 0.5)
                     then v_date + case when v_r < 0.8 then interval '3 hours' when v_r < 0.95 then interval '1 day' else interval '3 days' end
                end;
      update orders set carrier = v_carriers->>v_mp, shipped_at = v_ship,
                        buyer_shipping_gross = case when v_mp = 'etsy' then 480 else 0 end,
                        currency = 'TRY'
       where id = v_oid;
      if v_status = 'cancelled' then
        perform set_order_status(v_oid, 'cancelled');
        update stock_movements set created_at = v_date + interval '1 day' where order_id = v_oid and reason = 'cancel_restore';
      end if;
      v_orders := v_orders + 1;
    end loop;
  end loop;

  -- Balon setini kritik seviyeye çek (kırmızı rozet demosu)
  select * into v_prod from products where sku = 'BAL-090';
  perform adjust_stock(v_prod.id, 4 - v_prod.total_stock, 'manual_adjust');

  update marketplace_listings l set last_pushed_stock = p.total_stock from products p where p.id = l.product_id;
  insert into sync_logs(level, kind, message) values ('info', 'system', 'Demo verisi yüklendi: 10 ürün, 8 pazaryeri, ' || v_orders || ' sipariş.');
  return jsonb_build_object('products', 10, 'orders', v_orders);
end $$;
