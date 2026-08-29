"""Holds what the request resolved; it resolves nothing itself — `loaders.py`
owns the check-then-fetch.

A subject resolves its caller through the loaders, so the import of `Subject`
here is type-only: a runtime one would close the cycle
`context` -> `subjects` -> `loaders` -> `context`.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

from models.account import Account, Tenant, TenantAccountRole
from models.model import App, EndUser

if TYPE_CHECKING:
    from controllers.openapi.auth.subjects import Subject

type Caller = Account | EndUser


def _missing(name: str) -> LookupError:
    return LookupError(f"{name} was never loaded: no requirement on this route loads it")


class Context:
    def __init__(self, subject: Subject, session: Session, view_args: dict[str, str]) -> None:
        self.subject = subject
        self._session = session
        self._view_args = view_args
        self._app: App | None = None
        self._workspace: Tenant | None = None
        self._workspace_role: TenantAccountRole | None = None
        self._caller: Caller | None = None

    @property
    def session(self) -> Session:
        return self._session

    @property
    def view_args(self) -> Mapping[str, str]:
        return self._view_args

    @property
    def app(self) -> App:
        if self._app is None:
            raise _missing("app")
        return self._app

    @property
    def app_loaded(self) -> bool:
        return self._app is not None

    def set_app(self, app: App) -> None:
        self._app = app

    @property
    def workspace(self) -> Tenant:
        if self._workspace is None:
            raise _missing("workspace")
        return self._workspace

    @property
    def workspace_loaded(self) -> bool:
        return self._workspace is not None

    def set_workspace(self, workspace: Tenant) -> None:
        self._workspace = workspace

    @property
    def workspace_role(self) -> TenantAccountRole:
        if self._workspace_role is None:
            raise _missing("workspace_role")
        return self._workspace_role

    @property
    def workspace_role_loaded(self) -> bool:
        return self._workspace_role is not None

    def set_workspace_role(self, role: TenantAccountRole) -> None:
        self._workspace_role = role

    @property
    def caller(self) -> Caller:
        if self._caller is None:
            raise _missing("caller")
        return self._caller

    @property
    def caller_loaded(self) -> bool:
        return self._caller is not None

    def set_caller(self, caller: Caller) -> None:
        self._caller = caller
