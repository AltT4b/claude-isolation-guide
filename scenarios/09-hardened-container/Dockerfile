FROM node:20-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user with minimal permissions
RUN useradd -m -s /bin/bash -u 1001 claude \
    && mkdir -p /home/claude/project \
    && chown -R claude:claude /home/claude

USER claude
WORKDIR /home/claude/project

ENTRYPOINT ["claude"]
