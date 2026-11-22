# Build: install, build all apps, and deploy the API's production deps.
FROM node:26-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS build
# Node 26 no longer bundles corepack.
RUN npm install -g corepack && corepack enable
WORKDIR /repo
COPY . .
RUN corepack install && pnpm install --frozen-lockfile && pnpm build \
  && pnpm --filter @mfe/api deploy --prod /out/api

FROM node:26-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS api
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /out/api .
# The canary allowlist (deploy/canary.ts) is imported from outside the app dir: ../../../deploy from /app/src.
COPY --from=build /repo/deploy /deploy
# Not root: the image ships a `node` user. DATABASE_URL comes from the environment. Migrating and seeding are idempotent.
USER node
CMD ["sh", "-c", "node src/db.ts && node src/seed.ts && node src/server.ts"]

FROM nginx:alpine@sha256:fb4658584bd9a916ffb6f6e365f97c25cfdb2923801f551ea08356e695f14ff7 AS web
ARG APP
ENV PORT=3000
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/${APP}/dist /usr/share/nginx/html
