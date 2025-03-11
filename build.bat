@echo off
set DIR=%~dp0

cd /d %DIR%api
docker build -t dify-api-local:1.0.0 .

cd /d %DIR%web
docker build -t dify-web-local:1.0.0 .

cd /d %DIR%docker
docker-compose up -d api
docker-compose up -d web

echo done
