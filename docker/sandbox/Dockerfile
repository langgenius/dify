# 使用官方的langgenius/dify-sandbox:0.2.9镜像作为基础镜像
FROM langgenius/dify-sandbox:0.2.9

RUN apt-get update \
    # For Security and Networking tools
    && apt-get install -y --no-install-recommends \
       vim \
       curl \
       dnsutils \
       busybox \
       findutils \
       tcpdump \
       tzdata \
       iputils-ping \
       telnet \
       net-tools \
       iproute2 \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# 设置DifySandbox的环境变量
ENV API_KEY=${SANDBOX_API_KEY:-dify-sandbox} \
    GIN_MODE=${SANDBOX_GIN_MODE:-release} \
    WORKER_TIMEOUT=${SANDBOX_WORKER_TIMEOUT:-15} \
    ENABLE_NETWORK=${SANDBOX_ENABLE_NETWORK:-true} \
    HTTP_PROXY=${SANDBOX_HTTP_PROXY:-http://ssrf-proxy:3128} \
    HTTPS_PROXY=${SANDBOX_HTTPS_PROXY:-http://ssrf-proxy:3128} \
    SANDBOX_PORT=${SANDBOX_PORT:-8194}

# 设置健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8194/health || exit 1

# 暴露DifySandbox的端口
EXPOSE 3128
