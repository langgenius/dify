from __future__ import annotations

from collections.abc import Callable
from unittest.mock import patch
from uuid import uuid4

import pytest
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from models import Account, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole
from tests.test_containers_integration_tests.controllers.openapi.conftest import BearerFactory, add_tenant_for_account
from tests.test_containers_integration_tests.helpers import DatabaseState

pytestmark = pytest.mark.requires_redis


def _workspace_summary(
    tenant_id: str, name: str, role: TenantAccountRole, *, current: bool = False
) -> dict[str, object]:
    return {"id": tenant_id, "name": name, "role": role.value, "status": "normal", "current": current}


class TestWorkspacesList:
    def test_lists_only_members_workspaces_with_role(
        self,
        container_client: FlaskClient,
        make_transactional_account: Callable[..., Account],
        account_bearer_factory: BearerFactory,
    ) -> None:
        account = make_transactional_account()
        owner_tenant = account.current_tenant
        assert owner_tenant is not None
        make_transactional_account()
        headers, _mint = account_bearer_factory(account)

        response = container_client.get("/openapi/v1/workspaces", headers=headers)

        assert response.status_code == 200
        result = response.get_json()
        assert result == {
            "workspaces": [_workspace_summary(owner_tenant.id, owner_tenant.name, TenantAccountRole.OWNER)]
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

        response = container_client.get("/openapi/v1/workspaces", headers=headers)

        assert response.status_code == 200
        result = response.get_json()
        by_id = {workspace["id"]: workspace for workspace in result["workspaces"]}
        assert by_id == {
            owner_tenant.id: _workspace_summary(owner_tenant.id, owner_tenant.name, TenantAccountRole.OWNER),
            second.id: _workspace_summary(second.id, "Second WS", TenantAccountRole.NORMAL),
        }


class TestWorkspaceDetail:
    def test_member_can_read_detail(
        self,
        container_client: FlaskClient,
        make_transactional_account: Callable[..., Account],
        account_bearer_factory: BearerFactory,
    ) -> None:
        account = make_transactional_account()
        tenant = account.current_tenant
        assert tenant is not None
        headers, _mint = account_bearer_factory(account)

        response = container_client.get(f"/openapi/v1/workspaces/{tenant.id}", headers=headers)

        assert response.status_code == 200
        detail = response.get_json()
        assert detail == {
            **_workspace_summary(tenant.id, tenant.name, TenantAccountRole.OWNER),
            "created_at": tenant.created_at.isoformat(),
        }

    def test_non_member_detail_is_404_not_403(
        self,
        container_client: FlaskClient,
        make_transactional_account: Callable[..., Account],
        account_bearer_factory: BearerFactory,
    ) -> None:
        owner = make_transactional_account()
        outsider = make_transactional_account()
        someone_elses_ws = owner.current_tenant
        assert someone_elses_ws is not None
        headers, _mint = account_bearer_factory(outsider)

        response = container_client.get(f"/openapi/v1/workspaces/{someone_elses_ws.id}", headers=headers)

        assert response.status_code == 404
        assert response.get_json()["message"] == "workspace not found"


class TestWorkspaceSwitch:
    def test_switch_sets_current_and_persists(
        self,
        container_client: FlaskClient,
        container_transaction: Session,
        make_transactional_account: Callable[..., Account],
        account_bearer_factory: BearerFactory,
        container_state: DatabaseState,
    ) -> None:
        account = make_transactional_account()
        owner_tenant = account.current_tenant
        assert owner_tenant is not None
        target = add_tenant_for_account(account, session=container_transaction, role="normal", name="Switch Target")
        headers, _mint = account_bearer_factory(account)

        response = container_client.post(f"/openapi/v1/workspaces/{target.id}:switch", headers=headers)

        assert response.status_code == 200
        detail = response.get_json()
        assert detail == {
            **_workspace_summary(target.id, "Switch Target", TenantAccountRole.NORMAL, current=True),
            "created_at": target.created_at.isoformat(),
        }

        listing_response = container_client.get("/openapi/v1/workspaces", headers=headers)
        assert listing_response.status_code == 200
        by_id = {workspace["id"]: workspace for workspace in listing_response.get_json()["workspaces"]}
        assert by_id == {
            owner_tenant.id: _workspace_summary(
                owner_tenant.id,
                owner_tenant.name,
                TenantAccountRole.OWNER,
            ),
            target.id: _workspace_summary(
                target.id,
                "Switch Target",
                TenantAccountRole.NORMAL,
                current=True,
            ),
        }
        target_membership = container_state.one(
            TenantAccountJoin,
            TenantAccountJoin.tenant_id == target.id,
            TenantAccountJoin.account_id == account.id,
        )
        owner_membership = container_state.one(
            TenantAccountJoin,
            TenantAccountJoin.tenant_id == owner_tenant.id,
            TenantAccountJoin.account_id == account.id,
        )
        assert target_membership.current is True
        assert owner_membership.current is False

    def test_switch_to_non_member_workspace_is_404(
        self,
        container_client: FlaskClient,
        make_transactional_account: Callable[..., Account],
        account_bearer_factory: BearerFactory,
    ) -> None:
        account = make_transactional_account()
        outsider_ws = make_transactional_account().current_tenant
        assert outsider_ws is not None
        headers, _mint = account_bearer_factory(account)

        response = container_client.post(f"/openapi/v1/workspaces/{outsider_ws.id}:switch", headers=headers)

        assert response.status_code == 404
        assert response.get_json() is not None


class TestWorkspaceMembers:
    def test_list_update_and_delete_member_persist(
        self,
        container_client: FlaskClient,
        container_transaction: Session,
        make_transactional_account: Callable[..., Account],
        account_bearer_factory: BearerFactory,
        container_state: DatabaseState,
    ) -> None:
        owner = make_transactional_account()
        tenant = owner.current_tenant
        assert tenant is not None
        member = make_transactional_account()
        tenant_id = tenant.id
        owner_id = owner.id
        member_id = member.id
        member_email = member.email
        container_transaction.add(
            TenantAccountJoin(
                tenant_id=tenant_id,
                account_id=member_id,
                role=TenantAccountRole.NORMAL,
                current=False,
            )
        )
        container_transaction.commit()
        headers, _mint = account_bearer_factory(owner)
        members_url = f"/openapi/v1/workspaces/{tenant_id}/members"

        list_response = container_client.get(members_url, headers=headers)
        assert list_response.status_code == 200
        list_payload = list_response.get_json()
        listed = {item["id"]: item for item in list_payload["data"]}
        assert {key: value for key, value in list_payload.items() if key != "data"} == {
            "page": 1,
            "limit": 20,
            "total": 2,
            "has_more": False,
        }
        assert listed == {
            owner_id: {
                "id": owner_id,
                "name": owner.name,
                "email": owner.email,
                "role": TenantAccountRole.OWNER.value,
                "status": AccountStatus.ACTIVE.value,
                "avatar": None,
            },
            member_id: {
                "id": member_id,
                "name": member.name,
                "email": member.email,
                "role": TenantAccountRole.NORMAL.value,
                "status": AccountStatus.ACTIVE.value,
                "avatar": None,
            },
        }

        with patch("services.account_service.send_invite_member_mail_task.delay") as send_mail:
            duplicate_invite_response = container_client.post(
                members_url,
                headers=headers,
                json={"email": member_email, "role": "normal"},
            )
        assert duplicate_invite_response.status_code == 400
        send_mail.assert_not_called()

        update_response = container_client.patch(
            f"{members_url}/{member_id}",
            headers=headers,
            json={"role": "admin"},
        )
        assert update_response.status_code == 200
        membership = container_state.one(
            TenantAccountJoin,
            TenantAccountJoin.tenant_id == tenant_id,
            TenantAccountJoin.account_id == member_id,
        )
        assert membership.role == TenantAccountRole.ADMIN

        same_role_response = container_client.patch(
            f"{members_url}/{member_id}",
            headers=headers,
            json={"role": "admin"},
        )
        assert same_role_response.status_code == 400

        self_remove_response = container_client.delete(f"{members_url}/{owner_id}", headers=headers)
        assert self_remove_response.status_code == 400

        delete_response = container_client.delete(f"{members_url}/{member_id}", headers=headers)
        assert delete_response.status_code == 200
        assert (
            container_state.count(
                TenantAccountJoin,
                TenantAccountJoin.tenant_id == tenant_id,
                TenantAccountJoin.account_id == member_id,
            )
            == 0
        )

    def test_invite_member_persists_pending_account(
        self,
        container_client: FlaskClient,
        container_transaction: Session,
        make_transactional_account: Callable[..., Account],
        account_bearer_factory: BearerFactory,
        container_state: DatabaseState,
    ) -> None:
        owner = make_transactional_account()
        tenant = owner.current_tenant
        assert tenant is not None
        tenant_id = tenant.id
        invitee_email = f"openapi-invite-{uuid4()}@example.com"
        headers, _mint = account_bearer_factory(owner)

        with patch("services.account_service.send_invite_member_mail_task.delay") as send_mail:
            response = container_client.post(
                f"/openapi/v1/workspaces/{tenant_id}/members",
                headers=headers,
                json={"email": invitee_email, "role": "normal"},
            )

        assert response.status_code == 201
        payload = response.get_json()
        assert payload["email"] == invitee_email
        invitee = container_state.one(Account, Account.email == invitee_email)
        assert invitee.status == AccountStatus.PENDING
        membership = container_state.one(
            TenantAccountJoin,
            TenantAccountJoin.tenant_id == tenant_id,
            TenantAccountJoin.account_id == invitee.id,
        )
        assert membership.role == TenantAccountRole.NORMAL
        send_mail.assert_called_once()
