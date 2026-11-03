"""Persistence boundary for durable KnowledgeFS lifecycle commands."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Protocol

from models.knowledge_fs import KnowledgeFSLifecycleOperation, KnowledgeFSLifecycleOutbox


class KnowledgeFSLifecycleOutboxRepository(Protocol):
    def add(self, command: KnowledgeFSLifecycleOutbox) -> KnowledgeFSLifecycleOutbox: ...

    def get(self, *, outbox_id: str) -> KnowledgeFSLifecycleOutbox | None: ...

    def get_by_operation_id(self, *, tenant_id: str, operation_id: str) -> KnowledgeFSLifecycleOutbox | None: ...

    def find_open_for_control_space(
        self,
        *,
        tenant_id: str,
        control_space_id: str,
        operation: KnowledgeFSLifecycleOperation,
    ) -> KnowledgeFSLifecycleOutbox | None: ...

    def find_latest_for_control_space(
        self,
        *,
        tenant_id: str,
        control_space_id: str,
        operation: KnowledgeFSLifecycleOperation,
    ) -> KnowledgeFSLifecycleOutbox | None: ...

    def reactivate_dead_letter(self, *, outbox_id: str) -> bool: ...

    def supersede_unattempted(
        self,
        *,
        outbox_id: str,
        completed_at: datetime,
        error_code: str,
        error_message: str,
    ) -> bool: ...

    def supersede_after_remote_absence(
        self,
        *,
        outbox_id: str,
        observed_at: datetime,
        error_code: str,
        error_message: str,
    ) -> bool: ...

    def claim_next(
        self,
        *,
        lease_owner: str,
        now: datetime,
        lease_duration: timedelta,
        allowed_operations: tuple[KnowledgeFSLifecycleOperation, ...],
    ) -> KnowledgeFSLifecycleOutbox | None: ...

    def acknowledge(
        self,
        *,
        outbox_id: str,
        lease_owner: str,
        expected_lease_expires_at: datetime,
        completed_at: datetime,
    ) -> bool: ...

    def schedule_retry(
        self,
        *,
        outbox_id: str,
        lease_owner: str,
        expected_lease_expires_at: datetime,
        next_attempt_at: datetime,
        error_code: str,
        error_message: str,
    ) -> bool: ...

    def mark_dead_letter(
        self,
        *,
        outbox_id: str,
        lease_owner: str,
        expected_lease_expires_at: datetime,
        completed_at: datetime,
        error_code: str,
        error_message: str,
    ) -> bool: ...


__all__ = ["KnowledgeFSLifecycleOutboxRepository"]
