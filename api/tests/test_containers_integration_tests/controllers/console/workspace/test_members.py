from __future__ import annotations

from unittest.mock import patch
from uuid import uuid4

import pytest
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from controllers.console.workspace import members as members_module
from libs.datetime_utils import naive_utc_now
from models.account import (
    Account,
    AccountStatus,
    Tenant,
    TenantAccountJoin,
    TenantAccountRole,
    TenantStatus,
)
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    ensure_dify_setup,
)
from tests.test_containers_integration_tests.helpers import DatabaseState


class WorkspaceMembersIntegrationFactory:
    @staticmethod
    def create_tenant(container_transaction: Session) -> Tenant:
        tenant = Tenant(name=f"Tenant {uuid4()}", plan="basic", status=TenantStatus.NORMAL)
        container_transaction.add(tenant)
        container_transaction.commit()
        return tenant

    @staticmethod
    def create_account(
        container_transaction: Session,
        *,
        email_prefix: str,
        tenant: Tenant | None = None,
        role: TenantAccountRole = TenantAccountRole.NORMAL,
        current: bool = False,
    ) -> Account:
        account = Account(
            name=f"Account {uuid4()}",
            email=f"{email_prefix}-{uuid4()}@example.com",
            password="hashed-password",
            password_salt="salt",
            interface_language="en-US",
            timezone="UTC",
            status=AccountStatus.ACTIVE,
            initialized_at=naive_utc_now(),
        )
        container_transaction.add(account)
        container_transaction.commit()

        if tenant is not None:
            container_transaction.add(
                TenantAccountJoin(
                    tenant_id=tenant.id,
                    account_id=account.id,
                    role=role,
                    current=current,
                )
            )
            container_transaction.commit()
            account.current_tenant = tenant
        ensure_dify_setup(container_transaction)
        return account

    @staticmethod
    def create_owner_workspace(container_transaction: Session) -> tuple[Tenant, Account]:
        tenant = WorkspaceMembersIntegrationFactory.create_tenant(container_transaction)
        owner = WorkspaceMembersIntegrationFactory.create_account(
            container_transaction,
            email_prefix="owner",
            tenant=tenant,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        return tenant, owner

    @staticmethod
    def create_owner_transfer_token(account: Account) -> str:
        _, token = members_module.AccountService.generate_owner_transfer_token(
            account.email,
            account=account,
            code="123456",
            additional_data={},
        )
        return token


def _headers(client: FlaskClient, account: Account) -> dict[str, str]:
    return authenticate_console_client(client, account)


def _assert_account_contract(
    payload: dict[str, object],
    account: Account,
    role: TenantAccountRole,
    *,
    roles: list[dict[str, str]],
) -> None:
    assert payload == {
        "id": account.id,
        "name": account.name,
        "email": account.email,
        "avatar": None,
        "avatar_url": None,
        "last_login_at": None,
        "last_active_at": int(account.last_active_at.timestamp()),
        "created_at": int(account.created_at.timestamp()),
        "role": role.value,
        "roles": roles,
        "status": AccountStatus.ACTIVE.value,
    }


class TestMemberCancelInviteApiWithContainers:
    def test_cancel_success(
        self,
        container_client: FlaskClient,
        container_transaction: Session,
        container_state: DatabaseState,
    ) -> None:
        factory = WorkspaceMembersIntegrationFactory
        tenant, current_user = factory.create_owner_workspace(container_transaction)
        member = factory.create_account(
            container_transaction,
            email_prefix="member",
            tenant=tenant,
            role=TenantAccountRole.NORMAL,
        )
        tenant_id = tenant.id
        member_id = member.id
        current_user_id = current_user.id
        headers = _headers(container_client, current_user)

        response = container_client.delete(
            f"/console/api/workspaces/current/members/{member_id}",
            headers=headers,
        )

        assert response.status_code == 200
        assert response.get_json()["result"] == "success"
        assert (
            container_state.count(
                TenantAccountJoin,
                TenantAccountJoin.tenant_id == tenant_id,
                TenantAccountJoin.account_id == member_id,
            )
            == 0
        )

        self_remove_response = container_client.delete(
            f"/console/api/workspaces/current/members/{current_user_id}",
            headers=headers,
        )
        assert self_remove_response.status_code == 400
        assert self_remove_response.get_json()["code"] == "cannot-operate-self"
        assert (
            container_state.count(
                TenantAccountJoin,
                TenantAccountJoin.tenant_id == tenant_id,
                TenantAccountJoin.account_id == current_user_id,
            )
            == 1
        )

    def test_cancel_not_found(self, container_client: FlaskClient, container_transaction: Session) -> None:
        _tenant, current_user = WorkspaceMembersIntegrationFactory.create_owner_workspace(container_transaction)

        response = container_client.delete(
            f"/console/api/workspaces/current/members/{uuid4()}",
            headers=_headers(container_client, current_user),
        )

        assert response.status_code == 404

    def test_cancel_enforces_operator_role_and_workspace_membership(
        self,
        container_client: FlaskClient,
        container_transaction: Session,
    ) -> None:
        factory = WorkspaceMembersIntegrationFactory
        tenant, owner = factory.create_owner_workspace(container_transaction)
        operator = factory.create_account(
            container_transaction,
            email_prefix="operator",
            tenant=tenant,
            role=TenantAccountRole.ADMIN,
            current=True,
        )
        foreign_member = factory.create_account(container_transaction, email_prefix="foreign-member")
        headers = _headers(container_client, operator)

        denied_response = container_client.delete(
            f"/console/api/workspaces/current/members/{owner.id}",
            headers=headers,
        )
        foreign_response = container_client.delete(
            f"/console/api/workspaces/current/members/{foreign_member.id}",
            headers=headers,
        )

        assert denied_response.status_code == 403
        assert denied_response.get_json()["code"] == "forbidden"
        assert foreign_response.status_code == 404
        assert foreign_response.get_json()["code"] == "member-not-found"


class TestMemberUpdateRoleApiWithContainers:
    def test_update_success(
        self,
        container_client: FlaskClient,
        container_transaction: Session,
        container_state: DatabaseState,
    ) -> None:
        factory = WorkspaceMembersIntegrationFactory
        tenant, current_user = factory.create_owner_workspace(container_transaction)
        member = factory.create_account(
            container_transaction,
            email_prefix="member",
            tenant=tenant,
            role=TenantAccountRole.EDITOR,
        )
        tenant_id = tenant.id
        member_id = member.id
        headers = _headers(container_client, current_user)

        response = container_client.put(
            f"/console/api/workspaces/current/members/{member_id}/update-role",
            headers=headers,
            json={"role": "normal"},
        )

        assert response.status_code == 200
        assert response.get_json()["result"] == "success"
        membership = container_state.one(
            TenantAccountJoin,
            TenantAccountJoin.tenant_id == tenant_id,
            TenantAccountJoin.account_id == member_id,
        )
        assert membership.role == TenantAccountRole.NORMAL

        same_role_response = container_client.put(
            f"/console/api/workspaces/current/members/{member_id}/update-role",
            headers=headers,
            json={"role": "normal"},
        )
        assert same_role_response.status_code == 400
        assert same_role_response.get_json()["code"] == "role-already-assigned"

    def test_update_member_not_found(self, container_client: FlaskClient, container_transaction: Session) -> None:
        _tenant, current_user = WorkspaceMembersIntegrationFactory.create_owner_workspace(container_transaction)

        response = container_client.put(
            f"/console/api/workspaces/current/members/{uuid4()}/update-role",
            headers=_headers(container_client, current_user),
            json={"role": "normal"},
        )

        assert response.status_code == 404


class TestMemberReadAndInviteApisWithContainers:
    def test_list_members_returns_persisted_memberships(
        self, container_client: FlaskClient, container_transaction: Session
    ) -> None:
        factory = WorkspaceMembersIntegrationFactory
        tenant, current_user = factory.create_owner_workspace(container_transaction)
        member = factory.create_account(
            container_transaction,
            email_prefix="listed-member",
            tenant=tenant,
            role=TenantAccountRole.EDITOR,
        )
        current_user_id = current_user.id
        member_id = member.id

        response = container_client.get(
            "/console/api/workspaces/current/members",
            headers=_headers(container_client, current_user),
        )

        assert response.status_code == 200
        accounts = {item["id"]: item for item in response.get_json()["accounts"]}
        assert set(accounts) == {current_user_id, member_id}
        _assert_account_contract(
            accounts[current_user_id],
            current_user,
            TenantAccountRole.OWNER,
            roles=[{"id": "owner", "name": "owner"}],
        )
        _assert_account_contract(
            accounts[member_id],
            member,
            TenantAccountRole.EDITOR,
            roles=[{"id": "editor", "name": "editor"}],
        )

    def test_list_dataset_operators_returns_only_operator_members(
        self, container_client: FlaskClient, container_transaction: Session
    ) -> None:
        factory = WorkspaceMembersIntegrationFactory
        tenant, current_user = factory.create_owner_workspace(container_transaction)
        operator = factory.create_account(
            container_transaction,
            email_prefix="operator",
            tenant=tenant,
            role=TenantAccountRole.DATASET_OPERATOR,
        )
        operator_id = operator.id
        factory.create_account(
            container_transaction,
            email_prefix="ordinary",
            tenant=tenant,
            role=TenantAccountRole.NORMAL,
        )

        response = container_client.get(
            "/console/api/workspaces/current/dataset-operators",
            headers=_headers(container_client, current_user),
        )

        assert response.status_code == 200
        accounts = response.get_json()["accounts"]
        assert len(accounts) == 1
        _assert_account_contract(accounts[0], operator, TenantAccountRole.DATASET_OPERATOR, roles=[])

    @pytest.mark.requires_redis
    def test_invite_member_persists_pending_account_and_membership(
        self,
        container_client: FlaskClient,
        container_transaction: Session,
        container_state: DatabaseState,
    ) -> None:
        factory = WorkspaceMembersIntegrationFactory
        tenant, current_user = factory.create_owner_workspace(container_transaction)
        invitee_email = f"invitee-{uuid4()}@example.com"
        tenant_id = tenant.id
        headers = _headers(container_client, current_user)

        with patch("services.account_service.send_invite_member_mail_task.delay") as send_mail:
            response = container_client.post(
                "/console/api/workspaces/current/members/invite-email",
                headers=headers,
                json={"emails": [invitee_email], "role": "normal", "language": "en-US"},
            )

        assert response.status_code == 201
        result = response.get_json()["invitation_results"][0]
        assert result["status"] == "success"
        invitee = container_state.one(Account, Account.email == invitee_email)
        assert invitee.status == AccountStatus.PENDING
        invitee_id = invitee.id
        membership = container_state.one(
            TenantAccountJoin,
            TenantAccountJoin.tenant_id == tenant_id,
            TenantAccountJoin.account_id == invitee_id,
        )
        assert membership.role == TenantAccountRole.NORMAL
        send_mail.assert_called_once()

        cancel_response = container_client.delete(
            f"/console/api/workspaces/current/members/{invitee_id}",
            headers=headers,
        )
        assert cancel_response.status_code == 200
        assert container_state.count(Account, Account.id == invitee_id) == 0
        assert (
            container_state.count(
                TenantAccountJoin,
                TenantAccountJoin.tenant_id == tenant_id,
                TenantAccountJoin.account_id == invitee_id,
            )
            == 0
        )


class TestOwnerTransferSupportApisWithContainers:
    def test_send_owner_transfer_email_returns_service_token(
        self, container_client: FlaskClient, container_transaction: Session
    ) -> None:
        _tenant, current_user = WorkspaceMembersIntegrationFactory.create_owner_workspace(container_transaction)

        with (
            patch.object(members_module.AccountService, "is_email_send_ip_limit", return_value=False),
            patch.object(members_module.AccountService, "send_owner_transfer_email", return_value="transfer-token"),
        ):
            response = container_client.post(
                "/console/api/workspaces/current/members/send-owner-transfer-confirm-email",
                headers=_headers(container_client, current_user),
                json={"language": "en-US"},
            )

        assert response.status_code == 200
        assert response.get_json() == {"result": "success", "data": "transfer-token"}

    @pytest.mark.requires_redis
    def test_owner_transfer_check_rotates_redis_token(
        self, container_client: FlaskClient, container_transaction: Session
    ) -> None:
        _tenant, current_user = WorkspaceMembersIntegrationFactory.create_owner_workspace(container_transaction)
        token = WorkspaceMembersIntegrationFactory.create_owner_transfer_token(current_user)
        current_user_email = current_user.email
        headers = _headers(container_client, current_user)

        wrong_code_response = container_client.post(
            "/console/api/workspaces/current/members/owner-transfer-check",
            headers=headers,
            json={"token": token, "code": "654321"},
        )
        assert wrong_code_response.status_code == 400
        transfer_data = members_module.AccountService.get_owner_transfer_data(token)
        assert transfer_data is not None
        assert transfer_data["code"] == "123456"

        response = container_client.post(
            "/console/api/workspaces/current/members/owner-transfer-check",
            headers=headers,
            json={"token": token, "code": "123456"},
        )

        assert response.status_code == 200
        payload = response.get_json()
        assert payload["is_valid"] is True
        assert payload["email"] == current_user_email
        assert members_module.AccountService.get_owner_transfer_data(token) is None
        rotated_transfer_data = members_module.AccountService.get_owner_transfer_data(payload["token"])
        assert rotated_transfer_data is not None
        assert rotated_transfer_data["code"] == "123456"


@pytest.mark.requires_redis
class TestOwnerTransferApiWithContainers:
    def test_member_not_in_tenant(self, container_client: FlaskClient, container_transaction: Session) -> None:
        factory = WorkspaceMembersIntegrationFactory
        _tenant, current_user = factory.create_owner_workspace(container_transaction)
        member = factory.create_account(container_transaction, email_prefix="member")
        token = factory.create_owner_transfer_token(current_user)

        response = container_client.post(
            f"/console/api/workspaces/current/members/{member.id}/owner-transfer",
            headers=_headers(container_client, current_user),
            json={"token": token},
        )

        assert response.status_code == 400
        assert response.get_json()["code"] == "member_not_in_tenant"

    def test_member_not_found(self, container_client: FlaskClient, container_transaction: Session) -> None:
        factory = WorkspaceMembersIntegrationFactory
        _tenant, current_user = factory.create_owner_workspace(container_transaction)
        token = factory.create_owner_transfer_token(current_user)

        response = container_client.post(
            f"/console/api/workspaces/current/members/{uuid4()}/owner-transfer",
            headers=_headers(container_client, current_user),
            json={"token": token},
        )

        assert response.status_code == 404

    def test_transfer_success(
        self,
        container_client: FlaskClient,
        container_transaction: Session,
        container_state: DatabaseState,
    ) -> None:
        factory = WorkspaceMembersIntegrationFactory
        tenant, current_user = factory.create_owner_workspace(container_transaction)
        member = factory.create_account(
            container_transaction,
            email_prefix="member",
            tenant=tenant,
            role=TenantAccountRole.NORMAL,
        )
        tenant_id = tenant.id
        current_user_id = current_user.id
        member_id = member.id
        token = factory.create_owner_transfer_token(current_user)

        with (
            patch.object(members_module.AccountService, "send_new_owner_transfer_notify_email") as new_owner_email,
            patch.object(members_module.AccountService, "send_old_owner_transfer_notify_email") as old_owner_email,
        ):
            response = container_client.post(
                f"/console/api/workspaces/current/members/{member.id}/owner-transfer",
                headers=_headers(container_client, current_user),
                json={"token": token},
            )

        assert response.status_code == 200
        assert response.get_json()["result"] == "success"
        member_join = container_state.one(
            TenantAccountJoin,
            TenantAccountJoin.tenant_id == tenant_id,
            TenantAccountJoin.account_id == member_id,
        )
        current_user_join = container_state.one(
            TenantAccountJoin,
            TenantAccountJoin.tenant_id == tenant_id,
            TenantAccountJoin.account_id == current_user_id,
        )
        assert member_join.role == TenantAccountRole.OWNER
        assert current_user_join.role == TenantAccountRole.ADMIN
        new_owner_email.assert_called_once()
        old_owner_email.assert_called_once()
