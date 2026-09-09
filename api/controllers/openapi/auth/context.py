"""What the request resolved, and nothing else: no fetching, no checking, no
opinion about the shape of the request. `loaders.py` fills a slot once; the
properties hand handlers the non-optional value, and raise when no requirement
on the route loaded it, so a handler can never fetch its way past a missing
declaration.

A subject resolves its caller through the loaders, so the import of `Subject`
here is type-only: a runtime one would close the cycle
`context` -> `subjects` -> `loaders` -> `context`.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

from models.account import Account, Tenant, TenantAccountRole
from models.model import App, EndUser

if TYPE_CHECKING:
    from controllers.openapi.auth.subjects import Subject

type Caller = Account | EndUser


@dataclass
class Context:
    subject: Subject
    session: Session
    view_args: Mapping[str, str]
    _app: App | None = field(default=None, init=False)
    _workspace: Tenant | None = field(default=None, init=False)
    _workspace_role: TenantAccountRole | None = field(default=None, init=False)
    _caller: Caller | None = field(default=None, init=False)

    @property
    def app(self) -> App:
        return _loaded(self._app, "app")

    @property
    def workspace(self) -> Tenant:
        return _loaded(self._workspace, "workspace")

    @property
    def workspace_role(self) -> TenantAccountRole:
        return _loaded(self._workspace_role, "workspace_role")

    @property
    def caller(self) -> Caller:
        # Spelled out: a generic over `T | None` would widen the union to its base.
        if self._caller is None:
            raise _missing("caller")
        return self._caller

    @property
    def account(self) -> Account:
        return _narrowed(self.caller, Account)

    @property
    def end_user(self) -> EndUser:
        return _narrowed(self.caller, EndUser)


def _loaded[T](value: T | None, name: str) -> T:
    if value is None:
        raise _missing(name)
    return value


def _missing(name: str) -> LookupError:
    return LookupError(f"{name} was not loaded: no requirement on this route asked for it")


def _narrowed[C: Caller](caller: Caller, expected: type[C]) -> C:
    if not isinstance(caller, expected):
        raise LookupError(f"the caller is a {type(caller).__name__}, not the {expected.__name__} this handler reads")
    return caller
