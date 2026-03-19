FROM node:20-slim

# Non-root user (node user already exists in node images)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY . .

USER node
