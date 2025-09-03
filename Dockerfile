# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder
WORKDIR /app

# Root dependencies and build
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Preinstall UI dependencies to cache layer
COPY web-ui/package*.json ./web-ui/
RUN cd web-ui && npm ci --omit=dev


FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install production deps for orchestrator runtime
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built orchestrator and UI
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/web-ui/node_modules ./web-ui/node_modules
COPY web-ui ./web-ui

# Runtime directories
RUN mkdir -p /app/runs /app/tmp-uploads

EXPOSE 5001
ENV UI_PORT=5001
CMD ["node", "web-ui/server.js"]

