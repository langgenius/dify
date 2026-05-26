from types import SimpleNamespace
from unittest.mock import patch

import pytest
from werkzeug.exceptions import Unauthorized

from controllers.openapi.auth.context import Context
from controllers.openapi.auth.steps import CallerMount
from controllers.openapi.auth.strategies import AccountMounter, EndUserMounter
from core.app.entities.app_invoke_entities import InvokeFrom
from libs.oauth_bearer import SubjectType


def _ctx(*, subject_type, account_id=None, subject_email=None):
    c = Context(required_scope="apps:run")
    c.subject_type = subject_type
    c.account_id = account_id
    c.subject_email = subject_email
    c.app = SimpleNamespace(id="app1")
    c.tenant = SimpleNamespace(id="t1")
    return c


@patch("controllers.openapi.auth.strategies._login_as")
@patch("controllers.openapi.auth.strategies.db")
def test_account_mounter(db, login):
    account = SimpleNamespace()
    db.session.get.return_value = account
    ctx = _ctx(subject_type=SubjectType.ACCOUNT, account_id="acc1")
    AccountMounter().mount(ctx)
    assert ctx.caller is account
    assert ctx.caller.current_tenant is ctx.tenant
    assert ctx.caller_kind == "account"
    login.assert_called_once_with(account)


@patch("controllers.openapi.auth.strategies._login_as")
@patch("controllers.openapi.auth.strategies.EndUserService")
def test_end_user_mounter(svc, login):
    eu = SimpleNamespace()
    svc.get_or_create_end_user_by_type.return_value = eu
    ctx = _ctx(subject_type=SubjectType.EXTERNAL_SSO, subject_email="a@x.com")
    EndUserMounter().mount(ctx)
    svc.get_or_create_end_user_by_type.assert_called_once_with(
        InvokeFrom.OPENAPI,
        tenant_id="t1",
        app_id="app1",
        user_id="a@x.com",
    )
    assert ctx.caller is eu
    assert ctx.caller_kind == "end_user"


def test_caller_mount_dispatches_by_subject_type():
    seen = {}

    class Fake:
        def __init__(self, st, tag):
            self._st, self._tag = st, tag

        def applies_to(self, st):
            return st == self._st

        def mount(self, ctx):
            seen["who"] = self._tag

    cm = CallerMount(
        Fake(SubjectType.ACCOUNT, "acct"),
        Fake(SubjectType.EXTERNAL_SSO, "sso"),
    )
    cm(_ctx(subject_type=SubjectType.EXTERNAL_SSO))
    assert seen == {"who": "sso"}


def test_caller_mount_raises_when_none_applies():
    with pytest.raises(Unauthorized):
        CallerMount()(_ctx(subject_type=SubjectType.ACCOUNT))
