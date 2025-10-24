#!/bin/bash
#
# Dify 快速部署脚本
#
# 用法:
#   ./deploy.sh              # 快速启动（使用已构建的镜像）
#   ./deploy.sh --build      # 重新构建所有服务后启动
#   ./deploy.sh --build web  # 仅重新构建 web 后启动
#   ./deploy.sh --stop       # 停止所有服务
#   ./deploy.sh --status     # 查看服务状态
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$SCRIPT_DIR/docker"

cd "$DOCKER_DIR"

build_services() {
    local services="${1:-all}"
    
    if [ "$services" = "all" ]; then
        echo "🔨 重新构建所有服务..."
        docker-compose build
    else
        echo "🔨 重新构建服务: $services"
        docker-compose build $services
    fi
}

case "${1:-}" in
    --build)
        echo "=========================================="
        echo "🔨 重新构建项目"
        echo "=========================================="
        echo ""
        
        # 构建指定的服务或全部
        if [ -n "$2" ]; then
            build_services "$2"
        else
            build_services "all"
        fi
        
        echo ""
        echo "✅ 构建完成"
        echo ""
        echo "📋 下一步:"
        echo "  cd docker && docker-compose up -d"
        echo "或使用:"
        echo "  ./deploy.sh  # 启动所有服务"
        ;;
        
    --stop)
        echo "=========================================="
        echo "⏹️  停止所有服务"
        echo "=========================================="
        echo ""
        docker-compose down
        echo ""
        echo "✅ 所有服务已停止"
        ;;
        
    --status)
        echo "=========================================="
        echo "📊 服务状态"
        echo "=========================================="
        echo ""
        docker-compose ps
        ;;
        
    --logs)
        echo "=========================================="
        echo "📝 查看服务日志"
        echo "=========================================="
        echo ""
        if [ -n "$2" ]; then
            docker-compose logs -f --tail=100 "$2"
        else
            docker-compose logs -f --tail=100 api
        fi
        ;;
        
    *)
        echo "=========================================="
        echo "🚀 快速启动所有服务"
        echo "=========================================="
        echo ""
        echo "提示: 使用缓存的镜像启动（如需重新构建，使用 --build）"
        echo ""
        docker-compose up -d
        echo ""
        echo "✅ 所有服务已启动"
        echo ""
        echo "服务状态："
        docker-compose ps --format "table {{.Service}}\t{{.Status}}\t{{.Ports}}"
        echo ""
        echo "📋 可用命令："
        echo "  ./deploy.sh --build        # 构建所有服务"
        echo "  ./deploy.sh --build web    # 仅构建 web"
        echo "  ./deploy.sh --build api    # 仅构建 api"
        echo "  ./deploy.sh --stop         # 停止所有服务"
        echo "  ./deploy.sh --status       # 查看服务状态"
        echo "  ./deploy.sh --logs api     # 查看 API 日志"
        echo ""
        echo "访问地址："
        echo "  - 前端: http://localhost"
        echo "  - API:  http://localhost/api"
        ;;
esac

