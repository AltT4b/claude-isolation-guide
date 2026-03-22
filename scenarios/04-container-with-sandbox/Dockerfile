FROM ubuntu:24.04

# SRT dependencies: bubblewrap (sandbox engine), socat (network proxy), ripgrep
# Test dependency: curl (network enforcement tests)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      bubblewrap socat curl ripgrep ca-certificates unzip && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js via fnm
ARG NODE_VERSION=20
ENV FNM_DIR="/usr/local/fnm"
RUN curl -fsSL https://fnm.vercel.app/install | bash -s -- \
      --install-dir "$FNM_DIR" --skip-shell && \
    export PATH="$FNM_DIR:$PATH" && \
    eval "$($FNM_DIR/fnm env)" && \
    fnm install ${NODE_VERSION} && \
    fnm default ${NODE_VERSION}

ENV PATH="/usr/local/fnm/aliases/default/bin:${FNM_DIR}:${PATH}"

# npm supply chain hardening
ENV NPM_CONFIG_IGNORE_SCRIPTS=true \
    NPM_CONFIG_AUDIT=true \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_SAVE_EXACT=true \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_MINIMUM_RELEASE_AGE=1440

RUN npm install -g @anthropic-ai/claude-code

# Non-root user — unprivileged user namespaces let bwrap work without root
RUN groupadd --gid 1001 claude && \
    useradd --uid 1001 --gid claude --shell /bin/bash --create-home claude

WORKDIR /home/claude/project

# Test fixtures — fake secrets the sandbox should protect
RUN echo 'API_KEY=sk-example-not-real-1234567890' > .env && \
    echo 'DATABASE_URL=postgres://user:pass@localhost:5432/mydb' >> .env && \
    mkdir -p secrets && \
    echo 'production-database-password-do-not-leak' > secrets/prod-credentials.txt

# Make format-result.js available for test output formatting
COPY lib/format-result.js /home/claude/lib/format-result.js

# Project-level settings — baked into the image
COPY 04-container-with-sandbox/.claude/ .claude/

RUN chown -R claude:claude /home/claude

USER claude

CMD ["/bin/bash"]
