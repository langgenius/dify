from types import SimpleNamespace
from unittest.mock import patch

import pytest
from werkzeug.exceptions import Forbidden

from controllers.openapi.auth.context import Context
from controllers.openapi.auth.steps import AppAuthzCheck
from controllers.openapi.auth.strategies import AclStrategy, MembershipStrategy
from libs.oauth_bearer import SubjectType


def _ctx(*, subject_type, account_id="acc1"):
    c = Context(required_scope="apps:run")
    c.subject_type = subject_type
    c.subject_email = "alice@example.com"
    c.account_id = account_id
    c.app = SimpleNamespace(id="app1")
    c.tenant = SimpleNamespace(id="t1")
    return c


@patch("controllers.openapi.auth.strategies.EnterpriseService")
def test_acl_strategy_private_calls_inner_api(ent):
    ent.WebAppAuth.get_app_access_mode_by_id.return_value = SimpleNamespace(access_mode="private")
    ent.WebAppAuth.is_user_allowed_to_access_webapp.return_value = True
    assert AclStrategy().authorize(_ctx(subject_type=SubjectType.ACCOUNT)) is True
    ent.WebAppAuth.is_user_allowed_to_access_webapp.assert_called_once_with(
        user_id="acc1",
        app_id="app1",
    )


@pytest.mark.parametrize(
    ("access_mode", "subject_type", "expected"),
    [
        ("public", SubjectType.ACCOUNT, True),
        ("public", SubjectType.EXTERNAL_SSO, True),
        ("sso_verified", SubjectType.ACCOUNT, True),
        ("sso_verified", SubjectType.EXTERNAL_SSO, True),
        ("private_all", SubjectType.ACCOUNT, True),
        ("private_all", SubjectType.EXTERNAL_SSO, False),
        ("private", SubjectType.EXTERNAL_SSO, False),
    ],
)
@patch("controllers.openapi.auth.strategies.EnterpriseService")
def test_acl_strategy_subject_mode_matrix(ent, access_mode, subject_type, expected):
    """Step 1 matrix: subject vs access-mode compatibility. No inner API call expected."""
    ent.WebAppAuth.get_app_access_mode_by_id.return_value = SimpleNamespace(access_mode=access_mode)
    account_id = "acc1" if subject_type == SubjectType.ACCOUNT else None
    assert AclStrategy().authorize(_ctx(subject_type=subject_type, account_id=account_id)) is expected
    ent.WebAppAuth.is_user_allowed_to_access_webapp.assert_not_called()


@patch("controllers.openapi.auth.strategies.TenantService.account_belongs_to_tenant")
@patch("controllers.openapi.auth.strategies.db")
def test_membership_strategy_uses_join_lookup(db_mock, member):
    member.return_value = True
    assert MembershipStrategy().authorize(_ctx(subject_type=SubjectType.ACCOUNT)) is True
    member.assert_called_once_with(db_mock.session, "acc1", "t1")


def test_membership_strategy_rejects_external_sso():
    assert MembershipStrategy().authorize(_ctx(subject_type=SubjectType.EXTERNAL_SSO, account_id=None)) is False


def test_app_authz_check_raises_when_strategy_denies():
    deny = SimpleNamespace(authorize=lambda c: False)
    with pytest.raises(Forbidden) as exc:
        AppAuthzCheck(lambda: deny)(_ctx(subject_type=SubjectType.ACCOUNT))
    assert "subject_no_app_access" in str(exc.value.description)


def test_app_authz_check_passes_when_strategy_allows():
    allow = SimpleNamespace(authorize=lambda c: True)
    AppAuthzCheck(lambda: allow)(_ctx(subject_type=SubjectType.ACCOUNT))
