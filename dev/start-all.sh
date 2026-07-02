#!/bin/bash
# Start all Dify dev services (Docker middleware + API + Web + Celery)

cd /home/lazy/works/git/dify

echo "=== 启动 Dify 开发环境 ==="
echo ""

# Kill existing processes
pkill -f "flask run" 2>/dev/null
pkill -f "next dev" 2>/dev/null
pkill -f "celery.*worker" 2>/dev/null
pkill -f "celery.*beat" 2>/dev/null
fuser -k 9229/tcp 2>/dev/null
sleep 2

# Start Docker middleware (if not running)
if ! sg docker -c "docker ps" 2>/dev/null | grep -q "dify-db_postgres"; then
    echo "[1/5] 启动 Docker 中间件..."
    cd docker
    sg docker -c "docker compose -f docker-compose.middleware.yaml --profile postgresql --profile weaviate -p dify up -d"
    cd ..
    sleep 5
else
    echo "[1/5] Docker 中间件已运行"
fi

# Start API
echo "[2/5] 启动 API (Flask)..."
cd api
source .venv/bin/activate
setsid flask run --host 0.0.0.0 --port=5001 > /tmp/dify-api.log 2>&1 &
disown
cd ..

# Start Web
echo "[3/5] 启动 Web (Next.js)..."
cd web
export PATH="/home/lazy/.local/share/fnm:$PATH"
eval "$(fnm env)"
fnm use 22 > /dev/null 2>&1
setsid env NODE_OPTIONS="--max-old-space-size=4096" pnpm dev > /tmp/dify-web.log 2>&1 &
disown
cd ..

# Start Celery Worker
echo "[4/5] 启动 Celery Worker..."
cd api
setsid celery -A app.celery worker -P solo -c 1 --loglevel INFO > /tmp/dify-worker.log 2>&1 &
disown
cd ..

# Start Celery Beat
echo "[5/5] 启动 Celery Beat..."
cd api
setsid celery -A app.celery beat --loglevel INFO > /tmp/dify-beat.log 2>&1 &
disown
cd ..

echo ""
echo "=== 服务启动完成 ==="
echo "  API:           http://localhost:5001"
echo "  Web:           http://localhost:3000"
echo "  Celery Worker: 日志 /tmp/dify-worker.log"
echo "  Celery Beat:    日志 /tmp/dify-beat.log"
echo ""
echo "检查状态:"
echo "  curl http://localhost:5001/health"
echo "  curl -I http://localhost:3000"
