import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

const VALIDATION_CODES = {
  body: 'invalid_body',
  querystring: 'invalid_query',
  params: 'invalid_params',
} as const;

// One error shape for the whole API: { error: <code> }. Internals only go to the log.
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const ctx = error.validationContext as keyof typeof VALIDATION_CODES | undefined;
      return reply.code(400).send({ error: (ctx && VALIDATION_CODES[ctx]) ?? 'invalid_body' });
    }
    if (error.statusCode === 429) return reply.code(429).send({ error: 'rate_limited' });
    const code = (error as { code?: string }).code ?? '';
    // Malformed JSON, wrong content type, oversized body.
    if (code.startsWith('FST_ERR_CTP_')) {
      return reply.code(error.statusCode ?? 400).send({ error: 'invalid_body' });
    }
    if (code === '23505' || code === '23503') {
      return reply.code(409).send({ error: 'conflict' });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'internal' });
  });
}
