#!/bin/bash
WORKSPACE_ROOT=$(pwd)

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable
cd web && pnpm install
pipx install uv

echo "alias start-api=\"cd $WORKSPACE_ROOT/api && uv run python -m flask run --host 0.0.0.0 --port=5001 --debug\"" >> ~/.bashrc
echo "alias start-worker=\"$WORKSPACE_ROOT/dev/start-worker --pool threads\"" >> ~/.bashrc
echo "alias start-web=\"cd $WORKSPACE_ROOT/web && pnpm dev\"" >> ~/.bashrc
echo "alias start-web-prod=\"cd $WORKSPACE_ROOT/web && pnpm build && pnpm start\"" >> ~/.bashrc
echo "alias start-containers=\"cd $WORKSPACE_ROOT/docker && docker-compose -f docker-compose.middleware.yaml -p dify --env-file middleware.env up -d\"" >> ~/.bashrc
echo "alias stop-containers=\"cd $WORKSPACE_ROOT/docker && docker-compose -f docker-compose.middleware.yaml -p dify --env-file middleware.env down\"" >> ~/.bashrc

source /home/vscode/.bashrc
