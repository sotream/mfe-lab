CREATE TABLE errors (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  remote text NOT NULL,
  build text NOT NULL,
  kind text NOT NULL,
  message text NOT NULL,
  stack text,
  url text NOT NULL,
  at timestamptz NOT NULL
);
