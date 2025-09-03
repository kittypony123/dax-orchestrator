FROM node:22-alpine

WORKDIR /app

# Copy package files for dependency caching
COPY package*.json ./
RUN echo "=== Installing root dependencies ===" && npm ci

# Copy and build main project
COPY tsconfig.json ./
COPY src ./src
RUN echo "=== Building TypeScript ===" && npm run build

# Copy entire web-ui directory to avoid path issues
COPY web-ui ./web-ui

# Install web-ui dependencies
WORKDIR /app/web-ui
RUN echo "=== Installing web-ui dependencies ===" && npm install --omit=dev --verbose

# Back to root and clean up
WORKDIR /app
RUN npm prune --omit=dev

# Create runtime directories
RUN mkdir -p runs tmp-uploads

# Debug: Verify all files are present
RUN echo "=== Web-UI Directory Structure ===" && find web-ui -type f -name "*.html" -o -name "*.js" -o -name "*.css" | head -10

EXPOSE 5001
ENV PORT=5001
ENV UI_PORT=5001
ENV NODE_ENV=production

CMD ["node", "web-ui/server.js"]
