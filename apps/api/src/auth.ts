import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { verifyPassword } from './password.ts';

export type Role = 'admin' | 'editor' | 'viewer';
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

const loginBody = z.object({ email: z.email(), password: z.string().min(1) });

type UserRow = { id: number; email: string; password_hash: string; role: Role };

// Explicit secret wins, then JWT_SECRET. Without one: dev fallback with a warning,
// startup error in production.
function resolveSecret(app: FastifyInstance, explicit?: string): string {
  const secret = explicit || process.env.JWT_SECRET;
  if (secret) return secret;
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

  const findUser = (id: number) =>
    app.db.prepare('select id, email, role from users where id = ?').get(id) as
      Omit<UserRow, 'password_hash'> | undefined;

  // Every failure (missing/malformed/forged/expired token, deleted user) is the same 401.
  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const user = typeof request.user.sub === 'number' ? findUser(request.user.sub) : undefined;
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
    if (!roles.includes(request.user.role)) return reply.code(403).send({ error: 'forbidden' });
  });

  // ponytail: no rate limit on login, so passwords can be brute-forced; add @fastify/rate-limit
  // before this ever faces a network.
  // ponytail: an unknown email returns before scrypt runs, so response timing reveals whether
  // an account exists; hash a dummy password on that path to equalize.
  app.post('/auth/login', async (request, reply) => {
    const body = loginBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues });

    const user = app.db
      .prepare('select id, email, password_hash, role from users where email = ?')
      .get(body.data.email) as UserRow | undefined;
    if (!user || !(await verifyPassword(body.data.password, user.password_hash))) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }

    const token = app.jwt.sign({ sub: user.id, role: user.role, email: user.email });
    return { token, user: { id: user.id, email: user.email, role: user.role } };
  });

  app.get('/auth/me', { preHandler: authenticate }, (request) => {
    const { sub, email, role } = request.user;
    return { user: { id: sub, email, role } };
  });
}
