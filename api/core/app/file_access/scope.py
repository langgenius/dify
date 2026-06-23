from __future__ import annotations

from collections.abc import Generator, Iterable
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field, replace

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom

_current_file_access_scope: ContextVar[FileAccessScope | None] = ContextVar(
    "current_file_access_scope",
    default=None,
)


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
    granted_upload_file_ids: frozenset[str] = field(default_factory=frozenset)
    granted_retriever_segment_ids: frozenset[str] = field(default_factory=frozenset)

    @property
    def requires_user_ownership(self) -> bool:
        return self.user_from == UserFrom.END_USER


def get_current_file_access_scope() -> FileAccessScope | None:
    return _current_file_access_scope.get()


def grant_upload_file_access(upload_file_ids: Iterable[str]) -> None:
    scope = _current_file_access_scope.get()
    if scope is None:
        return

    granted_upload_file_ids = frozenset(str(file_id) for file_id in upload_file_ids if file_id)
    if not granted_upload_file_ids:
        return

    _current_file_access_scope.set(
        replace(
            scope,
            granted_upload_file_ids=scope.granted_upload_file_ids | granted_upload_file_ids,
        )
    )


def grant_retriever_segment_access(segment_ids: Iterable[str]) -> None:
    scope = _current_file_access_scope.get()
    if scope is None:
        return

    granted_segment_ids = frozenset(str(segment_id) for segment_id in segment_ids if segment_id)
    if not granted_segment_ids:
        return

    _current_file_access_scope.set(
        replace(
            scope,
            granted_retriever_segment_ids=scope.granted_retriever_segment_ids | granted_segment_ids,
        )
    )


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
