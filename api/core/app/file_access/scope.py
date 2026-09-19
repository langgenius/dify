from __future__ import annotations

from collections.abc import Generator, Iterable
from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass, field, replace

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access.run_grants import FileAccessRunGrants

_current_file_access_scope: ContextVar[FileAccessScope | None] = ContextVar(
    "current_file_access_scope",
    default=None,
)
_current_file_access_run_grants: ContextVar[FileAccessRunGrants | None] = ContextVar(
    "current_file_access_run_grants",
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


def get_current_file_access_run_grants() -> FileAccessRunGrants | None:
    return _current_file_access_run_grants.get()


def bind_file_access_run_grants(run_grants: FileAccessRunGrants | None) -> Token[FileAccessRunGrants | None]:
    return _current_file_access_run_grants.set(run_grants)


def reset_file_access_run_grants(token: Token[FileAccessRunGrants | None]) -> None:
    _current_file_access_run_grants.reset(token)


def get_effective_granted_upload_file_ids(scope: FileAccessScope | None) -> frozenset[str]:
    scope_ids = scope.granted_upload_file_ids if scope is not None else frozenset()
    run_grants = _current_file_access_run_grants.get()
    if run_grants is None:
        return scope_ids
    return scope_ids | run_grants.granted_upload_file_ids()


def grant_upload_file_access(upload_file_ids: Iterable[str]) -> None:
    granted_upload_file_ids = frozenset(str(file_id) for file_id in upload_file_ids if file_id)
    if not granted_upload_file_ids:
        return

    run_grants = _current_file_access_run_grants.get()
    if run_grants is not None:
        run_grants.grant_upload_files(granted_upload_file_ids)
        return

    scope = _current_file_access_scope.get()
    if scope is None:
        return

    _current_file_access_scope.set(
        replace(
            scope,
            granted_upload_file_ids=scope.granted_upload_file_ids | granted_upload_file_ids,
        )
    )


def grant_retriever_segment_access(segment_ids: Iterable[str]) -> None:
    granted_segment_ids = frozenset(str(segment_id) for segment_id in segment_ids if segment_id)
    if not granted_segment_ids:
        return

    run_grants = _current_file_access_run_grants.get()
    if run_grants is not None:
        run_grants.grant_retriever_segments(granted_segment_ids)
        return

    scope = _current_file_access_scope.get()
    if scope is None:
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

    run_grants = _current_file_access_run_grants.get()
    if run_grants is not None:
        return run_grants.is_retriever_segment_granted(segment_id)

    return str(segment_id) in scope.granted_retriever_segment_ids


@contextmanager
def bind_file_access_scope(scope: FileAccessScope) -> Generator[None, None, None]:
    token = _current_file_access_scope.set(scope)
    try:
        yield
    finally:
        _current_file_access_scope.reset(token)
