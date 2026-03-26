@echo off
title Dify Launcher
echo ==========================================
echo       Dify LLM Application Platform
echo ==========================================

:: Step 1
echo [1/3] Checking environment...
if not exist "docker" (
    echo [ERROR] 'docker' folder not found.
    pause
    exit /b
)
cd docker

:: Step 2
if not exist ".env" (
    echo [2/3] Preparing .env file...
    copy .env.example .env >nul
)

:: Step 3
echo [3/3] Starting Dify containers...
docker compose up -d

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Docker deployment failed.
    echo Please make sure Docker Desktop is RUNNING.
    pause
    exit /b
)

echo ==========================================
echo [SUCCESS] Dify is now running!
echo Opening: http://localhost
echo ==========================================
timeout /t 3 >nul
start http://localhost

echo Enjoy!
pause
