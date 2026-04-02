# This module provides a lightweight Celery instance for use in Docker health checks.
# Unlike celery_entrypoint.py, this does NOT import app.py and therefore avoids
# initializing all Flask extensions (DB, Redis, storage, blueprints, etc.).
# Using this module keeps the health check fast and low-cost.
from celery import Celery

from configs import dify_config
from extensions.ext_celery import get_celery_broker_transport_options, get_celery_ssl_options

celery = Celery(broker=dify_config.CELERY_BROKER_URL)

broker_transport_options = get_celery_broker_transport_options()
if broker_transport_options:
    celery.conf.update(broker_transport_options=broker_transport_options)

ssl_options = get_celery_ssl_options()
if ssl_options:
    celery.conf.update(broker_use_ssl=ssl_options)
