@echo off
REM 本地测试环境启动脚本 (Windows)
REM 用于快速启动本地开发和测试环境

echo 🚀 启动Dify本地测试环境...

REM 确保在docker目录中
cd /d "%~dp0"

REM 检查.env文件是否存在
if not exist ".env" (
    echo ❌ 未找到 .env 配置文件
    echo    请先创建: copy .env.example .env
    pause
    exit /b 1
)

echo 📄 使用配置文件: .env

REM 构建worker镜像
echo 🔨 构建worker镜像...
docker compose --env-file .env build worker

REM 启动所有服务
echo 🚀 启动所有服务...
docker compose --env-file .env up -d

echo ✅ 本地测试环境启动完成！
echo.
echo 🌐 服务地址:
echo    - Web界面: http://localhost
echo    - API文档: http://localhost/swagger-ui.html
echo    - API服务: http://localhost:5001
echo.
echo 📊 查看日志: docker compose logs -f
echo 🛑 停止服务: docker compose down
echo 🧹 清理数据: docker compose -f docker-compose.middleware.yaml down -v
echo 🔄 重启服务: docker compose restart

echo.
echo 💡 提示: 如果是首次运行，可能需要等待几分钟让服务完全启动
echo    可以使用 'docker compose ps' 查看服务状态

pause
