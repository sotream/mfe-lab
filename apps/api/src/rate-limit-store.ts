import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from './db.ts';

// Custom @fastify/rate-limit store: one row per key in Postgres, so every serverless instance
// counts against the same window. The plugin does `new Store(globalParams)` once and calls
// `child(routeOptions)` per route; only `incr` is needed (no `read`/`decr`: no route uses
// `increment: false` or `refund`).
//
// Privacy: the stored key is sha256(key + salt) cut to 32 hex chars, so no raw IP (or user id)
// sits in the table; the salt is the JWT secret, so the hashes cannot be brute-forced from the
// small IPv4 space without it. Rows live for one window and are pruned opportunistically.
const hash = (key: string, salt: string) =>
  createHash('sha256')
    .update(key + salt)
    .digest('hex')
    .slice(0, 32);

// Atomic: a fresh key starts at 1; an expired row restarts at 1 with a new window; a live row
// increments. ttl is the milliseconds left in the window.
const INCR = `
  insert into rate_limits as r (key, count, reset_at)
  values ($1, 1, now() + $2::int * interval '1 millisecond')
  on conflict (key) do update set
    count = case when r.reset_at <= now() then 1 else r.count + 1 end,
    reset_at = case when r.reset_at <= now() then excluded.reset_at else r.reset_at end
  returning count, (extract(epoch from (reset_at - now())) * 1000)::int as ttl`;

// Housekeeping: on ~1% of calls, drop rows expired for over an hour. No cron, no extra table scan
// on the hot path; stale rows are harmless (an expired row is restarted by INCR).
const PRUNE = `delete from rate_limits where reset_at < now() - interval '1 hour'`;

type Cb = (err: Error | null, res?: { current: number; ttl: number }) => void;

export function pgRateLimitStore(db: Db, salt: string, log: FastifyBaseLogger) {
  return class PgRateLimitStore {
    incr(key: string, cb: Cb, timeWindow: number) {
      db.query<{ count: number; ttl: number }>(INCR, [hash(key, salt), timeWindow]).then(
        ([row]) => cb(null, { current: row!.count, ttl: row!.ttl }),
        (e: Error) => {
          // The plugin runs with skipOnError, so this request is allowed (fail open).
          log.warn({ err: e.message }, 'rate-limit store failed, request allowed');
          cb(e);
        },
      );
      if (Math.random() < 0.01) db.query(PRUNE).catch(() => {});
    }
    child() {
      return this;
    }
  };
}
