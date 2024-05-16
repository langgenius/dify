#!/bin/bash

cd web && npm install

echo 'alias start-api="cd /workspaces/iechor/api && flask run --host 0.0.0.0 --port=5001 --debug"' >> ~/.bashrc
echo 'alias start-worker="cd /workspaces/iechor/api && celery -A app.celery worker -P gevent -c 1 --loglevel INFO -Q dataset,generation,mail"' >> ~/.bashrc
echo 'alias start-web="cd /workspaces/iechor/web && npm run dev"' >> ~/.bashrc
echo 'alias start-containers="cd /workspaces/iechor/docker && docker-compose -f docker-compose.middleware.yaml -p iechor up -d"' >> ~/.bashrc

source /home/vscode/.bashrc