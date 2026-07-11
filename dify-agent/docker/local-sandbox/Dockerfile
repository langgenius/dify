# Local sandbox image for shellctl-managed Dify Agent workspaces.
#
# Build this from the dify-agent package root:
#   docker build -f docker/local-sandbox/Dockerfile -t dify-agent-local-sandbox:local .
#
# This image merges the former shellctl-only image with the sandbox-visible
# Agent Stub client CLI. It runs `shellctl serve` by default, and shellctl-managed jobs
# can call `dify-agent ...` without installing extra packages at runtime.

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

COPY pyproject.toml uv.lock README.md ./
COPY src ./src

RUN uv export --frozen --no-dev --all-extras --no-emit-project --no-hashes \
        > /tmp/dify-agent-constraints.txt \
    && UV_TOOL_DIR=/opt/dify-agent-tools/envs \
        UV_TOOL_BIN_DIR=/opt/dify-agent-tools/bin \
        uv tool install --force --python /usr/local/bin/python --no-python-downloads \
        --constraints /tmp/dify-agent-constraints.txt --link-mode=copy "${DIFY_AGENT_TOOL_SPEC}" \
    && rm -f /tmp/dify-agent-constraints.txt


FROM base AS production

ENV PATH="/opt/dify-agent-tools/bin:${PATH}"

COPY --from=tools /opt/dify-agent-tools/envs /opt/dify-agent-tools/envs
COPY --from=tools /opt/dify-agent-tools/bin /opt/dify-agent-tools/bin

RUN useradd --create-home --shell /bin/sh dify \
    && mkdir -p /mnt/drive \
    && chown dify:dify /home \
    && chown -R dify:dify /home/dify /mnt/drive

USER dify
WORKDIR /home/dify

EXPOSE 5004

CMD ["shellctl", "serve", "--listen", "0.0.0.0:5004"]
