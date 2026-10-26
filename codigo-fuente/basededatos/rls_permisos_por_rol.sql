-- Permisos por rol para Natan Electronics.
-- APLICAR SOLO cuando el login del panel (Supabase Auth + natan_admins) esté
-- confirmado funcionando, porque a partir de aquí la clave pública (anon)
-- deja de poder escribir en el catálogo.
--
-- Reglas:
--  * Visitante (anon): lee catálogo/diseño, crea pedidos y clientes, suma vistas.
--  * Admin/operador autenticado (is_natan_admin()): todo.
--  * Servidor (clave de servicio): salta RLS, no necesita políticas.

-- ---------- helpers ----------
create or replace function public.natan_es_admin_o_servicio()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_natan_admin();
$$;

-- ---------- natan_products ----------
drop policy if exists natan_products_select on natan_products;
drop policy if exists natan_products_insert on natan_products;
drop policy if exists natan_products_update on natan_products;
drop policy if exists natan_products_delete on natan_products;
create policy natan_products_public_read on natan_products for select to anon, authenticated using (true);
create policy natan_products_admin_write on natan_products for all to authenticated
  using (public.is_natan_admin()) with check (public.is_natan_admin());

-- ---------- natan_settings ----------
-- La tienda pública lee diseño/tasa; NUNCA las claves bnc_* ni los logs internos.
drop policy if exists natan_settings_all on natan_settings;
create policy natan_settings_public_read on natan_settings for select to anon, authenticated
  using (public.is_natan_admin() or key in (
    'hero_title','hero_subtitle','hero_images','brand_primary','brand_accent',
    'marquee_images','promo_bloques','bcv_rate','d3xd_exchange_rate'
  ));
create policy natan_settings_admin_write on natan_settings for all to authenticated
  using (public.is_natan_admin()) with check (public.is_natan_admin());

-- ---------- catálogo auxiliar: banners, categorías, marcas, fotos ----------
drop policy if exists natan_banners_select on natan_banners;
drop policy if exists natan_banners_insert on natan_banners;
drop policy if exists natan_banners_update on natan_banners;
drop policy if exists natan_banners_delete on natan_banners;
create policy natan_banners_public_read on natan_banners for select to anon, authenticated using (true);
create policy natan_banners_admin_write on natan_banners for all to authenticated
  using (public.is_natan_admin()) with check (public.is_natan_admin());

drop policy if exists natan_categories_all on natan_categories;
create policy natan_categories_public_read on natan_categories for select to anon, authenticated using (true);
create policy natan_categories_admin_write on natan_categories for all to authenticated
  using (public.is_natan_admin()) with check (public.is_natan_admin());

drop policy if exists natan_brands_all on natan_brands;
create policy natan_brands_public_read on natan_brands for select to anon, authenticated using (true);
create policy natan_brands_admin_write on natan_brands for all to authenticated
  using (public.is_natan_admin()) with check (public.is_natan_admin());

drop policy if exists anon_read_product_photos on natan_product_photos;
drop policy if exists anon_write_product_photos on natan_product_photos;
drop policy if exists anon_update_product_photos on natan_product_photos;
create policy natan_product_photos_admin_all on natan_product_photos for all to authenticated
  using (public.is_natan_admin()) with check (public.is_natan_admin());

-- ---------- pedidos y clientes (la tienda pública crea; solo admin lee todo) ----------
drop policy if exists natan_orders_all on natan_orders;
create policy natan_orders_public_insert on natan_orders for insert to anon, authenticated with check (true);
-- "Mis pedidos" en la tienda consulta por cédula sin sesión: se mantiene la
-- lectura pública por ahora (riesgo conocido: quien sepa una cédula ve sus
-- pedidos). Endurecer cuando la tienda tenga cuentas de cliente.
create policy natan_orders_public_read on natan_orders for select to anon, authenticated using (true);
create policy natan_orders_admin_write on natan_orders for update to authenticated
  using (public.is_natan_admin()) with check (public.is_natan_admin());
create policy natan_orders_admin_delete on natan_orders for delete to authenticated using (public.is_natan_admin());

drop policy if exists natan_customers_all on natan_customers;
create policy natan_customers_public_upsert_ins on natan_customers for insert to anon, authenticated with check (true);
create policy natan_customers_public_upsert_upd on natan_customers for update to anon, authenticated using (true) with check (true);
create policy natan_customers_public_read on natan_customers for select to anon, authenticated using (true);
create policy natan_customers_admin_delete on natan_customers for delete to authenticated using (public.is_natan_admin());

drop policy if exists natan_clients_select on natan_clients;
drop policy if exists natan_clients_insert on natan_clients;
drop policy if exists natan_clients_update on natan_clients;
drop policy if exists natan_clients_delete on natan_clients;
create policy natan_clients_public_read on natan_clients for select to anon, authenticated using (true);
create policy natan_clients_admin_write on natan_clients for all to authenticated
  using (public.is_natan_admin()) with check (public.is_natan_admin());

-- ---------- BNC y BCV: solo admin (el servidor usa clave de servicio) ----------
drop policy if exists natan_bnc_notifications_all on natan_bnc_notifications;
create policy natan_bnc_notifications_admin on natan_bnc_notifications for all to authenticated
  using (public.is_natan_admin()) with check (public.is_natan_admin());

drop policy if exists natan_bcv_history_select on natan_bcv_history;
drop policy if exists natan_bcv_history_insert on natan_bcv_history;
create policy natan_bcv_history_public_read on natan_bcv_history for select to anon, authenticated using (true);
create policy natan_bcv_history_admin_write on natan_bcv_history for insert to authenticated with check (public.is_natan_admin());

-- ---------- funciones RPC ----------
-- bulk_update_products: solo servidor/admin (antes cualquiera podía reescribir el catálogo).
revoke execute on function public.bulk_update_products(jsonb) from anon, public;
grant execute on function public.bulk_update_products(jsonb) to authenticated, service_role;
-- increment_product_views se queda público (solo suma un contador).

-- ---------- storage: fotos de productos ----------
drop policy if exists natan_storage_insert on storage.objects;
drop policy if exists natan_storage_update on storage.objects;
drop policy if exists natan_storage_delete on storage.objects;
create policy natan_storage_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'natan-products' and public.is_natan_admin());
create policy natan_storage_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'natan-products' and public.is_natan_admin());
create policy natan_storage_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'natan-products' and public.is_natan_admin());
