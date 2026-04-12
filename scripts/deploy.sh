#!/bin/bash
# scripts/deploy.sh
# 快速部署脚本 - 支持 Staging 和 Production

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 配置
ENVIRONMENT=${1:-staging}
VERSION=${2:-develop}
DOCKER_REGISTRY="ghcr.io/lczc1988"

echo -e "${YELLOW}🚀 Deploying Dify to $ENVIRONMENT (version: $VERSION)${NC}"

# 验证环境
if [ ! -f "docker-compose.yml" ]; then
    echo -e "${RED}❌ docker-compose.yml not found${NC}"
    exit 1
fi

# 1. 拉取最新代码
echo -e "${YELLOW}1. Pulling latest code...${NC}"
git fetch origin
git checkout $VERSION

# 2. 验证版本标签
if ! git rev-parse $VERSION >/dev/null 2>&1; then
    echo -e "${RED}❌ Version $VERSION not found${NC}"
    exit 1
fi

# 3. 加载环境变量
if [ -f ".env.$ENVIRONMENT" ]; then
    echo -e "${YELLOW}2. Loading environment: .env.$ENVIRONMENT${NC}"
    export $(cat ".env.$ENVIRONMENT" | grep -v '^#' | xargs)
else
    echo -e "${YELLOW}2. Using default .env${NC}"
    export $(cat ".env" | grep -v '^#' | xargs)
fi

# 4. 验证数据库连接
echo -e "${YELLOW}3. Verifying database connection...${NC}"
if ! docker-compose exec -T postgres psql -U postgres -d dify -c "SELECT 1" >/dev/null 2>&1; then
    echo -e "${RED}❌ Database connection failed${NC}"
    exit 1
fi

# 5. 备份数据库
echo -e "${YELLOW}4. Backing up database...${NC}"
BACKUP_FILE="backups/dify-backup-$(date +%Y%m%d-%H%M%S).sql"
mkdir -p backups
docker-compose exec -T postgres pg_dump -U postgres dify > "$BACKUP_FILE"
echo -e "${GREEN}✅ Backup saved to $BACKUP_FILE${NC}"

# 6. 拉取镜像
echo -e "${YELLOW}5. Pulling docker images...${NC}"
docker-compose pull

# 7. 停止旧容器
echo -e "${YELLOW}6. Stopping old containers...${NC}"
docker-compose down

# 8. 启动新容器
echo -e "${YELLOW}7. Starting new containers...${NC}"
docker-compose up -d

# 9. 等待服务就绪
echo -e "${YELLOW}8. Waiting for services to be ready...${NC}"
sleep 10

# 10. 健康检查 - 后端
echo -e "${YELLOW}9. Health check - API...${NC}"
HEALTH_CHECK_RETRIES=30
for i in $(seq 1 $HEALTH_CHECK_RETRIES); do
    if curl -f http://localhost:5001/api/health >/dev/null 2>&1; then
        echo -e "${GREEN}✅ API is healthy${NC}"
        break
    fi
    if [ $i -eq $HEALTH_CHECK_RETRIES ]; then
        echo -e "${RED}❌ API failed health check${NC}"
        echo -e "${YELLOW}Rolling back...${NC}"
        docker-compose down
        exit 1
    fi
    echo "⏳ Attempt $i/$HEALTH_CHECK_RETRIES..."
    sleep 5
done

# 11. 健康检查 - 前端
echo -e "${YELLOW}10. Health check - Web...${NC}"
for i in $(seq 1 30); do
    if curl -f http://localhost:3000 >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Web is healthy${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}❌ Web failed health check${NC}"
        docker-compose down
        exit 1
    fi
    echo "⏳ Attempt $i/30..."
    sleep 5
done

# 12. 显示日志摘要
echo -e "${YELLOW}11. Service status:${NC}"
docker-compose ps

echo -e "${GREEN}✅ Deployment to $ENVIRONMENT completed successfully!${NC}"
echo ""
echo "📊 Deployment Summary:"
echo "- Environment: $ENVIRONMENT"
echo "- Version: $VERSION"
echo "- Timestamp: $(date)"
echo "- Backup: $BACKUP_FILE"
echo ""
echo "🔗 Access URLs:"
echo "- Frontend: http://localhost:3000"
echo "- API: http://localhost:5001/api"
echo "- Health: http://localhost:5001/api/health"
