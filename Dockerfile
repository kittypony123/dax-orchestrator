# Use single stage to avoid complexity
FROM node:20-alpine

# Install wget and build tools
RUN apk add --no-cache wget

WORKDIR /app

# Copy and install all dependencies (including dev for build)
COPY package*.json ./
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Copy web-ui files
COPY web-ui ./web-ui
RUN cd web-ui && npm ci --omit=dev

# Create runtime directories
RUN mkdir -p /app/runs /app/tmp-uploads

# Cleanup dev dependencies to reduce image size
RUN npm prune --omit=dev

EXPOSE 5001
ENV UI_PORT=5001
ENV NODE_ENV=production

CMD ["node", "web-ui/server.js"]
