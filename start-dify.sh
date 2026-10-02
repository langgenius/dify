#!/bin/bash

# Dify 快速启动脚本
# 用法: ./start-dify.sh [start|stop|restart|status|logs]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$SCRIPT_DIR/docker"

cd "$DOCKER_DIR"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_info() {
    echo -e "${YELLOW}[i]${NC} $1"
}

# 检查 Docker 是否运行
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        print_error "Docker 未运行，请先启动 Docker Desktop"
        exit 1
    fi
    print_status "Docker 运行正常"
}

# 检查 .env 文件
check_env() {
    if [ ! -f "$DOCKER_DIR/.env" ]; then
        print_info "创建 .env 配置文件..."
        cp "$DOCKER_DIR/.env.example" "$DOCKER_DIR/.env"
        print_status ".env 文件已创建"
    else
        print_status ".env 文件存在"
    fi
}

# 启动服务
start_services() {
    print_info "正在启动 Dify 服务..."

    check_docker
    check_env

    print_info "拉取最新镜像（如果需要）..."
    docker compose pull

    print_info "启动容器..."
    docker compose up -d

    print_status "Dify 启动成功！"
    echo ""
    echo "🌐 访问地址:"
    echo "   控制台: http://localhost/install"
    echo "   主页:   http://localhost"
    echo ""
    echo "📊 查看日志: ./start-dify.sh logs"
    echo "🛑 停止服务: ./start-dify.sh stop"
}

# 停止服务
stop_services() {
    print_info "正在停止 Dify 服务..."
    docker compose down
    print_status "Dify 已停止"
}

# 重启服务
restart_services() {
    print_info "正在重启 Dify 服务..."
    docker compose restart
    print_status "Dify 已重启"
}

# 查看状态
show_status() {
    print_info "Dify 服务状态:"
    docker compose ps
    echo ""
    print_info "资源使用情况:"
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" \
        $(docker compose ps -q) 2>/dev/null || echo "没有运行中的容器"
}

# 查看日志
show_logs() {
    if [ -n "$2" ]; then
        # 查看特定服务日志
        docker compose logs -f "$2"
    else
        # 查看所有日志
        docker compose logs -f
    fi
}

# 清理数据（危险操作）
clean_data() {
    read -p "⚠️  警告: 这将删除所有数据！确定继续吗？(yes/no): " confirm
    if [ "$confirm" = "yes" ]; then
        print_info "停止并删除所有容器和数据..."
        docker compose down -v
        print_status "数据已清理"
    else
        print_info "操作已取消"
    fi
}

# 更新服务
update_services() {
    print_info "更新 Dify 到最新版本..."

    # 备份数据库（可选）
    print_info "建议先备份数据库"

    # 拉取最新镜像
    docker compose pull

    # 重启服务
    docker compose up -d

    print_status "更新完成"
}

# 主菜单
case "${1:-help}" in
    start)
        start_services
        ;;
    stop)
        stop_services
        ;;
    restart)
        restart_services
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "$@"
        ;;
    clean)
        clean_data
        ;;
    update)
        update_services
        ;;
    help|*)
        echo "Dify 管理脚本"
        echo ""
        echo "用法: $0 [命令]"
        echo ""
        echo "命令:"
        echo "  start       - 启动 Dify 服务"
        echo "  stop        - 停止 Dify 服务"
        echo "  restart     - 重启 Dify 服务"
        echo "  status      - 查看服务状态"
        echo "  logs [服务] - 查看日志 (可选指定服务名)"
        echo "  update      - 更新到最新版本"
        echo "  clean       - 清理所有数据 (危险操作)"
        echo "  help        - 显示此帮助信息"
        echo ""
        echo "示例:"
        echo "  $0 start              # 启动服务"
        echo "  $0 logs               # 查看所有日志"
        echo "  $0 logs api           # 查看 API 日志"
        echo "  $0 status             # 查看状态"
        ;;
esac
