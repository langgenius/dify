"""Helpers for gevent third-party compatibility patching.

Standard library monkey patching must stay framework-owned so it runs at the
earliest safe point for each runtime (for example, Gunicorn gevent workers or
Celery gevent pools). This helper only applies third-party compatibility
patches that must happen after stdlib patching but before application imports
start relying on those libraries.
"""

from __future__ import annotations

_patches_applied = False


def apply_gevent_third_party_patches() -> None:
    """Apply idempotent third-party patches required by the gevent runtime."""
    global _patches_applied  # pylint: disable=global-statement

    if _patches_applied:
        return

    import psycogreen.gevent as pscycogreen_gevent  # type: ignore
    from grpc.experimental import gevent as grpc_gevent  # type: ignore

    grpc_gevent.init_gevent()
    print("gRPC patched with gevent.", flush=True)  # noqa: T201
    pscycogreen_gevent.patch_psycopg()
    print("psycopg2 patched with gevent.", flush=True)  # noqa: T201

    _patches_applied = True
