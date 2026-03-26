@echo off
title Dify Stopper
echo ==========================================
echo       Stopping Dify Services...
echo ==========================================

if not exist "docker" (
    echo [ERROR] 'docker' folder not found.
    pause
    exit /b
)
cd docker

:: Stop containers
docker compose down

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Failed to stop services.
    pause
    exit /b
)

echo ==========================================
echo [SUCCESS] Dify has been stopped.
echo ==========================================
pause
