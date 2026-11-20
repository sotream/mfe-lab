# Build: install, build all apps, and deploy the API's production deps.
FROM node:26-slim AS build
# Node 26 no longer bundles corepack.
RUN npm install -g corepack && corepack enable
WORKDIR /repo
COPY . .
RUN corepack install && pnpm install --frozen-lockfile && pnpm build \
  && pnpm --filter @mfe/api deploy --prod /out/api

FROM node:26-slim AS api
ENV NODE_ENV=production HOST=0.0.0.0 DB_PATH=/data/app.db
WORKDIR /app
COPY --from=build /out/api .
# Seeding is idempotent: it skips when users already exist.
CMD ["sh", "-c", "node src/seed.ts && node src/server.ts"]

FROM nginx:alpine AS web
ARG APP
ENV PORT=3000
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/${APP}/dist /usr/share/nginx/html
