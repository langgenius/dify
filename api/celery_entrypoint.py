"""Celery entrypoint with gevent compatibility patching.

Celery owns stdlib gevent patch timing via the selected pool. This module only
applies third-party compatibility patches before importing the application
module so worker and beat processes share the same runtime assumptions as the
API server.
"""

from _dify_gevent_bootstrap.gevent_compat import apply_gevent_third_party_patches
from _dify_gevent_bootstrap.gevent_compat import is_celery_gevent_worker_process
from _dify_gevent_bootstrap.gevent_compat import require_gevent_monkey_patched

if is_celery_gevent_worker_process():
    require_gevent_monkey_patched("Celery gevent worker")

apply_gevent_third_party_patches()

from app import app, celery

__all__ = ["app", "celery"]
