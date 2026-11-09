# TeamFlow API — production image (multi-stage, non-root, no devDeps)
FROM node:22-alpine AS builder
RUN apk add --no-cache openssl libc6-compat python3 make g++
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY prisma ./prisma
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM node:22-alpine AS runner
RUN apk add --no-cache openssl curl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json /app/package-lock.json* ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh && adduser -D -H appuser && mkdir -p /data/uploads && chown -R appuser /app /data/uploads
ENV UPLOAD_DIR=/data/uploads
USER appuser
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:4000/api/healthz || exit 1
ENTRYPOINT ["./docker-entrypoint.sh"]
