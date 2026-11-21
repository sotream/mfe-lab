CREATE TABLE flags (
  name text PRIMARY KEY,
  enabled boolean NOT NULL,
  description text NOT NULL
);

INSERT INTO flags (name, enabled, description) VALUES
  ('dashboard.revenue', true, 'Show the Revenue by status section'),
  ('products.detailPage', true, 'Link product names to the detail page'),
  ('products.crash', false, 'Make ProductsPage throw on render (error tracking demo)')
ON CONFLICT DO NOTHING;
