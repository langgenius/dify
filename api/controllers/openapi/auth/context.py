"""What the request resolved, and nothing else: no fetching, no checking, no
opinion about the shape of the request. `loaders.py` fills a field once and
hands back the non-optional value; only it and the requirements ask whether a
field is still unset.

A subject resolves its caller through the loaders, so the import of `Subject`
here is type-only: a runtime one would close the cycle
`context` -> `subjects` -> `loaders` -> `context`.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
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
    app: App | None = None
    workspace: Tenant | None = None
    workspace_role: TenantAccountRole | None = None
    caller: Caller | None = None
