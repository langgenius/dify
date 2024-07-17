#!/bin/bash

set -e

if [[ "${MIGRATION_ENABLED}" == "true" ]]; then
  echo "Running migrations"
  flask upgrade-db
fi

if [[ "${MODE}" == "worker" ]]; then
  # Get the number of available CPU cores
  AVAILABLE_CORES=$(nproc)

  if [ "${CELERY_AUTO_SCALE,,}" = "true" ]; then
    # Set MAX_WORKERS to the number of available cores if not specified
    MAX_WORKERS=${CELERY_MAX_WORKERS:-$AVAILABLE_CORES}
    MIN_WORKERS=${CELERY_MIN_WORKERS:-1}
    CONCURRENCY_OPTION="--autoscale=${MAX_WORKERS},${MIN_WORKERS}"
  else
    # If auto-scale is not enabled, use the number of available cores as the default
    WORKER_AMOUNT=${CELERY_WORKER_AMOUNT:-$AVAILABLE_CORES}
    CONCURRENCY_OPTION="-c ${WORKER_AMOUNT}"
  fi

  celery -A app.celery worker -P ${CELERY_WORKER_CLASS:-gevent} $CONCURRENCY_OPTION --loglevel INFO \
    -Q ${CELERY_QUEUES:-dataset,generation,mail}
elif [[ "${MODE}" == "beat" ]]; then
  celery -A app.celery beat --loglevel INFO
else
  if [[ "${DEBUG}" == "true" ]]; then
    flask run --host=${DIFY_BIND_ADDRESS:-0.0.0.0} --port=${DIFY_PORT:-5001} --debug
  else
    gunicorn \
      --bind "${DIFY_BIND_ADDRESS:-0.0.0.0}:${DIFY_PORT:-5001}" \
      --workers ${SERVER_WORKER_AMOUNT:-1} \
      --worker-class ${SERVER_WORKER_CLASS:-gevent} \
      --timeout ${GUNICORN_TIMEOUT:-200} \
      --preload \
      app:app
  fi
fi