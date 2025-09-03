FROM node:20-slim

WORKDIR /app

# Install build essentials (needed for npm packages that require compilation)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies with clean cache
RUN npm cache clean --force && \
    npm install --verbose

# Copy and build source
COPY src ./src
RUN npm run build

# Copy web-ui
COPY web-ui ./web-ui

# Fix and install web-ui dependencies
WORKDIR /app/web-ui
RUN sed -i '/\"dax-catalog-mvp\":/d' package.json && \
    rm -f package-lock.json && \
    npm cache clean --force && \
    npm install --production --verbose

# Setup runtime environment
WORKDIR /app
RUN cp -r dist/* web-ui/ 2>/dev/null || true && \
    mkdir -p runs tmp-uploads web-ui/runs web-ui/tmp-uploads

EXPOSE 5001
ENV PORT=5001
ENV UI_PORT=5001
ENV NODE_ENV=production

CMD ["node", "web-ui/server.js"]
