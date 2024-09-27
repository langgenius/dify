# 使用官方的Ubuntu/Squid镜像作为基础镜像
FROM ubuntu/squid:latest

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

# 将squid配置模板文件复制到容器内的/etc/squid目录
COPY squid.conf.template /etc/squid/squid.conf.template

# 将docker-entrypoint.sh脚本复制到容器内，并设置执行权限
COPY docker-entrypoint.sh /docker-entrypoint-mount.sh
RUN sed -i 's/\r$//' /docker-entrypoint-mount.sh && \
    chmod +x /docker-entrypoint-mount.sh && \
    mv /docker-entrypoint-mount.sh /entrypoint.sh

# 设置环境变量
ENV HTTP_PORT=${SSRF_HTTP_PORT:-3128} \
    COREDUMP_DIR=${SSRF_COREDUMP_DIR:-/var/spool/squid} \
    REVERSE_PROXY_PORT=${SSRF_REVERSE_PROXY_PORT:-8194} \
    SANDBOX_HOST=${SSRF_SANDBOX_HOST:-sandbox} \
    SANDBOX_PORT=${SANDBOX_PORT:-8194}

# 暴露Squid默认的HTTP端口
EXPOSE 3128
# 设置容器启动时执行的命令
ENTRYPOINT ["/bin/bash", "/entrypoint.sh"]