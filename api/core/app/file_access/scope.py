from __future__ import annotations

import threading
from collections.abc import Generator, Iterable
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom

_current_file_access_scope: ContextVar[FileAccessScope | None] = ContextVar(
    "current_file_access_scope",
    default=None,
)


class _FileAccessGrants:
    """Mutable grant sets shared by every copy of one scope.

    Workflow workers restore a context snapshot taken when the run started
    before each node executes, so grants cannot be recorded by setting a new
    scope on the context variable: the next node would see the original scope
    again. Recording them on an object that the scope references keeps them
    visible to later nodes and to other worker threads of the same run.
    """

    __slots__ = ("_lock", "_retriever_segment_ids", "_upload_file_ids")

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._upload_file_ids: set[str] = set()
        self._retriever_segment_ids: set[str] = set()

    def add_upload_file_ids(self, upload_file_ids: frozenset[str]) -> None:
        with self._lock:
            self._upload_file_ids.update(upload_file_ids)

    def add_retriever_segment_ids(self, segment_ids: frozenset[str]) -> None:
        with self._lock:
            self._retriever_segment_ids.update(segment_ids)

    def upload_file_ids(self) -> frozenset[str]:
        with self._lock:
            return frozenset(self._upload_file_ids)

    def retriever_segment_ids(self) -> frozenset[str]:
        with self._lock:
            return frozenset(self._retriever_segment_ids)


@dataclass(frozen=True, slots=True)
class FileAccessScope:
    """Request-scoped ownership context used by workflow-layer file lookups.

    ``granted_upload_file_ids`` is execution-local: callers may add upload files
    that were returned by trusted retrieval paths without changing persistent
    ownership markers.

    ``granted_retriever_segment_ids`` gates lazy attachment loading by segment
    ID, so user-provided context cannot make a later LLM node load arbitrary
    same-tenant knowledge attachments.
    """

    tenant_id: str
    user_id: str
    user_from: UserFrom
    invoke_from: InvokeFrom
    _grants: _FileAccessGrants = field(default_factory=_FileAccessGrants, init=False, repr=False, compare=False)

    @property
    def requires_user_ownership(self) -> bool:
        return self.user_from == UserFrom.END_USER

    @property
    def granted_upload_file_ids(self) -> frozenset[str]:
        return self._grants.upload_file_ids()

    @property
    def granted_retriever_segment_ids(self) -> frozenset[str]:
        return self._grants.retriever_segment_ids()


def get_current_file_access_scope() -> FileAccessScope | None:
    return _current_file_access_scope.get()


def grant_upload_file_access(upload_file_ids: Iterable[str]) -> None:
    scope = _current_file_access_scope.get()
    if scope is None:
        return

    granted_upload_file_ids = frozenset(str(file_id) for file_id in upload_file_ids if file_id)
    if not granted_upload_file_ids:
        return

    scope._grants.add_upload_file_ids(granted_upload_file_ids)


def grant_retriever_segment_access(segment_ids: Iterable[str]) -> None:
    scope = _current_file_access_scope.get()
    if scope is None:
        return

    granted_segment_ids = frozenset(str(segment_id) for segment_id in segment_ids if segment_id)
    if not granted_segment_ids:
        return

    scope._grants.add_retriever_segment_ids(granted_segment_ids)


def is_retriever_segment_access_granted(segment_id: str) -> bool:
    scope = _current_file_access_scope.get()
    if scope is None or not scope.requires_user_ownership:
        return True
    return str(segment_id) in scope.granted_retriever_segment_ids


@contextmanager
def bind_file_access_scope(scope: FileAccessScope) -> Generator[None, None, None]:
    token = _current_file_access_scope.set(scope)
    try:
        yield
    finally:
        _current_file_access_scope.reset(token)
