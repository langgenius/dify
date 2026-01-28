"""
Sandbox: A managed virtual environment instance.

This module uses gevent.event.Event instead of threading.Event to ensure
proper cooperative scheduling in gevent-based WSGI servers like Gunicorn.

Using native threading.Event in a gevent environment can cause issues because:
1. threading.Event.wait() blocks the entire thread, not just the greenlet
2. This prevents other greenlets from running while waiting
3. Can lead to apparent "freezes" when multiple greenlets wait on events

By using gevent.event.Event, wait() calls cooperatively yield to other greenlets.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from gevent.event import Event

from libs.attr_map import AttrMap

if TYPE_CHECKING:
    from core.sandbox.storage.sandbox_storage import SandboxStorage
    from core.virtual_environment.__base.virtual_environment import VirtualEnvironment

logger = logging.getLogger(__name__)


class Sandbox:
    def __init__(
        self,
        *,
        vm: VirtualEnvironment,
        storage: SandboxStorage,
        tenant_id: str,
        user_id: str,
        app_id: str,
        assets_id: str,
    ) -> None:
        self._vm = vm
        self._storage = storage
        self._tenant_id = tenant_id
        self._user_id = user_id
        self._app_id = app_id
        self._assets_id = assets_id
        self._attributes = AttrMap()
        self._ready_event: Event = Event()  # gevent Event for cooperative waiting
        self._cancel_event: Event = Event()  # gevent Event for cooperative waiting
        self._init_error: Exception | None = None

    @property
    def attrs(self) -> AttrMap:
        return self._attributes

    @property
    def vm(self) -> VirtualEnvironment:
        return self._vm

    @property
    def storage(self) -> SandboxStorage:
        return self._storage

    @property
    def tenant_id(self) -> str:
        return self._tenant_id

    @property
    def user_id(self) -> str:
        return self._user_id

    @property
    def app_id(self) -> str:
        return self._app_id

    @property
    def assets_id(self) -> str:
        return self._assets_id

    def mark_ready(self) -> None:
        # Signal that sandbox initialization has completed successfully.
        self._ready_event.set()

    def mark_failed(self, error: Exception) -> None:
        # Capture initialization error and unblock waiters.
        self._init_error = error
        self._ready_event.set()

    def cancel_init(self) -> None:
        # Mark initialization as cancelled to stop background setup.
        self._cancel_event.set()
        self._ready_event.set()

    def is_cancelled(self) -> bool:
        return self._cancel_event.is_set()

    def wait_ready(self, timeout: float | None = None) -> None:
        # Block until initialization completes, fails, or is cancelled.
        if not self._ready_event.wait(timeout=timeout):
            raise TimeoutError("Sandbox initialization timed out")
        if self._cancel_event.is_set():
            raise RuntimeError("Sandbox initialization was cancelled")
        if self._init_error is not None:
            if isinstance(self._init_error, ValueError):
                raise RuntimeError(f"Sandbox initialization failed: {self._init_error}") from self._init_error
            else:
                raise RuntimeError("Sandbox initialization failed") from self._init_error

    def mount(self) -> bool:
        return self._storage.mount(self._vm)

    def unmount(self) -> bool:
        return self._storage.unmount(self._vm)

    def release(self) -> None:
        self.cancel_init()
        sandbox_id = self._vm.metadata.id
        try:
            self._storage.unmount(self._vm)
            logger.info("Sandbox storage unmounted: sandbox_id=%s", sandbox_id)
        except Exception:
            logger.exception("Failed to unmount sandbox storage: sandbox_id=%s", sandbox_id)

        try:
            self._vm.release_environment()
            logger.info("Sandbox released: sandbox_id=%s", sandbox_id)
        except Exception:
            logger.exception("Failed to release sandbox: sandbox_id=%s", sandbox_id)
