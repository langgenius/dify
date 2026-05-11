"""Helpers for gevent bootstrap compatibility and runtime guards.

Standard library monkey patching must stay framework-owned so it runs at the
earliest safe point for each runtime (for example, Gunicorn gevent workers or
Celery gevent pools). This helper only applies third-party compatibility
patches that must happen after stdlib patching but before application imports
start relying on those libraries.
"""

from __future__ import annotations

import sys
from collections.abc import Sequence

_patches_applied = False
_required_patched_modules = ("socket", "threading", "queue")


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


def require_gevent_monkey_patched(entrypoint: str) -> None:
    """Exit early when a supported gevent entrypoint is not fully patched."""
    from gevent import monkey

    missing_modules = [module for module in _required_patched_modules if not monkey.is_module_patched(module)]
    if not missing_modules:
        return

    print(  # noqa: T201
        "Fatal: gevent monkey patching is missing for "
        f"{entrypoint}. Missing modules: {', '.join(missing_modules)}. "
        "Use the supported Gunicorn or Celery gevent startup path.",
        file=sys.stderr,
        flush=True,
    )
    raise SystemExit(1)


def is_celery_gevent_worker_process(argv: Sequence[str] | None = None) -> bool:
    """Return whether the current Celery invocation is a gevent worker."""
    args = list(sys.argv if argv is None else argv)
    if "worker" not in args:
        return False

    for index, arg in enumerate(args):
        if arg == "-P" and index + 1 < len(args):
            return args[index + 1] == "gevent"
        if arg == "--pool" and index + 1 < len(args):
            return args[index + 1] == "gevent"
        if arg.startswith("--pool="):
            return arg.partition("=")[2] == "gevent"

    return False
