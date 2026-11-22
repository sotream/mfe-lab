import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { BlockList, isIP } from 'node:net';
import { isDemo } from './guards.ts';
import { hashPassword, verifyPassword } from './password.ts';
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

  const recordFailure = (id: number) =>
    app.db.query(
      `update users set failed_attempts = failed_attempts + 1,
         locked_until = case when failed_attempts + 1 >= ${MAX_FAILURES}
           then now() + interval '${LOCK_MINUTES} minutes' else locked_until end
       where id = $1`,
      [id],
    );

  // The step is stored atomically: a code (or an older one) can be used only once.
  // Counts a failure; resets the counters on success.
  const acceptOtp = async (id: number, otp: string): Promise<boolean> => {
    const step = verifyTotp(process.env.SUPERADMIN_TOTP_SECRET!, otp.trim());
    const fresh =
      step !== null &&
      (
        await app.db.query(
          'update users set totp_last_step = $1 where id = $2 and (totp_last_step is null or totp_last_step < $1) returning id',
          [step, id],
        )
      ).length > 0;
    if (!fresh) {
      await recordFailure(id);
      return false;
    }
    await app.db.query('update users set failed_attempts = 0, locked_until = null where id = $1', [
      id,
    ]);
    return true;
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
      const [user] = await app.db.query<UserRow>(
        'select id, email, password_hash, role, locked_until from users where lower(email) = lower($1)',
        [request.body.email],
      );
      const owner = user?.role === 'superadmin';
      // The owner account is refused with the generic error when its env is missing, the
      // caller IP is not allowed, or it is locked. scrypt still runs, so timing does not differ.
      const refused = owner && ownerRefused(user, request.ip);
      const passwordOk = await verifyPassword(
        request.body.password,
        user?.password_hash ?? (await getDummyHash()),
      );
      if (!user || refused || !passwordOk) {
        if (owner && !refused) await recordFailure(user.id);
        return invalid();
      }

      if (owner) {
        if (!request.body.otp) return reply.code(401).send({ error: 'otp_required' });
        if (!(await acceptOtp(user.id, request.body.otp))) return invalid();
      }

      const token = app.jwt.sign({ sub: user.id, role: user.role, email: user.email });
      return { token, user: publicUser(user) };
    },
  );

  app.get('/auth/me', { preHandler: authenticate }, (request) => {
    const { sub, email, role } = request.user;
    return { user: publicUser({ id: sub, email, role }) };
  });
}
