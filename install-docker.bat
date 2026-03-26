@echo off
title Dify 一鍵安裝 Docker 工具
echo =======================================================
echo            Dify - Docker Desktop 自動安裝程式
echo =======================================================
echo.
echo 正在準備為您下載並安裝 Docker Desktop...
echo 這可能會需要幾分鐘的時間，請耐心等候，直到看到「安裝成功」的提示。
echo.

:: 使用 winget 自動下載並安裝 Docker Desktop
winget install Docker.DockerDesktop --accept-package-agreements --accept-source-agreements

if %errorlevel% neq 0 (
    echo.
    echo [錯誤] 自動安裝 Docker 失敗。可能是您的系統不支援 winget，或是網路連線有問題。
    echo 正在為您打開瀏覽器，請手動下載安裝：
    start https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe
    pause
    exit /b %errorlevel%
)

echo.
echo =======================================================
echo Docker Desktop 安裝成功！🎉
echo =======================================================
echo.
echo [下一步請注意]：
echo 1. 請從「開始」選單中尋找並手動開啟【Docker Desktop】應用程式。
echo 2. 若出現同意條款，請點擊 Accept/同意。
echo 3. 請等待 Docker 系統指示燈變成綠色（引擎啟動完成）。
echo 4. 確認 Docker 啟動後，您就可以關閉這個視窗，並點擊【start-dify.bat】來開啟 Dify！
echo.
pause
