@echo off
set DIR=%~dp0

cd /d %DIR%api
docker build -t dify-api-local:1.0.0 .

cd /d %DIR%web
docker build -t dify-web-local:1.0.0 .

cd /d %DIR%docker
docker-compose up -d api worker web
REM docker-compose up -d

echo done
