#!/bin/bash

set -x

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
cd "$SCRIPT_DIR/.."


uv --directory api run \
  celery -A app.celery worker \
  -P gevent -c 1 --loglevel INFO -Q dataset,generation,mail,ops_trace,app_deletion
