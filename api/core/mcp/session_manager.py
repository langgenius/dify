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

        expired_record: McpSessionRecord | None = None
        with self._lock:
            record = self._sessions.get(key)
            if record:
                if not self._is_record_expired(record):
                    record.touch()
                    return record.client
                # Expired record
                self._sessions.pop(key, None)
                expired_record = record

        if expired_record:
            expired_record.close()

        client = factory()
        record = McpSessionRecord(client=client, last_used_at=datetime.now(UTC))

        existing: McpSessionRecord | None = None
        expired_existing: McpSessionRecord | None = None
        existing_client: MCPClient | None = None
        with self._lock:
            existing = self._sessions.get(key)
            if existing and self._is_record_expired(existing):
                # Another thread created a session that expired before we could store ours
                self._sessions.pop(key, None)
                expired_existing = existing
                existing = None
            if existing:
                # Another thread created a valid session while we were constructing ours
                existing.touch()
                existing_client = existing.client
            else:
                # Our record becomes authoritative
                self._sessions[key] = record

        if expired_existing:
            expired_existing.close()
        if existing_client is not None:
            record.close()
            return existing_client

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


@dataclass
class WorkflowManagerRecord:
    """Metadata wrapper for a workflow execution's session manager."""

    manager: McpSessionManager
    last_accessed_at: datetime


class McpSessionRegistry:
    """Global registry mapping workflow execution IDs to their session managers."""

    _lock = threading.Lock()
    _registry: dict[str, WorkflowManagerRecord] = {}
    # Registry entries are opportunistically cleaned up after this idle period
    _ttl: timedelta = timedelta(minutes=20)

    @classmethod
    def get_manager(cls, workflow_execution_id: str) -> McpSessionManager:
        expired_records: list[WorkflowManagerRecord] = []

        with cls._lock:
            now = datetime.now(UTC)
            expired_records = cls._cleanup_expired(now)

            record = cls._registry.get(workflow_execution_id)
            if record is None:
                record = WorkflowManagerRecord(manager=McpSessionManager(), last_accessed_at=now)
                cls._registry[workflow_execution_id] = record
            else:
                record.last_accessed_at = now

            manager = record.manager

        for record in expired_records:
            record.manager.cleanup()

        return manager

    @classmethod
    def cleanup(cls, workflow_execution_id: str) -> None:
        with cls._lock:
            record = cls._registry.pop(workflow_execution_id, None)

        if record:
            record.manager.cleanup()

    @classmethod
    def _cleanup_expired(cls, now: datetime) -> list[WorkflowManagerRecord]:
        if cls._ttl is None:
            return []

        expired_records: list[WorkflowManagerRecord] = []
        for workflow_id, record in list(cls._registry.items()):
            if now - record.last_accessed_at > cls._ttl:
                expired_records.append(cls._registry.pop(workflow_id))
        return expired_records
