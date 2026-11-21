CREATE TABLE users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'editor', 'viewer'))
);

CREATE TABLE products (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  stock integer NOT NULL CHECK (stock >= 0),
  created_at timestamptz NOT NULL
);

CREATE TABLE orders (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id integer NOT NULL REFERENCES products(id),
  qty integer NOT NULL CHECK (qty > 0),
  status text NOT NULL CHECK (status IN ('new', 'paid', 'shipped')),
  created_at timestamptz NOT NULL
);

CREATE INDEX orders_created_at_idx ON orders (created_at);
