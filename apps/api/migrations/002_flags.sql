CREATE TABLE flags (
  name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL,
  description TEXT NOT NULL
);

INSERT OR IGNORE INTO flags (name, enabled, description) VALUES
  ('dashboard.revenue', 1, 'Show the Revenue by status section'),
  ('products.detailPage', 1, 'Link product names to the detail page'),
  ('products.crash', 0, 'Make ProductsPage throw on render (error tracking demo)');
