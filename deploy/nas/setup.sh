#!/bin/sh
set -eu

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "已创建 .env，请先编辑 NAS IP 和密码后再运行："
  echo "  sh setup.sh up"
  exit 0
fi

# 官方 compose 从 docker/.env 读取变量，同步一份过去
cp .env ../../docker/.env

mkdir -p dev/difly_docker/db dev/difly_docker/redis dev/difly_docker/weaviate dev/difly_docker/storage

case "${1:-up}" in
  up)
    docker compose up -d
    echo ""
    echo "启动中，请稍候 1-3 分钟后访问："
    grep '^CONSOLE_WEB_URL=' .env | cut -d= -f2 | sed 's|$|/install|'
    ;;
  down)
    docker compose down
    ;;
  ps)
    docker compose ps
    ;;
  logs)
    docker compose logs -f
    ;;
  *)
    echo "用法: sh setup.sh [up|down|ps|logs]"
    exit 1
    ;;
esac
