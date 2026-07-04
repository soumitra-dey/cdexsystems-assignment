# CEDX Tiny Agent Fleet — Node.js + TypeScript build.
# HARD RULE: the graded path runs with ONE command on a fresh, network-restricted
# machine: `docker compose up`. Pinned to linux/amd64 so it builds identically.
# verify_audit.py is Python, so the image needs BOTH node and python3+jsonschema.
FROM --platform=linux/amd64 node:20-slim

WORKDIR /app

# make + python3 (for verify_audit.py) + pip via venv.
RUN apt-get update && apt-get install -y --no-install-recommends \
        make python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir jsonschema

ENV PATH="/opt/venv/bin:$PATH"

# Install Node deps (network available at BUILD time; runtime is offline via REPLAY).
COPY package.json ./
COPY tsconfig.json ./
RUN npm install --no-audit --no-fund

# Copy the rest of the project (seed/, src/, verify_audit.py, Makefile, schema).
COPY . .

# Offline replay is the default graded path. Graders flip REPLAY_LLM=false + a key
# for the held-out run, and swap the seed via SEED_DIR.
ENV REPLAY_LLM=true
ENV SEED_DIR=/app/seed
ENV CASE_ID=CEDX-33ACA8
ENV PIPELINE_NOW=2026-06-26

# Produce /app/out/<package>, /app/out/audit.json, /app/out/exception_queue.json
# and self-verify.
CMD ["sh", "-c", "make demo && make verify"]