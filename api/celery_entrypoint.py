"""Celery entrypoint with gevent compatibility patching.

Celery owns stdlib gevent patch timing via the selected pool. This module only
applies third-party compatibility patches before importing the application
module so worker and beat processes share the same runtime assumptions as the
API server.
"""

from libs.gevent_compat import apply_gevent_third_party_patches

apply_gevent_third_party_patches()

from app import app, celery

__all__ = ["app", "celery"]
