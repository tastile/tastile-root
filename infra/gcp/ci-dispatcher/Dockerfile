FROM oven/bun:1.4.2 AS build
WORKDIR /src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY infra/gcp/ci-dispatcher/index.ts ./infra/gcp/ci-dispatcher/index.ts
RUN bun build --compile ./infra/gcp/ci-dispatcher/index.ts --outfile /out/tastile-ci-dispatcher

FROM debian:bookworm-slim
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y ca-certificates tar \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/tastile-ci-dispatcher /usr/local/bin/tastile-ci-dispatcher
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/tastile-ci-dispatcher"]
