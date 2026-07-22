from __future__ import annotations

from collections.abc import Callable

import pytest
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from models import Account
from models.account import TenantAccountRole
from tests.test_containers_integration_tests.controllers.openapi.conftest import BearerFactory, add_tenant_for_account

pytestmark = pytest.mark.requires_redis


class TestAccountInfo:
    def test_returns_account_and_owner_workspace(
        self,
        container_client: FlaskClient,
        make_transactional_account: Callable[..., Account],
        account_bearer_factory: BearerFactory,
    ) -> None:
        account = make_transactional_account()
        owner_tenant = account.current_tenant
        assert owner_tenant is not None
        headers, _mint = account_bearer_factory(account)

        response = container_client.get("/openapi/v1/account", headers=headers)

        assert response.status_code == 200
        result = response.get_json()
        assert result == {
            "subject_type": "account",
            "subject_email": account.email,
            "subject_issuer": None,
            "account": {"id": account.id, "email": account.email, "name": account.name},
            "workspaces": [
                {
                    "id": owner_tenant.id,
                    "name": owner_tenant.name,
                    "role": TenantAccountRole.OWNER.value,
                }
            ],
            # No membership is flagged current, so the only workspace is the default.
            "default_workspace_id": owner_tenant.id,
        }

    def test_lists_all_joined_workspaces(
        self,
        container_client: FlaskClient,
        container_transaction: Session,
        make_transactional_account: Callable[..., Account],
        account_bearer_factory: BearerFactory,
    ) -> None:
        account = make_transactional_account()
        owner_tenant = account.current_tenant
        assert owner_tenant is not None
        second = add_tenant_for_account(account, session=container_transaction, role="normal", name="Second WS")
        headers, _mint = account_bearer_factory(account)

        response = container_client.get("/openapi/v1/account", headers=headers)

        assert response.status_code == 200
        result = response.get_json()
        workspaces = {workspace["id"]: workspace for workspace in result.pop("workspaces")}
        assert result == {
            "subject_type": "account",
            "subject_email": account.email,
            "subject_issuer": None,
            "account": {"id": account.id, "email": account.email, "name": account.name},
            "default_workspace_id": owner_tenant.id,
        }
        assert workspaces == {
            owner_tenant.id: {
                "id": owner_tenant.id,
                "name": owner_tenant.name,
                "role": TenantAccountRole.OWNER.value,
            },
            second.id: {"id": second.id, "name": "Second WS", "role": TenantAccountRole.NORMAL.value},
        }
