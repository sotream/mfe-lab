import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { BlockList, isIP } from 'node:net';
import { isDemo } from './guards.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { upsertEnvAccount } from './seed.ts';
import { verifyTotp } from './totp.ts';

// 'superadmin' is the owner account: seeded from env only, needs a TOTP code, passes every
// check 'admin' passes plus the destructive ones the public demo admin is denied.
export type Role = 'superadmin' | 'admin' | 'editor' | 'viewer';
type AuthUser = { sub: number; role: Role; email: string };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (
      ...roles: Role[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const TOKEN_TTL_SECONDS = 15 * 60;
const DEV_SECRET = 'dev-only-insecure-secret-change-me';

const loginBody = z.object({
  email: z.email(),
  password: z.string().min(1),
  otp: z.string().max(16).optional(),
});

type UserRow = {
  id: number;
  email: string;
  password_hash: string;
  role: Role;
  locked_until: string | null;
};

const ownerRefused = (user: UserRow, ip: string): boolean =>
  !process.env.SUPERADMIN_TOTP_SECRET ||
  !ipAllowed(ip) ||
  (user.locked_until !== null && new Date(user.locked_until) > new Date());

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

// Verified when the email is unknown, so an unknown account costs the same scrypt time as a known one.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword('dummy-password-for-timing'));

// SUPERADMIN_IP_ALLOWLIST: CSV of IPs/CIDRs; unset means no restriction. request.ip comes from
// x-forwarded-for only when trustProxy is on (app.ts sets it on Vercel, which overwrites the header,
// so a client cannot spoof it there). Anywhere else the header is ignored.
const parseList = (csv: string): BlockList => {
  const list = new BlockList();
  for (const item of csv.split(',')) {
    const [addr = '', prefix] = item.trim().split('/');
    const family = isIP(addr);
    if (!family) continue;
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) list.addAddress(addr, type);
    else list.addSubnet(addr, Number(prefix), type);
  }
  return list;
};

function ipAllowed(ip: string): boolean {
  const csv = process.env.SUPERADMIN_IP_ALLOWLIST?.trim();
  if (!csv) return true;
  const plain = ip.replace(/^::ffff:/, '');
  const family = isIP(plain);
  return family !== 0 && parseList(csv).check(plain, family === 4 ? 'ipv4' : 'ipv6');
}

// Explicit secret wins, then JWT_SECRET. Without one: dev fallback with a warning,
// startup error in production.
function resolveSecret(app: FastifyInstance, explicit?: string): string {
  const secret = explicit || process.env.JWT_SECRET;
  if (secret) {
    if (process.env.NODE_ENV === 'production' && Buffer.byteLength(secret) < 32) {
      throw new Error('JWT_SECRET must be at least 32 bytes in production');
    }
    return secret;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  app.log.warn('JWT_SECRET is not set: using an insecure dev-only secret');
  return DEV_SECRET;
}

// Registered directly on the root instance, so the decorators are visible to every route.
export async function registerAuth(app: FastifyInstance, opts: { jwtSecret?: string }) {
  await app.register(jwt, {
    secret: resolveSecret(app, opts.jwtSecret),
    sign: { algorithm: 'HS256', expiresIn: TOKEN_TTL_SECONDS },
    verify: { algorithms: ['HS256'] },
  });

  const findUser = async (id: number) =>
    (
      await app.db.query<Omit<UserRow, 'password_hash'>>(
        'select id, email, role from users where id = $1',
        [id],
      )
    )[0];

  // Every failure (missing/malformed/forged/expired token, deleted user) is the same 401.
  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const user =
        typeof request.user.sub === 'number' ? await findUser(request.user.sub) : undefined;
      if (!user) throw new Error('unknown user');
      // The DB is the source of truth for role and email, not the token.
      request.user = { sub: user.id, role: user.role, email: user.email };
    } catch {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  };

  app.decorate('authenticate', authenticate);
  app.decorate('requireRole', (...roles: Role[]) => async (request, reply) => {
    await authenticate(request, reply);
    if (reply.sent) return;
    const { role } = request.user;
    // superadmin passes everything admin passes.
    if (!roles.includes(role) && !(role === 'superadmin' && roles.includes('admin'))) {
      return reply.code(403).send({ error: 'forbidden' });
    }
  });

  // Count first, decide after: one atomic update takes an attempt slot and sets the lock when the
  // MAX_FAILURES-th one is taken. No row back means the account was already locked, so parallel
  // requests share at most MAX_FAILURES guesses per window. An expired lock starts a new window.
  const claimAttempt = async (id: number): Promise<boolean> => {
    const next = 'case when locked_until is not null then 1 else failed_attempts + 1 end';
    const rows = await app.db.query(
      `update users set failed_attempts = ${next},
         locked_until = case when ${next} >= ${MAX_FAILURES} then now() + interval '${LOCK_MINUTES} minutes' end
       where id = $1 and (locked_until is null or locked_until <= now())
       returning failed_attempts, locked_until`,
      [id],
    );
    return rows.length > 0;
  };

  // True when the owner account must be refused: env, IP or a stale read says no, or the counted attempt hit the lock.
  const ownerGate = async (user: UserRow, ip: string, counted: boolean): Promise<boolean> =>
    ownerRefused(user, ip) || (counted && !(await claimAttempt(user.id)));

  // The step is stored atomically: a code (or an older one) can be used only once.
  // Success resets the counters; the attempt itself was counted by claimAttempt.
  const acceptOtp = async (id: number, otp?: string): Promise<'ok' | 'missing' | 'bad'> => {
    if (!otp) return 'missing';
    const step = verifyTotp(process.env.SUPERADMIN_TOTP_SECRET!, otp.trim());
    const fresh =
      step !== null &&
      (
        await app.db.query(
          `update users set totp_last_step = $1, failed_attempts = 0, locked_until = null
           where id = $2 and (totp_last_step is null or totp_last_step < $1) returning id`,
          [step, id],
        )
      ).length > 0;
    return fresh ? 'ok' : 'bad';
  };

  // Same shape for login and /auth/me. demo: the UI must not guess whether the lock is on.
  const publicUser = (u: { id: number; email: string; role: Role }) => ({
    id: u.id,
    email: u.email,
    role: u.role,
    demo: isDemo(u.role),
  });

  app.withTypeProvider<ZodTypeProvider>().post(
    '/auth/login',
    {
      // Per IP, counted in Postgres across instances (see guards.ts).
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { tags: ['auth'], body: loginBody, security: [] },
    },
    async (request, reply) => {
      const invalid = () => reply.code(401).send({ error: 'invalid_credentials' });
      // Env-provisioned account: make sure its row exists and matches env, only for its own email.
      await upsertEnvAccount(app.db, request.body.email);
      const [user] = await app.db.query<UserRow>(
        'select id, email, password_hash, role, locked_until from users where lower(email) = lower($1)',
        [request.body.email],
      );
      const owner = user?.role === 'superadmin';
      // The owner account is refused with the generic error when its env is missing, the
      // caller IP is not allowed, or it is locked. scrypt still runs, so timing does not differ.
      // A guess with a code is counted before it is checked; a password-only attempt (the first step
      // of the two-step login) is counted only when the password is wrong.
      const counted = owner && !!request.body.otp;
      const refused = owner && (await ownerGate(user, request.ip, counted));
      const passwordOk = await verifyPassword(
        request.body.password,
        user?.password_hash ?? (await getDummyHash()),
      );
      if (!user || refused || !passwordOk) {
        if (owner && !refused && !counted) await claimAttempt(user.id);
        return invalid();
      }

      const otp = owner ? await acceptOtp(user.id, request.body.otp) : 'ok';
      if (otp === 'missing') return reply.code(401).send({ error: 'otp_required' });
      if (otp === 'bad') return invalid();

      const token = app.jwt.sign({ sub: user.id, role: user.role, email: user.email });
      return { token, user: publicUser(user) };
    },
  );

  app.get('/auth/me', { preHandler: authenticate }, (request) => {
    const { sub, email, role } = request.user;
    return { user: publicUser({ id: sub, email, role }) };
  });
}
