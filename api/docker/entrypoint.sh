#!/bin/bash

set -e

# Set UTF-8 encoding to address potential encoding issues in containerized environments
# Use C.UTF-8 which is universally available in all containers
export LANG=${LANG:-C.UTF-8}
export LC_ALL=${LC_ALL:-C.UTF-8}
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
      DEFAULT_QUEUES="dataset,priority_dataset,priority_pipeline,pipeline,mail,ops_trace,app_deletion,plugin,workflow_storage,conversation,workflow_professional,workflow_team,workflow_sandbox,schedule_poller,schedule_executor,triggered_workflow_dispatcher,trigger_refresh_executor,retention"
    else
      # Community edition (SELF_HOSTED): dataset, pipeline and workflow have separate queues
      DEFAULT_QUEUES="dataset,priority_dataset,priority_pipeline,pipeline,mail,ops_trace,app_deletion,plugin,workflow_storage,conversation,workflow,schedule_poller,schedule_executor,triggered_workflow_dispatcher,trigger_refresh_executor,retention"
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

elif [[ "${MODE}" == "job" ]]; then
  # Job mode: Run a one-time Flask command and exit
  # Pass Flask command and arguments via container args
  # Example K8s usage:
  #   args:
  #   - create-tenant
  #   - --email
  #   - admin@example.com
  #
  # Example Docker usage:
  #   docker run -e MODE=job dify-api:latest create-tenant --email admin@example.com

  if [[ $# -eq 0 ]]; then
    echo "Error: No command specified for job mode."
    echo ""
    echo "Usage examples:"
    echo "  Kubernetes:"
    echo "    args: [create-tenant, --email, admin@example.com]"
    echo ""
    echo "  Docker:"
    echo "    docker run -e MODE=job dify-api create-tenant --email admin@example.com"
    echo ""
    echo "Available commands:"
    echo "  create-tenant, reset-password, reset-email, upgrade-db,"
    echo "  vdb-migrate, install-plugins, and more..."
    echo ""
    echo "Run 'flask --help' to see all available commands."
    exit 1
  fi

  echo "Running Flask job command: flask $*"
  
  # Temporarily disable exit on error to capture exit code
  set +e
  flask "$@"
  JOB_EXIT_CODE=$?
  set -e

  if [[ ${JOB_EXIT_CODE} -eq 0 ]]; then
    echo "Job completed successfully."
  else
    echo "Job failed with exit code ${JOB_EXIT_CODE}."
  fi

  exit ${JOB_EXIT_CODE}

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
