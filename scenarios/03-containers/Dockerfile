FROM ubuntu:24.04

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates unzip && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js via fnm (matching scenario 04's approach)
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

RUN groupadd --gid 1001 claude && \
    useradd --uid 1001 --gid claude --shell /bin/bash --create-home claude

WORKDIR /home/claude/project

COPY 03-containers/docker-compose.yml ./

RUN chown -R claude:claude /home/claude

USER claude

CMD ["/bin/bash"]
