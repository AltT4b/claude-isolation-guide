FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

RUN groupadd --gid 1001 claude && \
    useradd --uid 1001 --gid claude --shell /bin/bash --create-home claude

WORKDIR /home/claude/project

COPY 03-containers/package.json ./
RUN npm install --ignore-scripts

COPY lib/ /home/claude/lib/
COPY lib/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

COPY 03-containers/verify.js 03-containers/docker-compose.yml ./

RUN chown -R claude:claude /home/claude

USER claude

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["test"]
