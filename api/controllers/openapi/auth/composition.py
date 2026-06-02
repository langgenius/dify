from __future__ import annotations

from controllers.openapi.auth.conditions import (
    EDITION_EE,
    HAS_ALLOWED_ROLES,
    LOADED_APP_IS_PRIVATE,
    PATH_HAS_APP_ID,
    WEBAPP_AUTH_ENABLED,
    WORKSPACE_MEMBERSHIP_REQUIRED,
    WORKSPACE_SCOPED,
)
from controllers.openapi.auth.data import Edition
from controllers.openapi.auth.flow import When
from controllers.openapi.auth.pipeline import AuthPipeline, PipelineRoute, PipelineRouter
from controllers.openapi.auth.prepare import (
    load_account,
    load_app,
    load_app_access_mode,
    load_tenant,
    load_tenant_from_request,
    load_workspace_role,
    resolve_external_user,
)
from controllers.openapi.auth.verify import (
    check_acl,
    check_app_api_enabled,
    check_private_app_permission,
    check_scope,
    check_workspace_member,
    check_workspace_mismatch,
    check_workspace_role,
)
from libs.oauth_bearer import TokenType

account_pipeline = AuthPipeline(
    prepare=[
        When(PATH_HAS_APP_ID, then=load_app),
        When(PATH_HAS_APP_ID, then=load_tenant),
        When(WORKSPACE_MEMBERSHIP_REQUIRED, then=load_tenant_from_request),
        load_account,
        When(WORKSPACE_SCOPED, then=load_workspace_role),
        When(PATH_HAS_APP_ID & EDITION_EE, then=load_app_access_mode),
    ],
    auth=[
        When(PATH_HAS_APP_ID, then=check_app_api_enabled),
        check_scope,
        When(WORKSPACE_SCOPED, then=check_workspace_member),
        When(PATH_HAS_APP_ID, then=check_workspace_mismatch),
        When(HAS_ALLOWED_ROLES, then=check_workspace_role),
        When(PATH_HAS_APP_ID & EDITION_EE & WEBAPP_AUTH_ENABLED, then=check_acl),
        When(EDITION_EE & LOADED_APP_IS_PRIVATE, then=check_private_app_permission),
    ],
)

external_sso_pipeline = AuthPipeline(
    prepare=[
        When(PATH_HAS_APP_ID, then=load_app),
        When(PATH_HAS_APP_ID, then=load_tenant),
        When(PATH_HAS_APP_ID, then=resolve_external_user),
        When(PATH_HAS_APP_ID, then=load_app_access_mode),
    ],
    auth=[
        When(PATH_HAS_APP_ID, then=check_app_api_enabled),
        check_scope,
        When(PATH_HAS_APP_ID & WEBAPP_AUTH_ENABLED, then=check_acl),
        When(LOADED_APP_IS_PRIVATE, then=check_private_app_permission),
    ],
)

auth_router = PipelineRouter(
    {
        TokenType.OAUTH_ACCOUNT: PipelineRoute(account_pipeline),
        TokenType.OAUTH_EXTERNAL_SSO: PipelineRoute(external_sso_pipeline, required_edition=frozenset({Edition.EE})),
    }
)
