# Local sandbox image for shellctl-managed Dify Agent workspaces.
#
# Build this from the dify-agent package root:
#   docker build -f docker/local-sandbox/Dockerfile -t dify-agent-local-sandbox:local .
#
# This image merges the former shellctl-only image with the sandbox-visible
# Agent Stub client CLI. It runs shellctl by default, and shellctl-managed jobs
# can call `dify-agent ...` without installing extra packages at runtime.

FROM python:3.12-slim-bookworm AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DIFY_AGENT_STUB_DRIVE_BASE=/mnt/drive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        tmux \
    && rm -rf /var/lib/apt/lists/*

ENV UV_VERSION=0.8.9
RUN python -m pip install --no-cache-dir "uv==${UV_VERSION}"

WORKDIR /opt/dify-agent


FROM base AS packages

ENV SHELL_SESSION_MANAGER_VERSION=2.3.0

COPY pyproject.toml uv.lock README.md ./
COPY src ./src

RUN uv sync --frozen --no-dev --no-editable --extra grpc \
    && uv pip install --python .venv/bin/python "shell-session-manager==${SHELL_SESSION_MANAGER_VERSION}"


FROM base AS production

ENV VIRTUAL_ENV=/opt/dify-agent/.venv
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

COPY --from=packages ${VIRTUAL_ENV} ${VIRTUAL_ENV}

RUN ln -s ${VIRTUAL_ENV}/bin/dify-agent /usr/local/bin/dify-agent \
    && ln -s ${VIRTUAL_ENV}/bin/shellctl /usr/local/bin/shellctl \
    && useradd --create-home --shell /bin/sh dify \
    && mkdir -p /mnt/drive \
    && chown -R dify:dify /home/dify /mnt/drive

USER dify
WORKDIR /home/dify

EXPOSE 5004

CMD ["shellctl", "serve", "--listen", "0.0.0.0:5004"]
