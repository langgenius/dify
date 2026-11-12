"""Cold-spawn bootstrap for the dedicated External Agent process pool.

The Celery pool remains prefork, preserving process recycling and POSIX task
timeouts. Its process start method is spawn: native storage/runtime objects and
threads from the parent application never cross into a task process. Child
unpickling imports this same bootstrap and rebuilds the complete local Dify
application rather than serializing a parent FlaskTask closure or Flask app.
"""

import os
from collections.abc import Callable
from typing import Any, Literal, Protocol, runtime_checkable

import billiard
from celery import Celery
from gevent.monkey import is_module_patched


@runtime_checkable
class _SpawnStartMethod(Protocol):
    """Billiard exports this default-context delegate dynamically."""

    def set_start_method(self, method: Literal["spawn"], *, force: bool) -> None: ...


def process_local_celery(parent_pid: int) -> Celery:
    """Resolve the fully initialized application in this newly spawned process.

    Pickle calls this module-level function after importing this bootstrap.
    Import completion establishes the database, models, composition root and
    existing Flask task context wrapper before any command can execute. In a
    cold child, the exec marker tells Celery's own process_initializer to build
    its fast-trace cache with the real worker hostname. Parent deserialization
    leaves the parent environment unchanged.
    """
    if os.getpid() != parent_pid:
        os.environ["FORKED_BY_MULTIPROCESSING"] = "1"
    return celery


class ExternalSpawnCelery(Celery):
    """Serialize only a bootstrap reference, never parent runtime resources."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        """Forward trusted composition options with a bounded cold-start window.

        Importing the full Dify application may exceed the process pool's four
        second warm-fork default. This readiness limit governs only process
        initialization; each command keeps its original soft/hard and I/O limits.
        """
        super().__init__(*args, **kwargs)
        self.conf.worker_proc_alive_timeout = 60

    def __reduce__(self) -> tuple[Callable[[int], Celery], tuple[int]]:
        """Reconstruct the image/env-configured Dify app in the target process."""
        return process_local_celery, (os.getpid(),)


if is_module_patched("socket"):
    raise RuntimeError("The dedicated External Agent worker requires an unpatched native process pool.")

# Select the start method and factory before importing the shared application.
# Billiard's prefork pool retains this explicit spawn context; it does not force
# fork merely because the Celery pool implementation is named prefork.
if not isinstance(billiard, _SpawnStartMethod):
    raise RuntimeError("The installed Billiard runtime does not expose process start-method selection.")
billiard.set_start_method("spawn", force=True)

from extensions.ext_celery import configure_worker_application_factory  # noqa: E402

configure_worker_application_factory(ExternalSpawnCelery)

from celery_entrypoint import app, celery  # noqa: E402

__all__ = ["app", "celery"]
