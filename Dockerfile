FROM node:20-slim

WORKDIR /app

# Install build essentials
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first (better Docker layer caching)
COPY package.json ./
COPY tsconfig.json ./

# Install dependencies fresh (no package-lock.json)
RUN npm cache clean --force && \
    npm install --no-package-lock --verbose

# Copy and build source
COPY src ./src
RUN npm run build

# Verify build succeeded
RUN test -f dist/agent-orchestrator.js || (echo "Build failed - agent-orchestrator.js missing" && exit 1)

# Copy web-ui
COPY web-ui ./web-ui

# Fix web-ui dependencies and install
WORKDIR /app/web-ui
RUN sed -i '/\"dax-catalog-mvp\":/d' package.json && \
    rm -f package-lock.json && \
    npm cache clean --force && \
    npm install --production --no-package-lock --verbose

# Return to app root - DO NOT copy dist files to web-ui
WORKDIR /app

# Create runtime directories
RUN mkdir -p runs tmp-uploads web-ui/runs web-ui/tmp-uploads

# Verify server can start (import test)
RUN node -e "const orch = require('./dist/agent-orchestrator'); console.log('AgentOrchestrator loaded:', Object.keys(orch));"

EXPOSE 5001
ENV PORT=5001
ENV UI_PORT=5001
ENV NODE_ENV=production

CMD ["node", "web-ui/server.js"]