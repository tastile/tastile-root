FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d

ARG CLAUDE_CODE_VERSION=2.1.261
ARG OPENCODE_VERSION=1.18.29
ARG BUN_VERSION=1.3.14

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        bash ca-certificates curl git iproute2 jq openssh-client procps tini \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global \
        "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
        "opencode-ai@${OPENCODE_VERSION}" \
        "bun@${BUN_VERSION}" \
    && npm cache clean --force

RUN groupadd --gid 10001 agent \
    && useradd --uid 10001 --gid agent --create-home --shell /bin/bash agent \
    && install --directory --owner agent --group agent /state /workspace /task

COPY --chmod=0444 provider-gateway.mjs /opt/tastile-agent/provider-gateway.mjs

USER agent
WORKDIR /workspace
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sleep", "infinity"]
