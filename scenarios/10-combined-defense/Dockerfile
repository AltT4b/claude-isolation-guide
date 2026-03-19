FROM node:20-slim

# -- Security: run as non-root -------------------------------------------------
RUN groupadd --gid 1001 claude && \
    useradd  --uid 1001 --gid claude --shell /bin/bash --create-home claude

# -- System deps (curl for verify.js network tests) ----------------------------
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# -- App setup -----------------------------------------------------------------
WORKDIR /home/claude/project

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts

COPY . .

RUN chown -R claude:claude /home/claude/project

# -- Drop to non-root ----------------------------------------------------------
USER claude

CMD ["npm", "test"]
