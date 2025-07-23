#!/bin/sh
uv sync
uv run flask db upgrade
nohup uv run flask run --host 0.0.0.0 --port=5001 --debug > api.log 2>&1 &
nohup uv run celery -A app.celery worker -P gevent -c 1 --loglevel DEBUG -Q dataset,generation,mail,ops_trace > worker.log 2>&1 &

