#!/bin/bash

# Flask Screen
screen -S flask -dmS flask

# Celery Screen
screen -S celery -dmS celery

# Frontend Screen
screen -S frontend -dmS frontend

# --- Commands in Screen Sessions ---

# Flask
screen -S flask -X stuff "cd api && conda activate dify && flask run --host 0.0.0.0 --port=5001 --debug\n"

# Celery
screen -S celery -X stuff "cd api && conda activate dify && celery -A app.celery worker -P gevent -c 1 -Q dataset,generation,mail --loglevel INFO\n"

# Frontend
screen -S frontend -X stuff "cd web && conda activate dify && npm run start\n"

echo "Application started. Screen sessions: flask, celery, frontend"
