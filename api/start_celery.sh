#!/bin/bash

# Activate the poetry environment
source $(poetry env info --path)/bin/activate

# Navigate to the project directory
cd /home/ganeshji/difyown/api

# Start the Celery worker
celery -A app.celery worker -P gevent -c 1 --loglevel INFO -Q dataset,generation,mail,ops_trace
