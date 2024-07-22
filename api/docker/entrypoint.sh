#!/bin/bash

set -e

if [[ "${MIGRATION_ENABLED}" == "true" ]]; then
  echo "Running migrations"
  flask upgrade-db
fi

if [[ "${MODE}" == "worker" ]]; then
  exec celery -A app.celery worker -P ${CELERY_WORKER_CLASS:-gevent} -c ${CELERY_WORKER_AMOUNT:-1} --loglevel INFO \
    -Q ${CELERY_QUEUES:-dataset,generation,mail,ops_trace,app_deletion}
elif [[ "${MODE}" == "beat" ]]; then
  exec celery -A app.celery beat --loglevel INFO
else
  if [[ "${DEBUG}" == "true" ]]; then
    exec flask run --host=${DIFY_BIND_ADDRESS:-0.0.0.0} --port=${DIFY_PORT:-5001} --debug
  else
    exec gunicorn \
      --bind "${DIFY_BIND_ADDRESS:-0.0.0.0}:${DIFY_PORT:-5001}" \
      --workers ${SERVER_WORKER_AMOUNT:-1} \
      --worker-class ${SERVER_WORKER_CLASS:-gevent} \
      --timeout ${GUNICORN_TIMEOUT:-200} \
      --preload \
      app:app
  fi
fi
