# syntax=docker/dockerfile:1.7
# COBRA on Demand: one image for the web app (Cloud Run service) and the
# migrate / jobs commands (Cloud Run jobs).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/billing/package.json packages/billing/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/integrations/package.json packages/integrations/
COPY packages/notices/package.json packages/notices/
COPY packages/rules/package.json packages/rules/
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Tooling image for Cloud Run jobs: `npm run db:migrate`, `npm run job -- all`.
FROM build AS tools
ENV NODE_ENV=production
USER node
CMD ["npm", "run", "db:migrate"]

# The web stage is last so a plain `docker build` (and Cloud Run's
# "deploy from repository") produces the web app.
# Runtime: Next.js standalone server plus migrations.
FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
ENV MIGRATIONS_DIR=/app/packages/db/drizzle
RUN groupadd --system app && useradd --system --gid app app
COPY --from=build --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /app/apps/web/public ./apps/web/public
COPY --from=build --chown=app:app /app/packages/db/drizzle ./packages/db/drizzle
USER app
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
