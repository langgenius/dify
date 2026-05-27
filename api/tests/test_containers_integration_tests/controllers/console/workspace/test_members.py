from __future__ import annotations

from unittest.mock import patch
from uuid import uuid4

import pytest
from werkzeug.exceptions import HTTPException

import services
from controllers.console.auth.error import MemberNotInTenantError
from controllers.console.workspace import members as members_module
from controllers.console.workspace.members import MemberCancelInviteApi, MemberUpdateRoleApi, OwnerTransfer
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class WorkspaceMembersIntegrationFactory:
    @staticmethod
    def create_tenant(db_session_with_containers) -> Tenant:
        tenant = Tenant(name=f"Tenant {uuid4()}", plan="basic", status="normal")
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()
        return tenant

    @staticmethod
    def create_account(
        db_session_with_containers,
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
        )
        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        if tenant is not None:
            join = TenantAccountJoin(
                tenant_id=tenant.id,
                account_id=account.id,
                role=role,
                current=current,
            )
            db_session_with_containers.add(join)
            db_session_with_containers.commit()
            account.current_tenant = tenant
        return account


class TestMemberCancelInviteApiWithContainers:
    def test_cancel_success(self, flask_app_with_containers, db_session_with_containers):
        api = MemberCancelInviteApi()
        method = unwrap(api.delete)
        factory = WorkspaceMembersIntegrationFactory
        tenant = factory.create_tenant(db_session_with_containers)
        current_user = factory.create_account(
            db_session_with_containers,
            email_prefix="owner",
            tenant=tenant,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        member = factory.create_account(db_session_with_containers, email_prefix="member")

        with (
            flask_app_with_containers.test_request_context("/"),
            patch.object(members_module, "current_account_with_tenant", return_value=(current_user, tenant.id)),
            patch.object(members_module.TenantService, "remove_member_from_tenant") as mock_remove_member,
        ):
            result, status = method(api, member.id)

        assert status == 200
        assert result["result"] == "success"
        mock_remove_member.assert_called_once()
        called_tenant, called_member, called_current_user = mock_remove_member.call_args.args
        assert called_tenant.id == tenant.id
        assert called_member.id == member.id
        assert called_current_user.id == current_user.id

    def test_cancel_not_found(self, flask_app_with_containers, db_session_with_containers):
        api = MemberCancelInviteApi()
        method = unwrap(api.delete)
        factory = WorkspaceMembersIntegrationFactory
        tenant = factory.create_tenant(db_session_with_containers)
        current_user = factory.create_account(
            db_session_with_containers,
            email_prefix="owner",
            tenant=tenant,
            role=TenantAccountRole.OWNER,
            current=True,
        )

        with (
            flask_app_with_containers.test_request_context("/"),
            patch.object(members_module, "current_account_with_tenant", return_value=(current_user, tenant.id)),
        ):
            with pytest.raises(HTTPException):
                method(api, str(uuid4()))

    def test_cancel_cannot_operate_self(self, flask_app_with_containers, db_session_with_containers):
        api = MemberCancelInviteApi()
        method = unwrap(api.delete)
        factory = WorkspaceMembersIntegrationFactory
        tenant = factory.create_tenant(db_session_with_containers)
        current_user = factory.create_account(
            db_session_with_containers,
            email_prefix="owner",
            tenant=tenant,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        member = factory.create_account(db_session_with_containers, email_prefix="member")

        with (
            flask_app_with_containers.test_request_context("/"),
            patch.object(members_module, "current_account_with_tenant", return_value=(current_user, tenant.id)),
            patch.object(
                members_module.TenantService,
                "remove_member_from_tenant",
                side_effect=services.errors.account.CannotOperateSelfError("x"),
            ),
        ):
            result, status = method(api, member.id)

        assert status == 400
        assert result["code"] == "cannot-operate-self"

    def test_cancel_no_permission(self, flask_app_with_containers, db_session_with_containers):
        api = MemberCancelInviteApi()
        method = unwrap(api.delete)
        factory = WorkspaceMembersIntegrationFactory
        tenant = factory.create_tenant(db_session_with_containers)
        current_user = factory.create_account(
            db_session_with_containers,
            email_prefix="owner",
            tenant=tenant,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        member = factory.create_account(db_session_with_containers, email_prefix="member")

        with (
            flask_app_with_containers.test_request_context("/"),
            patch.object(members_module, "current_account_with_tenant", return_value=(current_user, tenant.id)),
            patch.object(
                members_module.TenantService,
                "remove_member_from_tenant",
                side_effect=services.errors.account.NoPermissionError("x"),
            ),
        ):
            result, status = method(api, member.id)

        assert status == 403
        assert result["code"] == "forbidden"

    def test_cancel_member_not_in_tenant(self, flask_app_with_containers, db_session_with_containers):
        api = MemberCancelInviteApi()
        method = unwrap(api.delete)
        factory = WorkspaceMembersIntegrationFactory
        tenant = factory.create_tenant(db_session_with_containers)
        current_user = factory.create_account(
            db_session_with_containers,
            email_prefix="owner",
            tenant=tenant,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        member = factory.create_account(db_session_with_containers, email_prefix="member")

        with (
            flask_app_with_containers.test_request_context("/"),
            patch.object(members_module, "current_account_with_tenant", return_value=(current_user, tenant.id)),
            patch.object(
                members_module.TenantService,
                "remove_member_from_tenant",
                side_effect=services.errors.account.MemberNotInTenantError(),
            ),
        ):
            result, status = method(api, member.id)

        assert status == 404
        assert result["code"] == "member-not-found"


class TestMemberUpdateRoleApiWithContainers:
    def test_update_success(self, flask_app_with_containers, db_session_with_containers):
        api = MemberUpdateRoleApi()
        method = unwrap(api.put)
        factory = WorkspaceMembersIntegrationFactory
        tenant = factory.create_tenant(db_session_with_containers)
        current_user = factory.create_account(
            db_session_with_containers,
            email_prefix="owner",
            tenant=tenant,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        member = factory.create_account(db_session_with_containers, email_prefix="member")

        with (
            flask_app_with_containers.test_request_context("/", json={"role": "normal"}),
            patch.object(members_module, "current_account_with_tenant", return_value=(current_user, tenant.id)),
            patch.object(members_module.TenantService, "update_member_role") as mock_update_role,
        ):
            result = method(api, member.id)

        if isinstance(result, tuple):
            result = result[0]

        assert result["result"] == "success"
        mock_update_role.assert_called_once()
        called_tenant, called_member, called_role, called_current_user = mock_update_role.call_args.args
        assert called_tenant.id == tenant.id
        assert called_member.id == member.id
        assert called_role == "normal"
        assert called_current_user.id == current_user.id

    def test_update_member_not_found(self, flask_app_with_containers, db_session_with_containers):
        api = MemberUpdateRoleApi()
        method = unwrap(api.put)
        factory = WorkspaceMembersIntegrationFactory
        tenant = factory.create_tenant(db_session_with_containers)
        current_user = factory.create_account(
            db_session_with_containers,
            email_prefix="owner",
            tenant=tenant,
            role=TenantAccountRole.OWNER,
            current=True,
        )

        with (
            flask_app_with_containers.test_request_context("/", json={"role": "normal"}),
            patch.object(members_module, "current_account_with_tenant", return_value=(current_user, tenant.id)),
        ):
            with pytest.raises(HTTPException):
                method(api, str(uuid4()))


class TestOwnerTransferApiWithContainers:
    def test_member_not_in_tenant(self, flask_app_with_containers, db_session_with_containers):
        api = OwnerTransfer()
        method = unwrap(api.post)
        factory = WorkspaceMembersIntegrationFactory
        tenant = factory.create_tenant(db_session_with_containers)
        current_user = factory.create_account(
            db_session_with_containers,
            email_prefix="owner",
            tenant=tenant,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        member = factory.create_account(db_session_with_containers, email_prefix="member")

        with (
            flask_app_with_containers.test_request_context("/", json={"token": "t"}),
            patch.object(members_module, "current_account_with_tenant", return_value=(current_user, tenant.id)),
            patch.object(members_module.TenantService, "is_owner", return_value=True),
            patch.object(
                members_module.AccountService,
                "get_owner_transfer_data",
                return_value={"email": current_user.email},
            ),
            patch.object(members_module.AccountService, "revoke_owner_transfer_token"),
            patch.object(members_module.TenantService, "is_member", return_value=False),
        ):
            with pytest.raises(MemberNotInTenantError):
                method(api, member.id)

    def test_member_not_found(self, flask_app_with_containers, db_session_with_containers):
        api = OwnerTransfer()
        method = unwrap(api.post)
        factory = WorkspaceMembersIntegrationFactory
        tenant = factory.create_tenant(db_session_with_containers)
        current_user = factory.create_account(
            db_session_with_containers,
            email_prefix="owner",
            tenant=tenant,
            role=TenantAccountRole.OWNER,
            current=True,
        )

        with (
            flask_app_with_containers.test_request_context("/", json={"token": "t"}),
            patch.object(members_module, "current_account_with_tenant", return_value=(current_user, tenant.id)),
            patch.object(members_module.TenantService, "is_owner", return_value=True),
            patch.object(
                members_module.AccountService,
                "get_owner_transfer_data",
                return_value={"email": current_user.email},
            ),
            patch.object(members_module.AccountService, "revoke_owner_transfer_token"),
        ):
            with pytest.raises(HTTPException):
                method(api, str(uuid4()))

    def test_transfer_success(self, flask_app_with_containers, db_session_with_containers):
        api = OwnerTransfer()
        method = unwrap(api.post)
        factory = WorkspaceMembersIntegrationFactory
        tenant = factory.create_tenant(db_session_with_containers)
        current_user = factory.create_account(
            db_session_with_containers,
            email_prefix="owner",
            tenant=tenant,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        member = factory.create_account(db_session_with_containers, email_prefix="member")

        with (
            flask_app_with_containers.test_request_context("/", json={"token": "t"}),
            patch.object(members_module, "current_account_with_tenant", return_value=(current_user, tenant.id)),
            patch.object(members_module.TenantService, "is_owner", return_value=True),
            patch.object(
                members_module.AccountService,
                "get_owner_transfer_data",
                return_value={"email": current_user.email},
            ),
            patch.object(members_module.AccountService, "revoke_owner_transfer_token"),
            patch.object(members_module.TenantService, "is_member", return_value=True),
            patch.object(members_module.TenantService, "update_member_role") as mock_update_role,
            patch.object(members_module.AccountService, "send_new_owner_transfer_notify_email") as mock_new_owner_email,
            patch.object(members_module.AccountService, "send_old_owner_transfer_notify_email") as mock_old_owner_email,
        ):
            result = method(api, member.id)

        assert result["result"] == "success"
        mock_update_role.assert_called_once()
        called_tenant, called_member, called_role, called_current_user = mock_update_role.call_args.args
        assert called_tenant.id == tenant.id
        assert called_member.id == member.id
        assert called_role == "owner"
        assert called_current_user.id == current_user.id
        mock_new_owner_email.assert_called_once()
        mock_old_owner_email.assert_called_once()
