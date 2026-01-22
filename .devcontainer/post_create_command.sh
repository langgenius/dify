#!/bin/bash
WORKSPACE_ROOT=$(pwd)

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable
cd web && pnpm install
pipx install uv

echo "alias start-api=\"cd $WORKSPACE_ROOT/api && uv run python -m flask run --host 0.0.0.0 --port=5001 --debug\"" >> ~/.bashrc
echo "alias start-worker=\"cd $WORKSPACE_ROOT/api && uv run python -m celery -A app.celery worker -P threads -c 1 --loglevel INFO -Q dataset,priority_dataset,priority_pipeline,pipeline,mail,ops_trace,app_deletion,plugin,workflow_storage,conversation,workflow,schedule_poller,schedule_executor,triggered_workflow_dispatcher,trigger_refresh_executor,retention\"" >> ~/.bashrc
echo "alias start-web=\"cd $WORKSPACE_ROOT/web && pnpm dev:inspect\"" >> ~/.bashrc
echo "alias start-web-prod=\"cd $WORKSPACE_ROOT/web && pnpm build && pnpm start\"" >> ~/.bashrc
echo "alias start-containers=\"cd $WORKSPACE_ROOT/docker && docker-compose -f docker-compose.middleware.yaml -p dify --env-file middleware.env up -d\"" >> ~/.bashrc
echo "alias stop-containers=\"cd $WORKSPACE_ROOT/docker && docker-compose -f docker-compose.middleware.yaml -p dify --env-file middleware.env down\"" >> ~/.bashrc

source /home/vscode/.bashrc
