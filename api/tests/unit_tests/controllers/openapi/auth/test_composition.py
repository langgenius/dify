from unittest.mock import patch

from controllers.openapi.auth.composition import OAUTH_BEARER_PIPELINE, _resolve_app_authz_strategy
from controllers.openapi.auth.pipeline import Pipeline
from controllers.openapi.auth.steps import (
    AppAuthzCheck,
    AppResolver,
    BearerCheck,
    CallerMount,
    ScopeCheck,
    SurfaceCheck,
    WorkspaceMembershipCheck,
)
from controllers.openapi.auth.strategies import (
    AccountMounter,
    AclStrategy,
    EndUserMounter,
    MembershipStrategy,
)
from libs.oauth_bearer import SubjectType


def test_pipeline_is_composed():
    assert isinstance(OAUTH_BEARER_PIPELINE, Pipeline)


def test_pipeline_step_order():
    """BearerCheck → SurfaceCheck → ScopeCheck → AppResolver →
    WorkspaceMembershipCheck → AppAuthzCheck → CallerMount.
    SurfaceCheck enforces the dfoa_/dfoe_ surface split + emits
    `openapi.wrong_surface_denied`. Rate-limit is enforced inside
    `BearerAuthenticator.authenticate`, not as a separate pipeline step."""
    steps = OAUTH_BEARER_PIPELINE._steps
    assert isinstance(steps[0], BearerCheck)
    assert isinstance(steps[1], SurfaceCheck)
    assert isinstance(steps[2], ScopeCheck)
    assert isinstance(steps[3], AppResolver)
    assert isinstance(steps[4], WorkspaceMembershipCheck)
    assert isinstance(steps[5], AppAuthzCheck)
    assert isinstance(steps[6], CallerMount)


def test_pipeline_surface_check_accepts_account_only():
    """Current pipeline serves /apps/<id>/run — account surface only."""
    surface = OAUTH_BEARER_PIPELINE._steps[1]
    assert isinstance(surface, SurfaceCheck)
    assert surface._accepted == frozenset({SubjectType.ACCOUNT})


def test_caller_mount_has_both_mounters():
    cm = OAUTH_BEARER_PIPELINE._steps[6]
    kinds = {type(m) for m in cm._mounters}
    assert AccountMounter in kinds
    assert EndUserMounter in kinds


@patch("controllers.openapi.auth.composition.FeatureService")
def test_strategy_resolver_picks_acl_when_enabled(fs):
    fs.get_system_features.return_value.webapp_auth.enabled = True
    assert isinstance(_resolve_app_authz_strategy(), AclStrategy)


@patch("controllers.openapi.auth.composition.FeatureService")
def test_strategy_resolver_picks_membership_when_disabled(fs):
    fs.get_system_features.return_value.webapp_auth.enabled = False
    assert isinstance(_resolve_app_authz_strategy(), MembershipStrategy)
