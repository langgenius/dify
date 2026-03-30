from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom

_current_file_access_scope: ContextVar[FileAccessScope | None] = ContextVar(
    "current_file_access_scope",
    default=None,
)


@dataclass(frozen=True, slots=True)
class FileAccessScope:
    """Request-scoped ownership context used by workflow-layer file lookups."""

    tenant_id: str
    user_id: str
    user_from: UserFrom
    invoke_from: InvokeFrom

    @property
    def requires_user_ownership(self) -> bool:
        return self.user_from == UserFrom.END_USER


def get_current_file_access_scope() -> FileAccessScope | None:
    return _current_file_access_scope.get()


@contextmanager
def bind_file_access_scope(scope: FileAccessScope) -> Iterator[None]:
    token = _current_file_access_scope.set(scope)
    try:
        yield
    finally:
        _current_file_access_scope.reset(token)
