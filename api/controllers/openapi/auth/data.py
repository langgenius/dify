from __future__ import annotations

import uuid
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from werkzeug.exceptions import InternalServerError

from configs import dify_config
from libs.oauth_bearer import Scope, TokenType
from models.account import Account, Tenant, TenantAccountRole
from models.model import App, EndUser
from services.enterprise.enterprise_service import WebAppAccessMode


class Edition(StrEnum):
    CE = "ce"
    EE = "ee"
    SAAS = "saas"


def current_edition() -> Edition:
    if dify_config.EDITION == "CLOUD":
        return Edition.SAAS
    if dify_config.ENTERPRISE_ENABLED:
        return Edition.EE
    return Edition.CE


class ExternalIdentity(BaseModel):
    model_config = ConfigDict(frozen=True)

    email: str
    issuer: str | None = None


class RequestContext(BaseModel):
    model_config = ConfigDict(frozen=True)

    token_type: TokenType
    scope: Scope | None = None
    path_params: dict[str, str]
    workspace_membership: bool = False
    allowed_roles: frozenset[TenantAccountRole] | None = None


class AuthData(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    required_scope: Scope | None = None
    token_type: TokenType
    account_id: uuid.UUID | None = None
    token_hash: str
    token_id: uuid.UUID | None = None
    scopes: frozenset[Scope]
    tenants: dict[str, bool] = Field(default_factory=dict)
    external_identity: ExternalIdentity | None = None
    path_params: dict[str, str] = Field(default_factory=dict)

    allowed_roles: frozenset[TenantAccountRole] | None = None

    app: App | None = None
    tenant: Tenant | None = None
    app_access_mode: WebAppAccessMode | None = None

    tenant_role: TenantAccountRole | None = None

    caller: Account | EndUser | None = None
    caller_kind: Literal["account", "end_user"] | None = None

    def require_app_context(self) -> tuple[App, Account | EndUser, Literal["account", "end_user"]]:
        if self.app is None or self.caller is None or self.caller_kind is None:
            raise InternalServerError("pipeline_invariant_violated: app context missing")
        return self.app, self.caller, self.caller_kind
