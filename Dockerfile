# Build stage
FROM node:22-alpine AS builder

ARG NPM_REGISTRY=https://registry.npmjs.org

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy dependency files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install dependencies
RUN npm config set registry ${NPM_REGISTRY} && \
    pnpm install --frozen-lockfile

# Copy source files
COPY . .

# Build application
RUN pnpm build

# Production stage
FROM node:22-slim AS production

# Set working directory
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy dependency files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install production dependencies only
RUN npm config set registry ${NPM_REGISTRY} && \
    pnpm install --prod --frozen-lockfile

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Create data directory
RUN mkdir -p /app/data

EXPOSE 5301
VOLUME [ "/app/data" ]

CMD ["node", "dist/index.js"]
