@echo off
chcp 65001 >nul
REM Dify Local Test Environment Startup Script (Windows)
REM Used to quickly start local development and testing environment

echo [INFO] Starting Dify local test environment...

REM Ensure in docker directory
cd /d "%~dp0"

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not running. Please start Docker Desktop first.
    pause
    exit /b 1
)

REM Check if .env file exists
if not exist ".env" (
    echo [ERROR] .env configuration file not found
    echo         Please create first: copy .env.example .env
    pause
    exit /b 1
)

echo [INFO] Using config file: .env

REM Build worker image
echo [INFO] Building worker image...
docker compose --env-file .env build worker
if errorlevel 1 (
    echo [ERROR] Failed to build worker image
    pause
    exit /b 1
)

REM Start all services
echo [INFO] Starting all services...
docker compose --env-file .env up -d
if errorlevel 1 (
    echo [ERROR] Failed to start services
    pause
    exit /b 1
)

echo [SUCCESS] Local test environment started successfully!
echo.
echo [SERVICES] Service URLs:
echo    - Web UI: http://localhost
echo    - API Docs: http://localhost/swagger-ui.html
echo    - API Service: http://localhost:5001
echo.
echo [COMMANDS] Available commands:
echo    - View logs: docker compose logs -f
echo    - Stop services: docker compose down
echo    - Clean data: docker compose -f docker-compose.middleware.yaml down -v
echo    - Restart services: docker compose restart
echo.
echo [TIP] If first run, wait a few minutes for services to fully start
echo       Use 'docker compose ps' to check service status

pause
