"""The per-request auth store.

Holds what the request resolved; it resolves nothing itself. `loaders.py`
owns the check-then-fetch, and only a requirement calls a loader — so what a
route pays for is the union of what its requirements ask for, once each.

Importing a loader from here would close a cycle
(`context` -> `subjects` -> `loaders` -> `context`), so this module knows the
models it stores and nothing else.

Structurally satisfies `subjects.CallerContext`. Only imports from
`subjects`, never the reverse.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import cast

from sqlalchemy.orm import Session

from controllers.openapi.auth.subjects import Subject
from models.account import Account, Tenant, TenantAccountRole
from models.model import App, EndUser


class _Slot[T]:
    """One datum, either loaded or not. Reading an unloaded slot is a
    programming error — a route whose requirements load nothing a handler
    reads — not an answer any caller should ever see, so it raises
    `LookupError` rather than an HTTP status.
    """

    def __init__(self, name: str) -> None:
        self._name = name
        self._value: T | None = None
        self._loaded = False

    @property
    def loaded(self) -> bool:
        return self._loaded

    def get(self) -> T:
        if not self._loaded:
            raise LookupError(f"{self._name} was never loaded: no requirement on this route loads it")
        return cast(T, self._value)

    def set(self, value: T) -> None:
        self._value = value
        self._loaded = True


class Context:
    def __init__(self, subject: Subject, session: Session, view_args: dict[str, str]) -> None:
        self.subject = subject
        self._session = session
        self._view_args = view_args
        self._app: _Slot[App] = _Slot("app")
        self._workspace: _Slot[Tenant] = _Slot("workspace")
        self._workspace_role: _Slot[TenantAccountRole] = _Slot("workspace_role")
        self._caller: _Slot[Account | EndUser] = _Slot("caller")

    @property
    def session(self) -> Session:
        return self._session

    @property
    def view_args(self) -> Mapping[str, str]:
        return self._view_args

    @property
    def has_app(self) -> bool:
        return "app_id" in self._view_args

    @property
    def app(self) -> App:
        return self._app.get()

    @property
    def app_loaded(self) -> bool:
        return self._app.loaded

    def set_app(self, app: App) -> None:
        self._app.set(app)

    @property
    def workspace(self) -> Tenant:
        return self._workspace.get()

    @property
    def workspace_loaded(self) -> bool:
        return self._workspace.loaded

    def set_workspace(self, workspace: Tenant) -> None:
        self._workspace.set(workspace)

    @property
    def workspace_role(self) -> TenantAccountRole:
        return self._workspace_role.get()

    @property
    def workspace_role_loaded(self) -> bool:
        return self._workspace_role.loaded

    def set_workspace_role(self, role: TenantAccountRole) -> None:
        self._workspace_role.set(role)

    @property
    def caller(self) -> Account | EndUser:
        return self._caller.get()

    @property
    def caller_loaded(self) -> bool:
        return self._caller.loaded

    def set_caller(self, caller: Account | EndUser) -> None:
        self._caller.set(caller)
