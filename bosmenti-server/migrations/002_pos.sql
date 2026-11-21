-- Point of sale: stock per colour/size, barcodes, store sales, payments over time, discounts.

ALTER TABLE products ADD COLUMN track_stock boolean NOT NULL DEFAULT false;

CREATE TABLE variants (
  id serial PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  color text NOT NULL,
  size text NOT NULL,
  stock integer NOT NULL DEFAULT 0,
  UNIQUE (product_id, color, size)
);

CREATE TABLE barcodes (
  code text PRIMARY KEY,
  variant_id integer NOT NULL REFERENCES variants(id) ON DELETE CASCADE
);
CREATE INDEX barcodes_variant_idx ON barcodes (variant_id);

ALTER TABLE orders ADD COLUMN channel text NOT NULL DEFAULT 'online' CHECK (channel IN ('online', 'store'));
ALTER TABLE orders ADD COLUMN discount_total integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN due_date date;
ALTER TABLE orders DROP CONSTRAINT orders_pay_check;
ALTER TABLE orders ADD CONSTRAINT orders_pay_check CHECK (pay IN ('cash', 'card', 'mixed', 'credit'));
CREATE INDEX orders_channel_idx ON orders (channel, created_at DESC);

ALTER TABLE order_items ADD COLUMN variant_id integer REFERENCES variants(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN base_price integer;

CREATE TABLE payments (
  id serial PRIMARY KEY,
  order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('cash', 'card')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_order_idx ON payments (order_id);
CREATE INDEX payments_created_idx ON payments (created_at);

CREATE TABLE stock_moves (
  id serial PRIMARY KEY,
  variant_id integer NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  qty integer NOT NULL,
  reason text NOT NULL CHECK (reason IN ('intake', 'sale', 'cancel', 'adjust')),
  order_id integer REFERENCES orders(id) ON DELETE SET NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_moves_created_idx ON stock_moves (created_at DESC);

CREATE TABLE discounts (
  id serial PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('product', 'category')),
  target_id text NOT NULL,
  percent integer NOT NULL CHECK (percent BETWEEN 1 AND 90),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
