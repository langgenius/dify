#!/bin/sh
pkill -f "uv run flask run --host 0.0.0.0 --port=5001"
pkill -f "uv run celery -A app.celery worker"
