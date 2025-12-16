#!/bin/bash

set -e

# Set UTF-8 encoding to address potential encoding issues in containerized environments
export LANG=${LANG:-en_US.UTF-8}
export LC_ALL=${LC_ALL:-en_US.UTF-8}
export PYTHONIOENCODING=${PYTHONIOENCODING:-utf-8}

if [[ "${MIGRATION_ENABLED}" == "true" ]]; then
  echo "Running migrations"
  flask upgrade-db
  # Pure migration mode
  if [[ "${MODE}" == "migration" ]]; then
  echo "Migration completed, exiting normally"
  exit 0
  fi
fi

if [[ "${MODE}" == "worker" ]]; then

  # Get the number of available CPU cores
  if [ "${CELERY_AUTO_SCALE,,}" = "true" ]; then
    # Set MAX_WORKERS to the number of available cores if not specified
    AVAILABLE_CORES=$(nproc)
    MAX_WORKERS=${CELERY_MAX_WORKERS:-$AVAILABLE_CORES}
    MIN_WORKERS=${CELERY_MIN_WORKERS:-1}
    CONCURRENCY_OPTION="--autoscale=${MAX_WORKERS},${MIN_WORKERS}"
  else
    CONCURRENCY_OPTION="-c ${CELERY_WORKER_AMOUNT:-1}"
  fi

  # Configure queues based on edition if not explicitly set
  if [[ -z "${CELERY_QUEUES}" ]]; then
    if [[ "${EDITION}" == "CLOUD" ]]; then
      # Cloud edition: separate queues for dataset and trigger tasks
      DEFAULT_QUEUES="dataset,priority_dataset,priority_pipeline,pipeline,mail,ops_trace,app_deletion,plugin,workflow_storage,conversation,workflow_professional,workflow_team,workflow_sandbox,schedule_poller,schedule_executor,triggered_workflow_dispatcher,trigger_refresh_executor"
    else
      # Community edition (SELF_HOSTED): dataset, pipeline and workflow have separate queues
      DEFAULT_QUEUES="dataset,priority_dataset,priority_pipeline,pipeline,mail,ops_trace,app_deletion,plugin,workflow_storage,conversation,workflow,schedule_poller,schedule_executor,triggered_workflow_dispatcher,trigger_refresh_executor"
    fi
  else
    DEFAULT_QUEUES="${CELERY_QUEUES}"
  fi

  # Support for Kubernetes deployment with specific queue workers
  # Environment variables that can be set:
  # - CELERY_WORKER_QUEUES: Comma-separated list of queues (overrides CELERY_QUEUES)
  # - CELERY_WORKER_CONCURRENCY: Number of worker processes (overrides CELERY_WORKER_AMOUNT)
  # - CELERY_WORKER_POOL: Pool implementation (overrides CELERY_WORKER_CLASS)

  if [[ -n "${CELERY_WORKER_QUEUES}" ]]; then
    DEFAULT_QUEUES="${CELERY_WORKER_QUEUES}"
    echo "Using CELERY_WORKER_QUEUES: ${DEFAULT_QUEUES}"
  fi

  if [[ -n "${CELERY_WORKER_CONCURRENCY}" ]]; then
    CONCURRENCY_OPTION="-c ${CELERY_WORKER_CONCURRENCY}"
    echo "Using CELERY_WORKER_CONCURRENCY: ${CELERY_WORKER_CONCURRENCY}"
  fi

  WORKER_POOL="${CELERY_WORKER_POOL:-${CELERY_WORKER_CLASS:-gevent}}"
  echo "Starting Celery worker with queues: ${DEFAULT_QUEUES}"

  exec celery -A celery_entrypoint.celery worker -P ${WORKER_POOL} $CONCURRENCY_OPTION \
    --max-tasks-per-child ${MAX_TASKS_PER_CHILD:-50} --loglevel ${LOG_LEVEL:-INFO} \
    -Q ${DEFAULT_QUEUES} \
    --prefetch-multiplier=${CELERY_PREFETCH_MULTIPLIER:-1}

elif [[ "${MODE}" == "beat" ]]; then
  exec celery -A app.celery beat --loglevel ${LOG_LEVEL:-INFO}
else
  if [[ "${DEBUG}" == "true" ]]; then
    exec flask run --host=${DIFY_BIND_ADDRESS:-0.0.0.0} --port=${DIFY_PORT:-5001} --debug
  else
    exec gunicorn \
      --bind "${DIFY_BIND_ADDRESS:-0.0.0.0}:${DIFY_PORT:-5001}" \
      --workers ${SERVER_WORKER_AMOUNT:-1} \
      --worker-class ${SERVER_WORKER_CLASS:-gevent} \
      --worker-connections ${SERVER_WORKER_CONNECTIONS:-10} \
      --timeout ${GUNICORN_TIMEOUT:-200} \
      app:app
  fi
fi
