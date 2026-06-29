# ══════════════════════════════════════════════════════════════════
# OpenSCAD Studio API — Dockerfile
#
# Builds a production Docker image that:
#   1. Installs OpenSCAD on Ubuntu 22.04
#   2. Installs Xvfb (virtual framebuffer — required for headless STL export)
#   3. Installs Node.js 20 LTS
#   4. Runs the Express API server
#
# Deploy this image to Render as a Web Service (Docker runtime).
# Render automatically injects the $PORT environment variable.
# ══════════════════════════════════════════════════════════════════

FROM ubuntu:22.04

# ── Prevent interactive apt prompts ───────────────────────────────
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
# Set to "false" only when running locally without Xvfb (e.g. macOS)
ENV USE_XVFB=true

# ── System packages: OpenSCAD + Xvfb ──────────────────────────────
# openscad    – the 3D compiler
# xvfb        – virtual X display (required for headless STL export)
# curl        – needed to fetch the NodeSource setup script
# ca-certificates – HTTPS trust for the NodeSource script
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        openscad \
        xvfb \
        curl \
        ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ── Node.js 20 LTS (via NodeSource) ───────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# ── App ───────────────────────────────────────────────────────────
WORKDIR /app

# Copy dependency manifest first for layer caching
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# Copy application source
COPY server.js ./

# Render injects $PORT at runtime; we listen on 0.0.0.0:$PORT
EXPOSE 3000

# Start the API server
CMD ["node", "server.js"]
