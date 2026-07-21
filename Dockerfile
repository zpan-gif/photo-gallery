# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install ALL deps (including devDependencies needed for the build)
RUN npm ci

# Copy source
COPY . .

# Build: Vite bundles the React frontend into dist/
#         esbuild bundles server.ts into dist/server.cjs
RUN npm run build

# ─── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

# Install only production dependencies in the final image
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the compiled output from the builder stage
COPY --from=builder /app/dist ./dist

# Expose the port the Express server listens on
EXPOSE 3000

# Runtime environment (override these via docker run -e or docker-compose)
ENV NODE_ENV=production
ENV PORT=3000

# Start the compiled server
CMD ["node", "dist/server.cjs"]
