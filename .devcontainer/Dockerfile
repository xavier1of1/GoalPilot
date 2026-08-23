FROM node:24.19.0-bookworm

ARG PNPM_VERSION=11.22.0
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate

RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssh-client postgresql-client sudo \
  && echo "node ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/node \
  && chmod 0440 /etc/sudoers.d/node \
  && rm -rf /var/lib/apt/lists/*
