FROM node:20-slim

# Security: minimal system deps only
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*    # shrink image layer

# Install Claude Code globally
RUN npm install -g @anthropic-ai/claude-code

# Security: non-root user (UID 1001 matches compose expectations)
RUN useradd -m -s /bin/bash -u 1001 claude \
    && mkdir -p /home/claude/project \
    && chown -R claude:claude /home/claude

USER claude
WORKDIR /home/claude/project

CMD ["claude"]
