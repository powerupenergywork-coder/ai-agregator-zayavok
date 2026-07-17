# Build context is the repo root (npm workspaces monorepo) — see
# docker-compose.prod.yml's `build.context: .` / `build.dockerfile`.

FROM node:22-alpine AS builder
WORKDIR /app
# Prisma's query engine needs a real OpenSSL on Alpine (musl doesn't ship
# libssl) — without this it silently guesses the wrong engine target and
# fails to connect at runtime instead of at build time.
RUN apk add --no-cache openssl

# Workspace package.json files must all be present for `npm ci` to resolve
# package-lock.json's workspace tree, even though this image only needs api+shared.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w packages/shared
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
RUN npm run build -w apps/api

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/api ./apps/api

WORKDIR /app/apps/api
EXPOSE 3001
# migrate deploy is non-interactive-safe (unlike migrate dev) — see README's
# note on why `prisma migrate dev` can't run in a non-TTY environment.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
