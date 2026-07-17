# Build context is the repo root (npm workspaces monorepo) — see
# docker-compose.prod.yml's `build.context: .` / `build.dockerfile`.

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

# Next.js inlines NEXT_PUBLIC_* vars into the client bundle at build time —
# has to be an ARG/ENV here, setting it at container runtime is too late.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w packages/shared
RUN npm run build -w apps/web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/web ./apps/web

WORKDIR /app/apps/web
EXPOSE 3000
CMD ["npm", "run", "start"]
