# ══════════════════════════════════════════════════════════════════
# OpenSCAD Studio API — Dockerfile
#
# Builds a production Docker image that:
#   1. Installs Node.js 20 LTS (via NodeSource)
#   2. Installs OpenSCAD (Ubuntu 22.04 repos)
#   3. Installs Xvfb — virtual X display required for headless STL export
#   4. Pre-warms the system font cache so OpenSCAD doesn't crash on first run
#   5. Runs the Express API server
#
# Render configuration:
#   Root Directory:     openscad-studio
#   Dockerfile Path:    api/Dockerfile
#   Docker Build Context: api
#   Health Check Path:  /health
# ══════════════════════════════════════════════════════════════════

FROM ubuntu:22.04

# Prevent interactive apt prompts (timezone selection etc.)
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
# Set USE_XVFB=false only when running locally on macOS/Windows (no Xvfb needed)
ENV USE_XVFB=true

# ── Install everything in one layer ───────────────────────────────
# We must install curl+ca-certificates first, then run the NodeSource
# setup script (which modifies apt sources), then install the rest —
# all in a single RUN to keep the apt cache valid throughout and
# produce a single cacheable layer with a clean /var/lib/apt/lists.
#
# Extra packages beyond the obvious:
#   libglu1-mesa      – OpenGL utility library; OpenSCAD needs it for
#                       geometry operations even when exporting STL
#   fonts-liberation  – Provides common fonts so OpenSCAD can build its
#                       font cache without errors on first compile
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends \
        nodejs \
        openscad \
        xvfb \
        libglu1-mesa \
        fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

# Pre-warm the system font cache.
# Without this, OpenSCAD regenerates it on every cold compile,
# which can add several seconds and occasionally causes silent crashes
# in a minimal Docker environment.
RUN fc-cache -f

# ── Node app ──────────────────────────────────────────────────────
WORKDIR /app

# Copy only the manifest first so Docker caches the npm install layer
# independently of source changes.
# We use "npm install --omit=dev" instead of "npm ci" because there is
# no package-lock.json in the repository.  --omit=dev is the modern
# replacement for the deprecated --only=production flag.
COPY package.json ./
RUN npm install --omit=dev

# Copy application source (after npm install to preserve cache)
COPY server.js ./

# Render injects $PORT at runtime; server.js reads process.env.PORT
# and binds to 0.0.0.0 — both required by Render.
EXPOSE 3000

CMD ["node", "server.js"]
