from __future__ import annotations

from collections.abc import Callable
from inspect import unwrap

from flask import Flask
from sqlalchemy.orm import Session

from controllers.openapi.account import AccountApi
from models import Account
from models.account import TenantAccountRole
from tests.test_containers_integration_tests.controllers.openapi.conftest import add_tenant_for_account, auth_for


class TestAccountInfo:
    def test_returns_account_and_owner_workspace(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        owner_tenant = account.current_tenant
        assert owner_tenant is not None

        api = AccountApi()
        with app.test_request_context("/openapi/v1/account"):
            result = unwrap(api.get)(api, db_session_with_containers, auth_data=auth_for(account))

        assert result.subject_type == "account"
        assert result.subject_email == account.email
        assert result.account is not None
        assert result.account.id == account.id
        assert result.account.email == account.email

        workspaces = {w.id: w for w in result.workspaces}
        assert set(workspaces) == {owner_tenant.id}
        assert workspaces[owner_tenant.id].role == TenantAccountRole.OWNER.value
        # No membership is flagged `current` yet, so the default falls back to
        # the only workspace the account belongs to.
        assert result.default_workspace_id == owner_tenant.id

    def test_lists_all_joined_workspaces(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        owner_tenant = account.current_tenant
        assert owner_tenant is not None
        second = add_tenant_for_account(account, session=db_session_with_containers, role="normal", name="Second WS")

        api = AccountApi()
        with app.test_request_context("/openapi/v1/account"):
            result = unwrap(api.get)(api, db_session_with_containers, auth_data=auth_for(account))

        assert {w.id for w in result.workspaces} == {owner_tenant.id, second.id}
        roles = {w.id: w.role for w in result.workspaces}
        assert roles[owner_tenant.id] == TenantAccountRole.OWNER.value
        assert roles[second.id] == "normal"
