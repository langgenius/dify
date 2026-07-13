# Go shellctl sandbox image — runtime environment mirrors the Python
# local-sandbox (dify-agent/docker/local-sandbox/Dockerfile) so that
# agent-managed jobs see the same binaries, libraries, and tools.
#
# Build from shellctl-go root:
#   docker build -f docker/Dockerfile -t dify-agent-local-sandbox:local .
#
# If you also need the dify-agent CLI tools inside the container, run a
# two-context build (see comments in the dify-agent tools stage below).

# ── Go build stage ───────────────────────────────────────────────────────────
FROM golang:1.26 AS go-builder

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /bin/shellctl ./cmd/shellctl && \
    CGO_ENABLED=0 go build -o /bin/shellctl-sanitize-pty ./cmd/sanitize-pty && \
    CGO_ENABLED=0 go build -o /bin/shellctl-runner-exit ./cmd/runner-exit

# ── dify-agent tools stage (optional, requires --build-context agent=../dify-agent) ──
# To include dify-agent CLI: build with
#   docker build -f docker/Dockerfile \
#     --build-context agent=../dify-agent \
#     -t dify-agent-local-sandbox:local .
FROM python:3.12-slim-bookworm AS base

ARG NODE_VERSION=22.22.1
ARG PNPM_VERSION=11.9.0
ARG UV_VERSION=0.8.9
ARG DIFY_AGENT_TOOL_SPEC=.[grpc,shellctl-server]

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

WORKDIR /opt/dify-agent


FROM base AS tools

ARG DIFY_AGENT_TOOL_SPEC

# Copy dify-agent source from the build context named "agent" if available.
# When building without --build-context agent=..., this stage can be skipped
# by targeting the "production" stage directly.
COPY --from=agent pyproject.toml uv.lock README.md ./
COPY --from=agent src ./src

RUN uv export --frozen --no-dev --all-extras --no-emit-project --no-hashes \
        > /tmp/dify-agent-constraints.txt \
    && UV_TOOL_DIR=/opt/dify-agent-tools/envs \
        UV_TOOL_BIN_DIR=/opt/dify-agent-tools/bin \
        uv tool install --force --python /usr/local/bin/python --no-python-downloads \
        --constraints /tmp/dify-agent-constraints.txt --link-mode=copy "${DIFY_AGENT_TOOL_SPEC}" \
    && rm -f /tmp/dify-agent-constraints.txt


# ── Production stage ─────────────────────────────────────────────────────────
FROM base AS production

ENV PATH="/opt/dify-agent-tools/bin:${PATH}"

# dify-agent CLI tools (from tools stage)
COPY --from=tools /opt/dify-agent-tools/envs /opt/dify-agent-tools/envs
COPY --from=tools /opt/dify-agent-tools/bin /opt/dify-agent-tools/bin

# Go shellctl binaries (replace Python shellctl-server)
COPY --from=go-builder /bin/shellctl /usr/local/bin/shellctl
COPY --from=go-builder /bin/shellctl-sanitize-pty /usr/local/bin/shellctl-sanitize-pty
COPY --from=go-builder /bin/shellctl-runner-exit /usr/local/bin/shellctl-runner-exit

# Remove Python shellctl console scripts so the Go binaries take precedence
RUN rm -f /opt/dify-agent-tools/bin/shellctl \
          /opt/dify-agent-tools/bin/shellctl-sanitize-pty \
          /opt/dify-agent-tools/bin/shellctl-runner-exit

RUN useradd --create-home --shell /bin/sh dify \
    && mkdir -p /mnt/drive \
    && chown dify:dify /home \
    && chown -R dify:dify /home/dify /mnt/drive

USER dify
WORKDIR /home/dify

EXPOSE 5004

CMD ["shellctl", "serve", "--listen", "0.0.0.0:5004"]
