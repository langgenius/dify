import logging
import threading
from typing import Final

from core.virtual_environment.__base.virtual_environment import VirtualEnvironment

logger = logging.getLogger(__name__)


class SandboxManager:
    _lock: Final[threading.Lock] = threading.Lock()
    _sandboxes: dict[str, VirtualEnvironment] = {}

    @classmethod
    def register(cls, workflow_execution_id: str, sandbox: VirtualEnvironment) -> None:
        if not workflow_execution_id:
            raise ValueError("workflow_execution_id cannot be empty")

        with cls._lock:
            if workflow_execution_id in cls._sandboxes:
                raise RuntimeError(
                    f"Sandbox already registered for workflow_execution_id={workflow_execution_id}. "
                    "Call unregister() first if you need to replace it."
                )
            cls._sandboxes[workflow_execution_id] = sandbox
            logger.debug(
                "Registered sandbox for workflow_execution_id=%s, sandbox_id=%s",
                workflow_execution_id,
                sandbox.metadata.id,
            )

    @classmethod
    def get(cls, workflow_execution_id: str) -> VirtualEnvironment | None:
        with cls._lock:
            return cls._sandboxes.get(workflow_execution_id)

    @classmethod
    def unregister(cls, workflow_execution_id: str) -> VirtualEnvironment | None:
        with cls._lock:
            sandbox = cls._sandboxes.pop(workflow_execution_id, None)
            if sandbox:
                logger.debug(
                    "Unregistered sandbox for workflow_execution_id=%s, sandbox_id=%s",
                    workflow_execution_id,
                    sandbox.metadata.id,
                )
            return sandbox

    @classmethod
    def has(cls, workflow_execution_id: str) -> bool:
        with cls._lock:
            return workflow_execution_id in cls._sandboxes

    @classmethod
    def clear(cls) -> None:
        with cls._lock:
            cls._sandboxes.clear()
            logger.debug("Cleared all registered sandboxes")

    @classmethod
    def count(cls) -> int:
        with cls._lock:
            return len(cls._sandboxes)
