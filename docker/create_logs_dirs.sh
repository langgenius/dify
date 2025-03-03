#!/bin/bash

# 定义日志目录和子目录列表
LOGS_DIR="./logs"
SUB_DIRS=(
  "api"
  "worker"
  "web"
  "db"
  "redis"
  "sandbox"
  "plugin_daemon"
  "ssrf_proxy"
  "certbot"
  "nginx"
  "weaviate"
  "qdrant"
  "couchbase"
  "pgvector"
  "pgvecto-rs"
  "chroma"
  "oracle"
  "etcd"
  "minio"
  "milvus"
  "opensearch"
  "opensearch-dashboards"
  "myscale"
  "elasticsearch"
  "kibana"
  "unstructured"
  "oceanbase"
)

# 创建主日志目录
if [ ! -d "$LOGS_DIR" ]; then
  echo "Creating main logs directory: $LOGS_DIR"
  mkdir -p "$LOGS_DIR"
fi

# 创建子目录并设置权限
for dir in "${SUB_DIRS[@]}"; do
  if [ ! -d "$LOGS_DIR/$dir" ]; then
    echo "Creating subdirectory: $LOGS_DIR/$dir"
    mkdir -p "$LOGS_DIR/$dir"
  fi
  # 设置权限为 755 (rwxr-xr-x)，确保 Docker 可以写入日志
  chmod 755 "$LOGS_DIR/$dir"
done

# 特殊处理 Oracle 日志路径
ORACLE_LOG_PATH="$LOGS_DIR/oracle/FREEPDB1/trace"
if [ ! -d "$ORACLE_LOG_PATH" ]; then
  echo "Creating special Oracle log path: $ORACLE_LOG_PATH"
  mkdir -p "$ORACLE_LOG_PATH"
  chmod 755 "$ORACLE_LOG_PATH"
fi

echo "All necessary log directories have been created and permissions set."

