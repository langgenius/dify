# Go shellctl sandbox image — provides a sandboxed runtime environment
# with common dev tools (Node.js, Python, pnpm, uv) for agent-managed jobs.
#
# Build:
#   docker build -f docker/Dockerfile -t dify-agent-local-sandbox:local .

# ── Go build stage ───────────────────────────────────────────────────────────
FROM golang:1.26 AS go-builder

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /bin/shellctl ./cmd/shellctl && \
    CGO_ENABLED=0 go build -o /bin/shellctl-sanitize-pty ./cmd/sanitize-pty && \
    CGO_ENABLED=0 go build -o /bin/shellctl-runner-exit ./cmd/runner-exit && \
    CGO_ENABLED=0 go build -o /bin/dify-agent ./cmd/dify-agent-cli

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM python:3.12-slim-bookworm AS production

ARG NODE_VERSION=22.22.1
ARG PNPM_VERSION=11.9.0
ARG UV_VERSION=0.8.9

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        file \
        git \
        jq \
        less \
        openssh-client \
        procps \
        ripgrep \
        tmux \
        unzip \
        xz-utils \
        zip \
    && node_arch="$(dpkg --print-architecture)" \
    && case "${node_arch}" in \
        amd64) node_arch="x64" ;; \
        arm64) node_arch="arm64" ;; \
        *) echo "Unsupported Node.js architecture: ${node_arch}" >&2; exit 1 ;; \
    esac \
    && node_dist="node-v${NODE_VERSION}-linux-${node_arch}" \
    && curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" \
    && curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/${node_dist}.tar.xz" \
    && grep " ${node_dist}.tar.xz\$" SHASUMS256.txt | sha256sum -c - \
    && tar -xJf "${node_dist}.tar.xz" -C /usr/local --strip-components=1 \
    && rm -f SHASUMS256.txt "${node_dist}.tar.xz" \
    && npm install --global "pnpm@${PNPM_VERSION}" \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --no-cache-dir "uv==${UV_VERSION}"

# Go binaries
COPY --from=go-builder /bin/shellctl /usr/local/bin/shellctl
COPY --from=go-builder /bin/shellctl-sanitize-pty /usr/local/bin/shellctl-sanitize-pty
COPY --from=go-builder /bin/shellctl-runner-exit /usr/local/bin/shellctl-runner-exit
COPY --from=go-builder /bin/dify-agent /usr/local/bin/dify-agent

RUN useradd --create-home --shell /bin/sh dify \
    && mkdir -p /mnt/drive \
    && chown dify:dify /home \
    && chown -R dify:dify /home/dify /mnt/drive

USER dify
WORKDIR /home/dify

EXPOSE 5004

CMD ["shellctl", "serve", "--listen", "0.0.0.0:5004"]
