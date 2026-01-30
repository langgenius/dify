from __future__ import annotations

import logging
import threading
from typing import TYPE_CHECKING, Final

if TYPE_CHECKING:
    from core.sandbox.sandbox import Sandbox

logger = logging.getLogger(__name__)


class SandboxManager:
    """Registry for active Sandbox instances.

    Stores complete Sandbox objects (not just VirtualEnvironment) to provide
    access to sandbox metadata like tenant_id, app_id, user_id, assets_id.
    """

    _NUM_SHARDS: Final[int] = 1024
    _SHARD_MASK: Final[int] = _NUM_SHARDS - 1

    _shard_locks: Final[tuple[threading.Lock, ...]] = tuple(threading.Lock() for _ in range(_NUM_SHARDS))
    _shards: list[dict[str, Sandbox]] = [{} for _ in range(_NUM_SHARDS)]

    @classmethod
    def _shard_index(cls, sandbox_id: str) -> int:
        return hash(sandbox_id) & cls._SHARD_MASK

    @classmethod
    def register(cls, sandbox_id: str, sandbox: Sandbox) -> None:
        if not sandbox_id:
            raise ValueError("sandbox_id cannot be empty")

        shard_index = cls._shard_index(sandbox_id)
        with cls._shard_locks[shard_index]:
            shard = cls._shards[shard_index]
            if sandbox_id in shard:
                raise RuntimeError(
                    f"Sandbox already registered for sandbox_id={sandbox_id}. "
                    "Call unregister() first if you need to replace it."
                )

            new_shard = dict(shard)
            new_shard[sandbox_id] = sandbox
            cls._shards[shard_index] = new_shard

        logger.debug(
            "Registered sandbox: sandbox_id=%s, vm_id=%s, app_id=%s",
            sandbox_id,
            sandbox.vm.metadata.id,
            sandbox.app_id,
        )

    @classmethod
    def get(cls, sandbox_id: str) -> Sandbox | None:
        shard_index = cls._shard_index(sandbox_id)
        return cls._shards[shard_index].get(sandbox_id)

    @classmethod
    def unregister(cls, sandbox_id: str) -> Sandbox | None:
        shard_index = cls._shard_index(sandbox_id)
        with cls._shard_locks[shard_index]:
            shard = cls._shards[shard_index]
            sandbox = shard.get(sandbox_id)
            if sandbox is None:
                return None

            new_shard = dict(shard)
            new_shard.pop(sandbox_id, None)
            cls._shards[shard_index] = new_shard

        logger.debug(
            "Unregistered sandbox: sandbox_id=%s, vm_id=%s",
            sandbox_id,
            sandbox.vm.metadata.id,
        )
        return sandbox

    @classmethod
    def has(cls, sandbox_id: str) -> bool:
        shard_index = cls._shard_index(sandbox_id)
        return sandbox_id in cls._shards[shard_index]

    @classmethod
    def is_sandbox_runtime(cls, sandbox_id: str) -> bool:
        return cls.has(sandbox_id)

    @classmethod
    def clear(cls) -> None:
        for lock in cls._shard_locks:
            lock.acquire()
        try:
            for i in range(cls._NUM_SHARDS):
                cls._shards[i] = {}
            logger.debug("Cleared all registered sandboxes")
        finally:
            for lock in reversed(cls._shard_locks):
                lock.release()

    @classmethod
    def count(cls) -> int:
        return sum(len(shard) for shard in cls._shards)
