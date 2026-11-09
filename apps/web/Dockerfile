# TeamFlow Web — Next.js standalone production image
FROM node:22-alpine AS builder
WORKDIR /app
# Rewrites are inlined at build time, so the target must be known now.
# Compose passes the in-network URL (http://api:4000) by default.
ARG BACKEND_URL=http://api:4000
ENV BACKEND_URL=$BACKEND_URL
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN adduser -D -H webuser
COPY --from=builder /app/public ./public
COPY --from=builder --chown=webuser /app/.next/standalone ./
COPY --from=builder --chown=webuser /app/.next/static ./.next/static
USER webuser
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/login > /dev/null || exit 1
CMD ["node", "server.js"]
