import logging
import threading
from typing import Final

from core.virtual_environment.__base.virtual_environment import VirtualEnvironment

logger = logging.getLogger(__name__)


class SandboxManager:
    """Process-local registry for workflow sandboxes.

    Stores `VirtualEnvironment` references keyed by `workflow_execution_id`.

    Concurrency: the registry is split into hash shards and each shard is updated with
    copy-on-write under a shard lock. Reads are lock-free (snapshot dict) to reduce
    contention in hot paths like `get()`.
    """

    # FIXME:(sandbox) Prefer a workflow-level context on GraphRuntimeState to store workflow-scoped shared objects.

    _NUM_SHARDS: Final[int] = 1024
    _SHARD_MASK: Final[int] = _NUM_SHARDS - 1

    _shard_locks: Final[tuple[threading.Lock, ...]] = tuple(threading.Lock() for _ in range(_NUM_SHARDS))
    _shards: list[dict[str, VirtualEnvironment]] = [{} for _ in range(_NUM_SHARDS)]

    @classmethod
    def _shard_index(cls, workflow_execution_id: str) -> int:
        return hash(workflow_execution_id) & cls._SHARD_MASK

    @classmethod
    def register(cls, workflow_execution_id: str, sandbox: VirtualEnvironment) -> None:
        if not workflow_execution_id:
            raise ValueError("workflow_execution_id cannot be empty")

        shard_index = cls._shard_index(workflow_execution_id)
        with cls._shard_locks[shard_index]:
            shard = cls._shards[shard_index]
            if workflow_execution_id in shard:
                raise RuntimeError(
                    f"Sandbox already registered for workflow_execution_id={workflow_execution_id}. "
                    "Call unregister() first if you need to replace it."
                )

            new_shard = dict(shard)
            new_shard[workflow_execution_id] = sandbox
            cls._shards[shard_index] = new_shard

        logger.debug(
            "Registered sandbox for workflow_execution_id=%s, sandbox_id=%s",
            workflow_execution_id,
            sandbox.metadata.id,
        )

    @classmethod
    def get(cls, workflow_execution_id: str) -> VirtualEnvironment | None:
        shard_index = cls._shard_index(workflow_execution_id)
        return cls._shards[shard_index].get(workflow_execution_id)

    @classmethod
    def unregister(cls, workflow_execution_id: str) -> VirtualEnvironment | None:
        shard_index = cls._shard_index(workflow_execution_id)
        with cls._shard_locks[shard_index]:
            shard = cls._shards[shard_index]
            sandbox = shard.get(workflow_execution_id)
            if sandbox is None:
                return None

            new_shard = dict(shard)
            new_shard.pop(workflow_execution_id, None)
            cls._shards[shard_index] = new_shard

        logger.debug(
            "Unregistered sandbox for workflow_execution_id=%s, sandbox_id=%s",
            workflow_execution_id,
            sandbox.metadata.id,
        )
        return sandbox

    @classmethod
    def has(cls, workflow_execution_id: str) -> bool:
        shard_index = cls._shard_index(workflow_execution_id)
        return workflow_execution_id in cls._shards[shard_index]

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
