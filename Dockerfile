FROM node:20-alpine

WORKDIR /app

# Copy everything first 
COPY . .

# Install main project dependencies and build
RUN npm ci
RUN npm run build

# Install web-ui dependencies (this will handle the file:.. dependency correctly)
WORKDIR /app/web-ui  
RUN npm ci --omit=dev

# Go back to app root
WORKDIR /app

# Create necessary directories
RUN mkdir -p runs tmp-uploads

# Remove dev dependencies from root to save space
RUN npm prune --omit=dev

EXPOSE 5001
ENV PORT=5001
ENV UI_PORT=5001
ENV NODE_ENV=production

CMD ["node", "web-ui/server.js"]
