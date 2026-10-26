-- Natan Electronics — Esquema completo de base de datos (Supabase / PostgreSQL)
-- Recrea todas las tablas, índices, funciones y políticas de seguridad (RLS)
-- que usa la tienda. Ejecutar en el SQL Editor de un proyecto Supabase nuevo.
-- No contiene datos ni claves.

-- ─────────────────────────────────────────────────────────────
-- 1. Administradores del panel y funciones de rol
-- ─────────────────────────────────────────────────────────────
create table if not exists public.natan_admins (
  email text not null,
  rol text not null default 'operador',
  nombre text,
  created_at timestamp with time zone not null default now(),
  constraint natan_admins_pkey primary key (email),
  constraint natan_admins_rol_check check (rol = any (array['admin', 'operador']))
);
alter table public.natan_admins enable row level security;

create or replace function public.is_natan_admin()
 returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from natan_admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.natan_admin_rol()
 returns text language sql stable security definer set search_path to 'public'
as $$
  select rol from natan_admins
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;

create policy admins_gestionan_lista on public.natan_admins for all to authenticated
  using (natan_admin_rol() = 'admin') with check (natan_admin_rol() = 'admin');
create policy admins_leen_lista on public.natan_admins for select to authenticated
  using (is_natan_admin());

-- ─────────────────────────────────────────────────────────────
-- 2. Catálogo
-- ─────────────────────────────────────────────────────────────
create table if not exists public.natan_products (
  id bigserial primary key,
  name text not null,
  cat text not null,
  brand text default '',
  price numeric(10,2) not null,
  old_price numeric(10,2),
  badge text default '',
  stars integer default 5 check (stars >= 1 and stars <= 5),
  reviews integer default 0,
  description text default '',
  img text default '',
  specs jsonb default '[]',
  sede text[] default '{}',
  stock_maturin integer default 0,
  stock_temblador integer default 0,
  active boolean default true,
  featured boolean default false,
  created_at timestamp with time zone default now(),
  colors jsonb default '[]',
  images jsonb default '[]',
  variants jsonb default '[]',
  variant_label text,
  codigo text
);
alter table public.natan_products enable row level security;
-- El código del sistema administrativo identifica cada producto: no puede repetirse.
create unique index if not exists natan_products_codigo_unico on public.natan_products (codigo)
  where codigo is not null and codigo <> '';
create policy natan_products_admin_write on public.natan_products for all to authenticated
  using (is_natan_admin()) with check (is_natan_admin());
create policy natan_products_public_read on public.natan_products for select to anon, authenticated
  using (true);

-- Respaldo de foto por código (si un producto se recrea, recupera su foto).
create table if not exists public.natan_product_photos (
  codigo text primary key,
  img text not null,
  updated_at timestamp with time zone not null default now()
);
alter table public.natan_product_photos enable row level security;
create policy natan_product_photos_admin_all on public.natan_product_photos for all to authenticated
  using (is_natan_admin()) with check (is_natan_admin());

create table if not exists public.natan_categories (
  slug text primary key,
  label text not null,
  image_url text not null default '',
  updated_at timestamp with time zone default now()
);
alter table public.natan_categories enable row level security;
create policy natan_categories_admin_write on public.natan_categories for all to authenticated
  using (is_natan_admin()) with check (is_natan_admin());
create policy natan_categories_public_read on public.natan_categories for select to anon, authenticated
  using (true);

-- Actualización masiva de precios/existencia (la usa la sincronización del sistema).
create or replace function public.bulk_update_products(updates jsonb)
 returns void language plpgsql security definer
as $$
begin
  update natan_products p
  set
    price          = case when u ? 'price'          then (u->>'price')::numeric else p.price end,
    stock_maturin  = case when u ? 'stock_maturin'  then (u->>'stock_maturin')::int else p.stock_maturin end,
    sede           = case when u ? 'sede'           then coalesce((select array_agg(x) from jsonb_array_elements_text(u->'sede') x), '{}') else p.sede end,
    name           = case when u ? 'name'           then u->>'name' else p.name end,
    description    = case when u ? 'description'    then u->>'description' else p.description end,
    cat            = case when u ? 'cat'            then u->>'cat' else p.cat end,
    brand          = case when u ? 'brand'          then u->>'brand' else p.brand end,
    codigo         = case when u ? 'codigo'         then u->>'codigo' else p.codigo end,
    specs          = case when u ? 'specs'          then u->'specs' else p.specs end,
    active         = case when u ? 'active'         then (u->>'active')::boolean else p.active end
  from jsonb_array_elements(updates) as u
  where p.id = (u->>'id')::bigint;
end;
$$;
revoke execute on function public.bulk_update_products(jsonb) from anon, public;
grant execute on function public.bulk_update_products(jsonb) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 3. Contenido de la portada
-- ─────────────────────────────────────────────────────────────
create table if not exists public.natan_banners (
  id bigserial primary key,
  image_url text not null,
  title text,
  link_url text,
  sort_order integer default 0,
  active boolean default true,
  created_at timestamp with time zone default now()
);
alter table public.natan_banners enable row level security;
create policy natan_banners_admin_write on public.natan_banners for all to authenticated
  using (is_natan_admin()) with check (is_natan_admin());
create policy natan_banners_public_read on public.natan_banners for select to anon, authenticated
  using (true);

create table if not exists public.natan_brands (
  id bigserial primary key,
  name text not null,
  logo_url text not null,
  category text,
  sort_order integer default 0,
  active boolean default true,
  created_at timestamp with time zone default now()
);
alter table public.natan_brands enable row level security;
create policy natan_brands_admin_write on public.natan_brands for all to authenticated
  using (is_natan_admin()) with check (is_natan_admin());
create policy natan_brands_public_read on public.natan_brands for select to anon, authenticated
  using (true);

-- Fotos de "Clientes satisfechos".
create table if not exists public.natan_clients (
  id bigserial primary key,
  image_url text not null,
  name text,
  sort_order integer default 0,
  active boolean default true,
  created_at timestamp with time zone default now()
);
alter table public.natan_clients enable row level security;
create policy natan_clients_admin_write on public.natan_clients for all to authenticated
  using (is_natan_admin()) with check (is_natan_admin());
create policy natan_clients_public_read on public.natan_clients for select to anon, authenticated
  using (true);

-- ─────────────────────────────────────────────────────────────
-- 4. Configuración y tasa BCV
-- ─────────────────────────────────────────────────────────────
create table if not exists public.natan_settings (
  key text primary key,
  value text not null,
  updated_at timestamp with time zone default now()
);
alter table public.natan_settings enable row level security;
create policy natan_settings_admin_write on public.natan_settings for all to authenticated
  using (is_natan_admin()) with check (is_natan_admin());
-- La tienda solo puede leer las claves públicas; el resto (claves de integración,
-- bitácoras) queda visible únicamente para administradores.
create policy natan_settings_public_read on public.natan_settings for select to anon, authenticated
  using (is_natan_admin() or key = any (array['hero_title', 'hero_subtitle', 'hero_images', 'brand_primary',
    'brand_accent', 'marquee_images', 'promo_bloques', 'bcv_rate', 'd3xd_exchange_rate', 'store_info', 'categorias']));

create table if not exists public.natan_bcv_history (
  id bigserial primary key,
  rate numeric not null,
  created_at timestamp with time zone default now()
);
alter table public.natan_bcv_history enable row level security;
create policy natan_bcv_history_admin_write on public.natan_bcv_history for insert to authenticated
  with check (is_natan_admin());
create policy natan_bcv_history_public_read on public.natan_bcv_history for select to anon, authenticated
  using (true);

-- ─────────────────────────────────────────────────────────────
-- 5. Clientes y pedidos
-- ─────────────────────────────────────────────────────────────
create table if not exists public.natan_customers (
  id bigserial primary key,
  cedula text not null unique,
  name text,
  phone text,
  created_at timestamp with time zone default now()
);
alter table public.natan_customers enable row level security;
create policy natan_customers_admin_delete on public.natan_customers for delete to authenticated
  using (is_natan_admin());
create policy natan_customers_public_insert on public.natan_customers for insert to anon, authenticated
  with check (true);
create policy natan_customers_public_read on public.natan_customers for select to anon, authenticated
  using (true);
create policy natan_customers_public_update on public.natan_customers for update to anon, authenticated
  using (true) with check (true);

create table if not exists public.natan_orders (
  id text primary key,
  cliente text not null default '',
  tel text default '',
  items jsonb default '[]',
  method text default '',
  ref text default '',
  sede text default 'Maturín',
  status text default 'Pendiente',
  created_at timestamp with time zone default now(),
  cedula text,
  synced_to_pos boolean not null default false
);
alter table public.natan_orders enable row level security;
create policy natan_orders_admin_delete on public.natan_orders for delete to authenticated
  using (is_natan_admin());
create policy natan_orders_admin_update on public.natan_orders for update to authenticated
  using (is_natan_admin()) with check (is_natan_admin());
create policy natan_orders_public_insert on public.natan_orders for insert to anon, authenticated
  with check (true);
create policy natan_orders_public_read on public.natan_orders for select to anon, authenticated
  using (true);

-- ─────────────────────────────────────────────────────────────
-- 6. Notificaciones de pago BNC
-- ─────────────────────────────────────────────────────────────
create table if not exists public.natan_bnc_notifications (
  id bigserial primary key,
  payment_type text,
  origin_bank_reference text,
  destiny_bank_reference text,
  origin_bank_code text,
  amount numeric,
  currency_code text,
  tx_date text,
  tx_hour text,
  commerce_id text,
  client_phone text,
  concept text,
  debtor_account text,
  debtor_id text,
  raw_payload jsonb,
  matched_order_id text references public.natan_orders(id),
  match_status text default 'sin_revisar',
  created_at timestamp with time zone default now()
);
alter table public.natan_bnc_notifications enable row level security;
create policy natan_bnc_notifications_admin on public.natan_bnc_notifications for all to authenticated
  using (is_natan_admin()) with check (is_natan_admin());
