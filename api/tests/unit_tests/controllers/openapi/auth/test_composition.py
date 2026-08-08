import uuid

from controllers.openapi.auth.composition import account_pipeline, auth_router, external_sso_pipeline
from controllers.openapi.auth.data import RBACRequirement, RequestContext
from controllers.openapi.auth.flow import When
from controllers.openapi.auth.pipeline import AuthPipeline, PipelineRoute, PipelineRouter
from controllers.openapi.auth.verify import (
    check_acl,
    check_private_app_permission,
    check_rbac_permission,
    check_workspace_member,
    check_workspace_mismatch,
    check_workspace_role,
)
from core.rbac import RBACPermission, RBACResourceScope
from libs.oauth_bearer import Scope, TokenType
from models.account import TenantAccountRole
from services.enterprise.enterprise_service import WebAppAccessMode


def test_account_pipeline_is_auth_pipeline():
    assert isinstance(account_pipeline, AuthPipeline)


def test_external_sso_pipeline_is_auth_pipeline():
    assert isinstance(external_sso_pipeline, AuthPipeline)


def test_auth_router_is_pipeline_router():
    assert isinstance(auth_router, PipelineRouter)


def test_account_pipeline_prepare_has_six_entries():
    assert len(account_pipeline._prepare) == 6


def test_account_auth_list_has_eight_entries():
    assert len(account_pipeline._auth) == 8


def test_external_sso_pipeline_prepare_has_four_entries():
    assert len(external_sso_pipeline._prepare) == 4


def test_external_sso_auth_list_has_four_entries():
    assert len(external_sso_pipeline._auth) == 4


def test_account_pipeline_has_unconditional_load_account():
    non_when = [s for s in account_pipeline._prepare if not isinstance(s, When)]
    assert len(non_when) == 1


def test_external_sso_pipeline_all_prepare_entries_are_when():
    assert all(isinstance(s, When) for s in external_sso_pipeline._prepare)


def test_account_pipeline_has_one_unconditional_auth_step():
    non_when = [s for s in account_pipeline._auth if not isinstance(s, When)]
    assert len(non_when) == 1


def test_external_sso_pipeline_has_one_unconditional_auth_step():
    non_when = [s for s in external_sso_pipeline._auth if not isinstance(s, When)]
    assert len(non_when) == 1


def test_router_routes_contain_both_token_types():
    assert TokenType.OAUTH_ACCOUNT in auth_router._routes
    assert TokenType.OAUTH_EXTERNAL_SSO in auth_router._routes


def test_external_sso_route_has_ee_required_edition():
    route = auth_router._routes[TokenType.OAUTH_EXTERNAL_SSO]
    assert isinstance(route, PipelineRoute)
    from controllers.openapi.auth.data import Edition

    assert route.required_edition == frozenset({Edition.EE})


def test_account_route_has_no_required_edition():
    route = auth_router._routes[TokenType.OAUTH_ACCOUNT]
    assert isinstance(route, PipelineRoute)
    assert route.required_edition is None


def _selected_auth_steps(*, app_id: bool, workspace_membership: bool, allowed_roles):
    ctx = RequestContext(
        token_type=TokenType.OAUTH_ACCOUNT,
        scope=None,
        path_params={"app_id": str(uuid.uuid4())} if app_id else {},
        workspace_membership=workspace_membership,
        allowed_roles=allowed_roles,
    )
    selected = []
    for step in account_pipeline._auth:
        if isinstance(step, When):
            if step.applies(ctx, None):
                selected.append(step._step)
        else:
            selected.append(step)
    return selected


_ALL_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.NORMAL})


def test_workspace_path_selects_membership_check():
    steps = _selected_auth_steps(app_id=False, workspace_membership=True, allowed_roles=None)
    assert check_workspace_member in steps
    assert check_workspace_role not in steps


def test_app_path_selects_membership_check():
    steps = _selected_auth_steps(app_id=True, workspace_membership=False, allowed_roles=None)
    assert check_workspace_member in steps
    assert check_workspace_role not in steps


def test_roles_set_selects_both_membership_and_role_check():
    steps = _selected_auth_steps(app_id=False, workspace_membership=True, allowed_roles=_ALL_ROLES)
    assert check_workspace_member in steps
    assert check_workspace_role in steps


def test_plain_path_selects_no_membership_or_role_step():
    steps = _selected_auth_steps(app_id=False, workspace_membership=False, allowed_roles=None)
    assert check_workspace_member not in steps
    assert check_workspace_role not in steps


def test_app_path_selects_workspace_mismatch_check():
    steps = _selected_auth_steps(app_id=True, workspace_membership=False, allowed_roles=None)
    assert check_workspace_mismatch in steps


def test_workspace_path_skips_workspace_mismatch_check():
    steps = _selected_auth_steps(app_id=False, workspace_membership=True, allowed_roles=None)
    assert check_workspace_mismatch not in steps


def _selected_webapp_steps(*, scope, app_access_mode):
    """Select auth steps for an EE, webapp-auth-enabled, app-scoped request.

    Patches the config-backed conditions (edition + webapp_auth) so the gating
    reduces to PATH_HAS_APP_ID, LOADED_APP_IS_PRIVATE, and the request scope.
    """
    from unittest.mock import MagicMock, patch

    from controllers.openapi.auth.data import AuthData, Edition

    ctx = RequestContext(
        token_type=TokenType.OAUTH_ACCOUNT,
        scope=scope,
        path_params={"app_id": str(uuid.uuid4())},
    )
    data = AuthData(
        token_type=TokenType.OAUTH_ACCOUNT,
        token_hash="x",
        scopes=frozenset({scope}) if scope is not None else frozenset(),
        app_access_mode=app_access_mode,
    )
    features = MagicMock()
    features.webapp_auth.enabled = True
    selected = []
    with (
        patch("controllers.openapi.auth.conditions.current_edition", return_value=Edition.EE),
        patch("controllers.openapi.auth.conditions.FeatureService.get_system_features", return_value=features),
    ):
        for step in account_pipeline._auth:
            if isinstance(step, When):
                if step.applies(ctx, data):
                    selected.append(step._step)
            else:
                selected.append(step)
    return selected


def test_apps_run_scope_selects_webapp_checks():
    steps = _selected_webapp_steps(scope=Scope.APPS_RUN, app_access_mode=WebAppAccessMode.PRIVATE)
    assert check_acl in steps
    assert check_private_app_permission in steps


def test_management_scope_skips_webapp_checks_on_private_app():
    # Export DSL et al. carry an app_id but use a management scope; the webapp
    # end-user ACL / private-app gate must not block workspace members.
    steps = _selected_webapp_steps(scope=Scope.APPS_READ, app_access_mode=WebAppAccessMode.PRIVATE)
    assert check_acl not in steps
    assert check_private_app_permission not in steps


def _selected_auth_steps_with_rbac(rbac):
    ctx = RequestContext(
        token_type=TokenType.OAUTH_ACCOUNT,
        scope=Scope.APPS_READ,
        path_params={"app_id": str(uuid.uuid4())},
        rbac=rbac,
    )
    selected = []
    for step in account_pipeline._auth:
        if isinstance(step, When):
            if step.applies(ctx, None):
                selected.append(step._step)
        else:
            selected.append(step)
    return selected


def test_account_pipeline_selects_rbac_step_when_required():
    rbac = RBACRequirement(resource_type=RBACResourceScope.APP, scene=RBACPermission.APP_VIEW_LAYOUT)
    assert check_rbac_permission in _selected_auth_steps_with_rbac(rbac)


def test_account_pipeline_skips_rbac_step_without_requirement():
    assert check_rbac_permission not in _selected_auth_steps_with_rbac(None)


def test_external_sso_pipeline_never_enforces_rbac():
    # RBAC is a console (account) concern; external SSO callers are scope-gated.
    rbac_steps = [
        s._step for s in external_sso_pipeline._auth if isinstance(s, When) and s._step is check_rbac_permission
    ]
    assert rbac_steps == []
    assert check_rbac_permission not in external_sso_pipeline._auth
