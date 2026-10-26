-- Natan Electronics — Supabase Migration
-- Ejecutar en: Supabase Dashboard > SQL Editor

-- ==============================
-- TABLA: products
-- ==============================
CREATE TABLE IF NOT EXISTS products (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  cat          TEXT NOT NULL,               -- slug: smartphones, laptops, audio, smartwatches, tablets, accesorios
  brand        TEXT DEFAULT '',
  price        NUMERIC(10,2) NOT NULL,
  old_price    NUMERIC(10,2),
  badge        TEXT DEFAULT '',             -- '', 'new', 'hot', 'stock'
  stars        INTEGER DEFAULT 5 CHECK (stars BETWEEN 1 AND 5),
  reviews      INTEGER DEFAULT 0,
  description  TEXT DEFAULT '',
  img          TEXT DEFAULT '',
  specs        JSONB DEFAULT '[]',          -- [["Pantalla","6.7 AMOLED"], ...]
  sede         TEXT[] DEFAULT '{}',         -- '{maturin,temblador}'
  stock_maturin    INTEGER DEFAULT 0,
  stock_temblador  INTEGER DEFAULT 0,
  active       BOOLEAN DEFAULT true,
  featured     BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================
-- TABLA: orders
-- ==============================
CREATE TABLE IF NOT EXISTS orders (
  id           TEXT PRIMARY KEY,            -- formato: NE-0044
  cliente      TEXT NOT NULL DEFAULT '',
  tel          TEXT DEFAULT '',
  items        JSONB DEFAULT '[]',          -- [{name, qty, price}]
  method       TEXT DEFAULT '',
  ref          TEXT DEFAULT '',
  sede         TEXT DEFAULT 'Maturín',
  status       TEXT DEFAULT 'Pendiente',    -- Pendiente, Confirmado, En preparación, Entregado, Cancelado
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================
-- TABLA: settings
-- ==============================
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Tasa BCV inicial
INSERT INTO settings (key, value) VALUES ('bcv_rate', '42.50') ON CONFLICT DO NOTHING;

-- ==============================
-- ROW LEVEL SECURITY
-- ==============================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders   ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Products: lectura pública, escritura con anon key (admin panel)
CREATE POLICY "products_select" ON products FOR SELECT TO anon USING (true);
CREATE POLICY "products_insert" ON products FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "products_update" ON products FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "products_delete" ON products FOR DELETE TO anon USING (true);

-- Orders: lectura + escritura con anon key
CREATE POLICY "orders_select" ON orders FOR SELECT TO anon USING (true);
CREATE POLICY "orders_insert" ON orders FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "orders_update" ON orders FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "orders_delete" ON orders FOR DELETE TO anon USING (true);

-- Settings: lectura pública, escritura con anon key
CREATE POLICY "settings_select" ON settings FOR SELECT TO anon USING (true);
CREATE POLICY "settings_update" ON settings FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "settings_insert" ON settings FOR INSERT TO anon WITH CHECK (true);
