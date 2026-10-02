#!/bin/bash

# 实时监控 Docker 镜像拉取进度

echo "🔄 监控 Docker 镜像下载进度..."
echo "按 Ctrl+C 退出监控"
echo ""

while true; do
    # 清屏
    clear

    echo "═══════════════════════════════════════════════════════════"
    echo "  📦 Dify Docker 镜像下载进度监控"
    echo "═══════════════════════════════════════════════════════════"
    echo ""

    # 检查是否还在下载
    if ps aux | grep "docker compose pull" | grep -v grep > /dev/null; then
        echo "✅ 状态: 正在下载中..."
    else
        echo "✅ 状态: 下载完成或未在下载"
    fi

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "已下载的镜像:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    docker images | head -1
    docker images | grep -E "langgenius|redis|postgres|weaviate|nginx|semitechnologies" || echo "  暂无镜像"

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "镜像总大小:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    total_size=$(docker images | grep -E "langgenius|redis|postgres|weaviate|nginx|semitechnologies" | awk '{size+=$NF} END {print size}' 2>/dev/null || echo "0")
    echo "  已下载: ${total_size} (累计)"

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "⏱️  $(date '+%H:%M:%S') | 每 3 秒刷新一次"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # 等待 3 秒
    sleep 3
done
