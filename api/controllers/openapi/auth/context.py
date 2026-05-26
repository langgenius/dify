"""Mutable per-request context for the openapi auth pipeline.

Every field starts None / empty and is filled in by a step. The pipeline
is the only thing that should construct or mutate Context — handlers
read populated values via the decorator's kwargs unpacking.

Context is intentionally decoupled from Flask's ``Request``: the pipeline
guard extracts whatever transport-level inputs the steps need (bearer
token, path params) at the boundary and writes them into Context fields,
so steps stay testable without a request object and won't leak coupling
to a specific framework.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from contextvars import Token
from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Literal, Protocol

from werkzeug.exceptions import Unauthorized

from libs.oauth_bearer import AuthContext, Scope, SubjectType

if TYPE_CHECKING:
    from models import App, Tenant


@dataclass
class Context:
    required_scope: Scope
    bearer_token: str | None = None
    path_params: Mapping[str, str] = field(default_factory=dict)
    subject_type: SubjectType | None = None
    subject_email: str | None = None
    subject_issuer: str | None = None
    account_id: uuid.UUID | None = None
    scopes: frozenset[Scope] = field(default_factory=frozenset)
    token_id: uuid.UUID | None = None
    token_hash: str | None = None
    cached_verified_tenants: dict[str, bool] | None = None
    source: str | None = None
    expires_at: datetime | None = None
    app: App | None = None
    tenant: Tenant | None = None
    caller: object | None = None
    caller_kind: Literal["account", "end_user"] | None = None
    auth_ctx_reset_token: Token[AuthContext] | None = None

    @property
    def must_tenant(self) -> Tenant:
        if not self.tenant:
            raise Unauthorized("tenant is not associated")
        return self.tenant

    @property
    def must_subject_type(self) -> SubjectType:
        if not self.subject_type:
            raise Unauthorized("subject_type unset — BearerCheck did not run")
        return self.subject_type


class Step(Protocol):
    """One responsibility. Mutate ctx or raise to short-circuit."""

    def __call__(self, ctx: Context) -> None: ...
