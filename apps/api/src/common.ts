import { z } from 'zod';

export const errorBody = z.object({ error: z.string() });

export const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export const idParams = z.object({ id: z.coerce.number().int().min(1) });

export const paged = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
  });

// Standard error responses shown in the OpenAPI document.
type ErrorCode = 400 | 401 | 403 | 404 | 409;
export const errors = <C extends ErrorCode>(...codes: C[]) =>
  Object.fromEntries(codes.map((c) => [c, errorBody])) as { [K in C]: typeof errorBody };
