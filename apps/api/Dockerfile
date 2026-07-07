# Multi-stage build for the Arbiter API (Cloud Run target).
# Build context is the monorepo root (arbiter/).
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @arbiter/api build
# pnpm deploy produces a self-contained, prod-only folder (dist + node_modules).
RUN pnpm --filter @arbiter/api deploy --prod --legacy /app

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
USER node
EXPOSE 4310
CMD ["node", "dist/main.js"]
