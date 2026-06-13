FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

RUN npm install

COPY apps/web ./apps/web
COPY packages/shared ./packages/shared

WORKDIR /app/apps/web
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV production

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/package.json ./apps/web/

EXPOSE 3000
CMD ["npm", "run", "start:web"]
