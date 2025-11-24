from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from core.mcp.mcp_client import MCPClient

logger = logging.getLogger(__name__)


@dataclass
class McpSessionRecord:
    """Container for a live MCP session."""

    client: MCPClient
    last_used_at: datetime

    def touch(self) -> None:
        self.last_used_at = datetime.now(UTC)

    def close(self) -> None:
        try:
            self.client.cleanup()
        except Exception:
            logger.debug("Failed to cleanup MCP client", exc_info=True)


class McpSessionManager:
    """Manage MCPClient instances that should persist for the duration of a workflow run."""

    def __init__(self, idle_timeout: timedelta | None = timedelta(minutes=10)) -> None:
        self._sessions: dict[str, McpSessionRecord] = {}
        self._lock = threading.Lock()
        self._idle_timeout = idle_timeout

    def acquire(self, key: str, factory: Callable[[], MCPClient]) -> MCPClient:
        """Return an initialized MCPClient for the given key, creating one if necessary."""

        with self._lock:
            record = self._sessions.get(key)
            if record:
                if not self._is_record_expired(record):
                    record.touch()
                    return record.client
                # Expired record
                self._sessions.pop(key, None)
                record.close()

        client = factory()
        record = McpSessionRecord(client=client, last_used_at=datetime.now(UTC))

        with self._lock:
            self._sessions[key] = record

        return client

    def invalidate(self, key: str) -> None:
        """Dispose the session associated with the key."""

        with self._lock:
            record = self._sessions.pop(key, None)

        if record:
            record.close()

    def cleanup(self) -> None:
        """Dispose all tracked sessions."""

        with self._lock:
            records = list(self._sessions.values())
            self._sessions.clear()

        for record in records:
            record.close()

    def _is_record_expired(self, record: McpSessionRecord) -> bool:
        if self._idle_timeout is None:
            return False
        return datetime.now(UTC) - record.last_used_at > self._idle_timeout


class McpSessionRegistry:
    """Global registry mapping workflow execution IDs to their session managers."""

    _lock = threading.Lock()
    _registry: dict[str, McpSessionManager] = {}

    @classmethod
    def get_manager(cls, workflow_execution_id: str) -> McpSessionManager:
        with cls._lock:
            manager = cls._registry.get(workflow_execution_id)
            if manager is None:
                manager = McpSessionManager()
                cls._registry[workflow_execution_id] = manager
            return manager

    @classmethod
    def cleanup(cls, workflow_execution_id: str) -> None:
        with cls._lock:
            manager = cls._registry.pop(workflow_execution_id, None)

        if manager:
            manager.cleanup()
