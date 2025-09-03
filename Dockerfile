FROM node:20-alpine

WORKDIR /app

# Copy package files first for dependency installation
COPY package*.json ./
COPY web-ui/package*.json ./web-ui/

# Install dependencies
RUN npm ci
RUN cd web-ui && npm ci --omit=dev

# Copy source code and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Copy web-ui files explicitly to ensure they're included
COPY web-ui/server.js ./web-ui/
COPY web-ui/public ./web-ui/public

# Create necessary directories
RUN mkdir -p runs tmp-uploads

# Remove dev dependencies from root to save space
RUN npm prune --omit=dev

# Verify files are copied (for debugging)
RUN ls -la web-ui/public/

EXPOSE 5001
ENV PORT=5001
ENV UI_PORT=5001
ENV NODE_ENV=production

CMD ["node", "web-ui/server.js"]
