"""Contracts and stable lock names for knowledge-index mutations."""

from contextlib import AbstractContextManager
from typing import Protocol


class KnowledgeIndexingLockBusyError(RuntimeError):
    """Another owner currently holds the requested indexing lease."""


class KnowledgeIndexingLeaseLostError(RuntimeError):
    """The caller no longer owns its indexing lease."""


class KnowledgeIndexingLease(Protocol):
    @property
    def token(self) -> str: ...

    def assert_owned(self) -> None: ...

    def renew(self) -> bool: ...

    def release(self) -> bool: ...


class KnowledgeIndexingLock(Protocol):
    def try_acquire(self, name: str, *, timeout: int) -> KnowledgeIndexingLease | None: ...

    def try_acquire_handoff(
        self,
        name: str,
        *,
        timeout: int,
        owner_id: str,
    ) -> KnowledgeIndexingLease | None: ...

    def hold(
        self,
        name: str,
        *,
        timeout: int,
        expected_token: str | None = None,
        blocking_timeout: float = 0,
    ) -> AbstractContextManager[KnowledgeIndexingLease]: ...

    def hold_handoff(
        self,
        name: str,
        *,
        timeout: int,
        owner_id: str,
        blocking_timeout: float = 0,
    ) -> AbstractContextManager[KnowledgeIndexingLease]: ...


def dataset_index_lock_name(dataset_id: str) -> str:
    return f"knowledge:indexing:dataset:{dataset_id}"


def document_index_lock_name(document_id: str) -> str:
    return f"document_{document_id}_is_retried"


def segment_status_lock_name(document_id: str) -> str:
    return f"knowledge:indexing:segment-status:{document_id}"
