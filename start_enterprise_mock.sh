#!/bin/bash

# Dify 企业版功能快速启动脚本

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "================================================"
echo "🚀 Dify 企业版功能启用脚本"
echo "================================================"
echo ""

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 检查依赖
check_dependencies() {
    echo "📋 检查依赖..."

    if ! command -v python3 &> /dev/null; then
        echo -e "${RED}❌ 错误: 未找到 Python 3${NC}"
        echo "请先安装 Python 3.8+"
        exit 1
    fi

    if ! command -v docker &> /dev/null; then
        echo -e "${YELLOW}⚠️  警告: 未找到 Docker${NC}"
        echo "如果使用 Docker 部署，请先安装 Docker"
    fi

    echo -e "${GREEN}✅ 依赖检查完成${NC}"
    echo ""
}

# 安装 Python 依赖
install_python_deps() {
    echo "📦 安装 Python 依赖..."

    if ! python3 -c "import flask" &> /dev/null; then
        echo "正在安装 Flask..."
        pip3 install flask || {
            echo -e "${RED}❌ Flask 安装失败${NC}"
            exit 1
        }
    fi

    echo -e "${GREEN}✅ Python 依赖已就绪${NC}"
    echo ""
}

# 配置环境变量
configure_env() {
    echo "⚙️  配置环境变量..."

    ENV_FILE="./api/.env"

    if [ ! -f "$ENV_FILE" ]; then
        echo -e "${RED}❌ 未找到 $ENV_FILE${NC}"
        echo "请先确保 Dify 已正确安装"
        exit 1
    fi

    # 备份原始配置
    if [ ! -f "$ENV_FILE.backup" ]; then
        cp "$ENV_FILE" "$ENV_FILE.backup"
        echo "已备份原始配置到 $ENV_FILE.backup"
    fi

    # 检查是否已配置
    if grep -q "ENTERPRISE_ENABLED=true" "$ENV_FILE"; then
        echo -e "${YELLOW}⚠️  企业版配置已存在${NC}"
    else
        echo "正在添加企业版配置..."

        cat >> "$ENV_FILE" << 'EOF'

# ==========================================
# 企业版功能配置
# ==========================================
ENTERPRISE_ENABLED=true
ENTERPRISE_API_URL=http://127.0.0.1:5001
ENTERPRISE_API_SECRET_KEY=your-secret-key-here
CAN_REPLACE_LOGO=true
EOF

        echo -e "${GREEN}✅ 环境变量配置完成${NC}"
    fi

    echo ""
}

# 启动 Mock API
start_mock_api() {
    echo "🚀 启动企业 API Mock 服务..."

    if [ ! -f "enterprise_mock_api.py" ]; then
        echo -e "${RED}❌ 未找到 enterprise_mock_api.py${NC}"
        exit 1
    fi

    # 检查端口是否被占用
    if lsof -Pi :5001 -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  端口 5001 已被占用${NC}"
        echo "正在尝试停止现有服务..."
        pkill -f "enterprise_mock_api.py" || true
        sleep 2
    fi

    # 启动服务
    nohup python3 enterprise_mock_api.py > enterprise_mock.log 2>&1 &
    MOCK_PID=$!

    echo "企业 API Mock 服务已启动 (PID: $MOCK_PID)"
    echo "日志文件: $SCRIPT_DIR/enterprise_mock.log"
    echo ""

    # 等待服务启动
    echo "等待服务启动..."
    sleep 3

    # 验证服务
    if curl -s -H "Enterprise-Api-Secret-Key: your-secret-key-here" \
            http://127.0.0.1:5001/info > /dev/null; then
        echo -e "${GREEN}✅ 企业 API 服务运行正常${NC}"
    else
        echo -e "${RED}❌ 企业 API 服务启动失败${NC}"
        echo "请查看日志: tail -f enterprise_mock.log"
        exit 1
    fi

    echo ""
}

# 重启 Dify 服务
restart_dify() {
    echo "🔄 重启 Dify 服务..."

    if [ -d "./docker" ] && [ -f "./docker/docker-compose.yaml" ]; then
        echo "检测到 Docker 部署，正在重启..."
        cd docker
        docker-compose restart api worker web
        cd ..
        echo -e "${GREEN}✅ Docker 服务已重启${NC}"
    else
        echo -e "${YELLOW}⚠️  请手动重启 Dify 服务${NC}"
        echo "命令: cd api && uv run --project . flask run --reload"
    fi

    echo ""
}

# 验证企业功能
verify_enterprise() {
    echo "🔍 验证企业功能..."

    echo ""
    echo "请访问以下地址验证："
    echo "  - Dify 控制台: http://localhost"
    echo "  - 企业 API: http://127.0.0.1:5001/info"
    echo ""
    echo "预期可见的企业功能："
    echo "  ✓ 系统设置 → 品牌定制"
    echo "  ✓ 系统设置 → SSO 配置"
    echo "  ✓ 应用设置 → 访问控制"
    echo "  ✓ Web 应用版权信息已移除"
    echo "  ✓ 插件管理功能"
    echo "  ✓ 知识库流水线发布"
    echo ""
}

# 显示管理命令
show_management() {
    echo "================================================"
    echo "📚 管理命令"
    echo "================================================"
    echo ""
    echo "查看 Mock API 日志:"
    echo "  tail -f $SCRIPT_DIR/enterprise_mock.log"
    echo ""
    echo "停止 Mock API:"
    echo "  pkill -f enterprise_mock_api.py"
    echo ""
    echo "恢复原始配置:"
    echo "  cp ./api/.env.backup ./api/.env"
    echo ""
    echo "测试企业 API:"
    echo "  curl -H 'Enterprise-Api-Secret-Key: your-secret-key-here' \\"
    echo "       http://127.0.0.1:5001/info | jq"
    echo ""
    echo "查看 Dify 日志 (Docker):"
    echo "  docker logs -f dify-api"
    echo ""
    echo "================================================"
    echo ""
}

# 主流程
main() {
    check_dependencies
    install_python_deps
    configure_env
    start_mock_api
    restart_dify
    verify_enterprise
    show_management

    echo -e "${GREEN}✨ 企业版功能启用完成！${NC}"
    echo ""
    echo "📖 详细文档请参考: ENTERPRISE_SETUP.md"
    echo ""
}

# 执行主流程
main
