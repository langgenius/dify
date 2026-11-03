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
    CGO_ENABLED=0 go build -o /bin/shellctl-runner ./cmd/runner && \
    CGO_ENABLED=0 go build -o /bin/dify-agent ./cmd/dify-agent-cli

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM python:3.13-slim-bookworm AS production

ARG NODE_VERSION=24.22.1
ARG PNPM_VERSION=11.9.0
ARG UV_VERSION=0.13.4
# Override pnpm's bundled undici, which is below the patched 6.29.1 release.
ARG UNDICI_VERSION=6.29.1
ARG UNDICI_SHA512=EvRlUt/QqAEvXdQeRMYUfwOQsfzpDztykrG2owGEE/rBOBoYv9uF39ZzsNDh4lTFHhTr2XOZjKkYgueD12ZmGA==

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
        iproute2 \
        jq \
        less \
        openssh-client \
        procps \
        ripgrep \
        tini \
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
    && undici_dir="$(npm root -g)/pnpm/dist/node_modules/undici" \
    && test -f "${undici_dir}/package.json" \
    && curl -fsSL "https://registry.npmjs.org/undici/-/undici-${UNDICI_VERSION}.tgz" -o /tmp/undici.tgz \
    && expected_sha512="$(printf '%s' "${UNDICI_SHA512}" | base64 -d | od -An -v -tx1 | tr -d ' \n')" \
    && actual_sha512="$(sha512sum /tmp/undici.tgz | cut -d ' ' -f1)" \
    && test "${actual_sha512}" = "${expected_sha512}" \
    && rm -rf "${undici_dir}" \
    && mkdir -p "${undici_dir}" \
    && tar -xzf /tmp/undici.tgz -C "${undici_dir}" --strip-components=1 \
    && rm -f /tmp/undici.tgz \
    && test "$(node -p "require('${undici_dir}/package.json').version")" = "${UNDICI_VERSION}" \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --no-cache-dir "uv==${UV_VERSION}"

# Go binaries
COPY --from=go-builder /bin/shellctl /usr/local/bin/shellctl
COPY --from=go-builder /bin/shellctl-sanitize-pty /usr/local/bin/shellctl-sanitize-pty
COPY --from=go-builder /bin/shellctl-runner-exit /usr/local/bin/shellctl-runner-exit
COPY --from=go-builder /bin/shellctl-runner /usr/local/bin/shellctl-runner
COPY --from=go-builder /bin/dify-agent /usr/local/bin/dify-agent

RUN useradd --create-home --shell /bin/sh dify \
    && mkdir -p /workspace \
    && chown dify:dify /home \
    && chown -R dify:dify /home/dify /workspace

USER dify
WORKDIR /home/dify

EXPOSE 5004

ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["shellctl", "serve", "--listen", "0.0.0.0:5004"]
