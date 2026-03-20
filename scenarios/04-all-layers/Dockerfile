FROM node:20-slim

# Layer 2 dependencies: bubblewrap (sandbox) + socat (network proxy) + ripgrep (srt requirement)
# Layer 3 dependency: curl (for network enforcement tests)
RUN apt-get update && \
    apt-get install -y --no-install-recommends bubblewrap socat curl ripgrep && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

# Note: no non-root user. The container runs as root because Docker doesn't
# propagate cap_add to non-root effective capability sets, and bwrap needs
# SYS_ADMIN. Non-root isolation is handled by Layer 2 (SRT runs commands
# inside a restricted user namespace).

WORKDIR /home/claude/project

COPY 04-all-layers/package.json ./
RUN npm install

COPY lib/ /home/claude/lib/
COPY 04-all-layers/verify.js 04-all-layers/docker-compose.yml ./
COPY 04-all-layers/.claude/ .claude/
COPY 04-all-layers/.env.example ./

RUN mkdir -p secrets

CMD ["npm", "test"]
