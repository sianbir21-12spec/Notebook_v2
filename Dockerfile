# syntax=docker/dockerfile:1

# -----------------------------------------------------------------------------
# CampusConnect - Production Dockerfile
# Optimized for Google Cloud Run, AWS ECS, Kubernetes, and Docker hosts
# -----------------------------------------------------------------------------

FROM node:20-alpine AS runner

# Label metadata
LABEL maintainer="CampusConnect"
LABEL description="Real-time School Friend Group Chat Application"

# Create application directory
WORKDIR /app

# Install curl for container health checks
RUN apk add --no-cache curl

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Copy package descriptors first to leverage Docker layer caching
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev --ignore-scripts

# Copy application code and static assets
COPY . .

# Ensure proper permissions for the non-root node user
RUN chown -R node:node /app

# Switch to non-root user for security best practices
USER node

# Expose default application port
EXPOSE 3000

# Container healthcheck using the /api/health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Start the Node.js Express & Socket.IO server
CMD ["node", "server.js"]
