CREATE TABLE errors (
  id INTEGER PRIMARY KEY,
  remote TEXT NOT NULL,
  build TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  url TEXT NOT NULL,
  at TEXT NOT NULL
);
