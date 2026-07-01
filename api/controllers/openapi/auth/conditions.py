from __future__ import annotations

from collections.abc import Callable

from controllers.openapi.auth.data import AuthData, Edition, RequestContext, current_edition
from libs.oauth_bearer import Scope, TokenType
from services.enterprise.enterprise_service import WebAppAccessMode
from services.feature_service import FeatureService

CondFn = Callable[[RequestContext, AuthData | None], bool]


class Cond:
    def __init__(self, fn: CondFn) -> None:
        self._fn = fn

    def __call__(self, ctx: RequestContext, data: AuthData | None = None) -> bool:
        return self._fn(ctx, data)

    def __and__(self, other: Cond) -> Cond:
        return Cond(lambda ctx, data: self(ctx, data) and other(ctx, data))

    def __or__(self, other: Cond) -> Cond:
        return Cond(lambda ctx, data: self(ctx, data) or other(ctx, data))

    def __invert__(self) -> Cond:
        return Cond(lambda ctx, data: not self(ctx, data))


def request_cond(fn: Callable[[RequestContext], bool]) -> Cond:
    return Cond(lambda ctx, _: fn(ctx))


def data_cond(fn: Callable[[AuthData], bool]) -> Cond:
    return Cond(lambda _, data: data is not None and fn(data))


def config_cond(fn: Callable[[], bool]) -> Cond:
    return Cond(lambda _, __: fn())


TOKEN_IS_OAUTH_ACCOUNT = request_cond(lambda ctx: ctx.token_type == TokenType.OAUTH_ACCOUNT)
TOKEN_IS_OAUTH_EXTERNAL_SSO = request_cond(lambda ctx: ctx.token_type == TokenType.OAUTH_EXTERNAL_SSO)

PATH_HAS_APP_ID = request_cond(lambda ctx: "app_id" in ctx.path_params)

EDITION_CE = config_cond(lambda: current_edition() == Edition.CE)
EDITION_EE = config_cond(lambda: current_edition() == Edition.EE)
EDITION_SAAS = config_cond(lambda: current_edition() == Edition.SAAS)

WEBAPP_AUTH_ENABLED = config_cond(lambda: FeatureService.get_system_features().webapp_auth.enabled)

WEBAPP_RUN_SCOPED = request_cond(lambda ctx: ctx.scope == Scope.APPS_RUN)

WORKSPACE_MEMBERSHIP_REQUIRED = request_cond(lambda ctx: ctx.workspace_membership)
HAS_ALLOWED_ROLES = request_cond(lambda ctx: ctx.allowed_roles is not None)
HAS_RBAC = request_cond(lambda ctx: ctx.rbac is not None)

# Caller must belong to the resolved tenant: either an app-scoped path (tenant
# from the app) or an explicit workspace-membership path (tenant from request).
WORKSPACE_SCOPED = PATH_HAS_APP_ID | WORKSPACE_MEMBERSHIP_REQUIRED

LOADED_APP_IS_PRIVATE = data_cond(lambda data: data.app_access_mode == WebAppAccessMode.PRIVATE)
