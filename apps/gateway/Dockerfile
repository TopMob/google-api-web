FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
COPY apps/gateway/package.json ./apps/gateway/
COPY packages/shared/package.json ./packages/shared/

RUN npm install

COPY apps/gateway ./apps/gateway
COPY packages/shared ./packages/shared

WORKDIR /app/apps/gateway
RUN npm run build

EXPOSE 8081
CMD ["npm", "start"]
