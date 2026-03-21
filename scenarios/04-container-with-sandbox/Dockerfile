FROM ubuntu:24.04

# Layer 2 dependencies: bubblewrap (sandbox) + socat (network proxy) + ripgrep (srt requirement)
# Layer 3 dependency: curl (for network enforcement tests)
# Ubuntu 24.04 enables unprivileged user namespaces by default, so bwrap
# works as non-root — no SYS_ADMIN capability needed.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      bubblewrap socat curl ripgrep ca-certificates unzip && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js via fnm (no node: base image)
ARG NODE_VERSION=20
ENV FNM_DIR="/usr/local/fnm"
RUN curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir "$FNM_DIR" --skip-shell && \
    export PATH="$FNM_DIR:$PATH" && \
    eval "$($FNM_DIR/fnm env)" && \
    fnm install ${NODE_VERSION} && \
    fnm default ${NODE_VERSION}

# Make node/npm available system-wide
ENV PATH="/usr/local/fnm/aliases/default/bin:${FNM_DIR}:${PATH}"

# npm supply chain hardening — prevents postinstall script attacks, flags known
# vulnerabilities, pins exact versions, and won't install packages < 24h old
ENV NPM_CONFIG_IGNORE_SCRIPTS=true \
    NPM_CONFIG_AUDIT=true \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_SAVE_EXACT=true \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_MINIMUM_RELEASE_AGE=1440

RUN npm install -g @anthropic-ai/claude-code

# Non-root user — Ubuntu 24.04's unprivileged user namespaces let bwrap
# work without root or SYS_ADMIN.
RUN groupadd --gid 1001 claude && \
    useradd --uid 1001 --gid claude --shell /bin/bash --create-home claude

WORKDIR /home/claude/project

COPY 04-container-with-sandbox/package.json ./
RUN npm install

COPY lib/ /home/claude/lib/
COPY lib/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

COPY 04-container-with-sandbox/verify.js 04-container-with-sandbox/docker-compose.yml ./
COPY 04-container-with-sandbox/.claude/ .claude/
COPY 04-container-with-sandbox/.env.example ./

RUN mkdir -p secrets

RUN chown -R claude:claude /home/claude

USER claude

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["test"]
