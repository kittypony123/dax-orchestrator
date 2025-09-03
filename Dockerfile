# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder
WORKDIR /app

# Install all dependencies including devDependencies for TypeScript compilation
COPY package*.json ./
RUN npm ci

# Copy source files for compilation
COPY tsconfig.json ./
COPY src ./src

# Build the TypeScript project
RUN npm run build

# Install web-ui dependencies
COPY web-ui/package*.json ./web-ui/
RUN cd web-ui && npm ci --omit=dev


FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install wget for health checks
RUN apk add --no-cache wget

# Install only production dependencies for runtime
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy compiled code and web-ui files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/web-ui/node_modules ./web-ui/node_modules
COPY web-ui ./web-ui

# Create necessary runtime directories
RUN mkdir -p /app/runs /app/tmp-uploads

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5001/api/health || exit 1

EXPOSE 5001
ENV UI_PORT=5001
CMD ["node", "web-ui/server.js"]
