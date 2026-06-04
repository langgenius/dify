from __future__ import annotations

import inspect
from collections.abc import Callable
from typing import cast
from unittest.mock import patch
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import HTTPException

import services
from controllers.console.auth.error import MemberNotInTenantError
from controllers.console.workspace import members as members_module
from controllers.console.workspace.members import MemberCancelInviteApi, MemberUpdateRoleApi, OwnerTransfer
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus

JsonResponse = dict[str, object]
StatusResponse = tuple[JsonResponse, int]


def unwrap(func: Callable[..., object]) -> Callable[..., object]:
    return cast(Callable[..., object], inspect.unwrap(func))


def unwrap_status_response(func: Callable[..., object]) -> Callable[..., StatusResponse]:
    return cast(Callable[..., StatusResponse], inspect.unwrap(func))


def unwrap_json_response(func: Callable[..., object]) -> Callable[..., JsonResponse]:
    return cast(Callable[..., JsonResponse], inspect.unwrap(func))


def unwrap_json_or_status_response(func: Callable[..., object]) -> Callable[..., JsonResponse | StatusResponse]:
    return cast(Callable[..., JsonResponse | StatusResponse], inspect.unwrap(func))


def unwrap_raises(func: Callable[..., object]) -> Callable[..., object]:
    return unwrap(func)


class WorkspaceMembersIntegrationFactory:
    @staticmethod
    def create_tenant(db_session_with_containers: Session) -> Tenant:
        tenant = Tenant(name=f"Tenant {uuid4()}", plan="basic", status=TenantStatus.NORMAL)
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()
        return tenant

    @staticmethod
    def create_account(
        db_session_with_containers: Session,
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

    @staticmethod
    def create_owner_workspace(db_session_with_containers: Session) -> tuple[Tenant, Account]:
        tenant = WorkspaceMembersIntegrationFactory.create_tenant(db_session_with_containers)
        owner = WorkspaceMembersIntegrationFactory.create_account(
            db_session_with_containers,
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

    @staticmethod
    def get_join(db_session_with_containers: Session, *, tenant: Tenant, account: Account) -> TenantAccountJoin:
        tenant_id = tenant.id
        account_id = account.id
        db_session_with_containers.expire_all()
        join = (
            db_session_with_containers.query(TenantAccountJoin)
            .filter_by(tenant_id=tenant_id, account_id=account_id)
            .one()
        )
        return join


class TestMemberCancelInviteApiWithContainers:
    def test_cancel_success(self, flask_app_with_containers: Flask, db_session_with_containers: Session) -> None:
        api = MemberCancelInviteApi()
        method = unwrap_status_response(api.delete)
        factory = WorkspaceMembersIntegrationFactory
        tenant, current_user = factory.create_owner_workspace(db_session_with_containers)
        member = factory.create_account(db_session_with_containers, email_prefix="member")

        with (
            flask_app_with_containers.test_request_context("/"),
            patch.object(members_module.TenantService, "remove_member_from_tenant") as mock_remove_member,
        ):
            result, status = method(api, current_user, member.id)

        assert status == 200
        assert result["result"] == "success"
        mock_remove_member.assert_called_once()
        called_tenant, called_member, called_current_user = mock_remove_member.call_args.args
        assert called_tenant.id == tenant.id
        assert called_member.id == member.id
        assert called_current_user.id == current_user.id

    def test_cancel_not_found(self, flask_app_with_containers: Flask, db_session_with_containers: Session) -> None:
        api = MemberCancelInviteApi()
        method = unwrap_raises(api.delete)
        factory = WorkspaceMembersIntegrationFactory
        tenant, current_user = factory.create_owner_workspace(db_session_with_containers)

        with flask_app_with_containers.test_request_context("/"):
            with pytest.raises(HTTPException):
                method(api, current_user, str(uuid4()))

    def test_cancel_cannot_operate_self(
        self, flask_app_with_containers: Flask, db_session_with_containers: Session
    ) -> None:
        api = MemberCancelInviteApi()
        method = unwrap_status_response(api.delete)
        factory = WorkspaceMembersIntegrationFactory
        tenant, current_user = factory.create_owner_workspace(db_session_with_containers)
        member = factory.create_account(db_session_with_containers, email_prefix="member")

        with (
            flask_app_with_containers.test_request_context("/"),
            patch.object(
                members_module.TenantService,
                "remove_member_from_tenant",
                side_effect=services.errors.account.CannotOperateSelfError("x"),
            ),
        ):
            result, status = method(api, current_user, member.id)

        assert status == 400
        assert result["code"] == "cannot-operate-self"

    def test_cancel_no_permission(self, flask_app_with_containers: Flask, db_session_with_containers: Session) -> None:
        api = MemberCancelInviteApi()
        method = unwrap_status_response(api.delete)
        factory = WorkspaceMembersIntegrationFactory
        tenant, current_user = factory.create_owner_workspace(db_session_with_containers)
        member = factory.create_account(db_session_with_containers, email_prefix="member")

        with (
            flask_app_with_containers.test_request_context("/"),
            patch.object(
                members_module.TenantService,
                "remove_member_from_tenant",
                side_effect=services.errors.account.NoPermissionError("x"),
            ),
        ):
            result, status = method(api, current_user, member.id)

        assert status == 403
        assert result["code"] == "forbidden"

    def test_cancel_member_not_in_tenant(
        self, flask_app_with_containers: Flask, db_session_with_containers: Session
    ) -> None:
        api = MemberCancelInviteApi()
        method = unwrap_status_response(api.delete)
        factory = WorkspaceMembersIntegrationFactory
        tenant, current_user = factory.create_owner_workspace(db_session_with_containers)
        member = factory.create_account(db_session_with_containers, email_prefix="member")

        with (
            flask_app_with_containers.test_request_context("/"),
            patch.object(
                members_module.TenantService,
                "remove_member_from_tenant",
                side_effect=services.errors.account.MemberNotInTenantError(),
            ),
        ):
            result, status = method(api, current_user, member.id)

        assert status == 404
        assert result["code"] == "member-not-found"


class TestMemberUpdateRoleApiWithContainers:
    def test_update_success(self, flask_app_with_containers: Flask, db_session_with_containers: Session) -> None:
        api = MemberUpdateRoleApi()
        method = unwrap_json_or_status_response(api.put)
        factory = WorkspaceMembersIntegrationFactory
        tenant, current_user = factory.create_owner_workspace(db_session_with_containers)
        member = factory.create_account(
            db_session_with_containers,
            email_prefix="member",
            tenant=tenant,
            role=TenantAccountRole.EDITOR,
        )

        with flask_app_with_containers.test_request_context("/", json={"role": "normal"}):
            result = method(api, current_user, member.id)

        if isinstance(result, tuple):
            result = result[0]

        assert result["result"] == "success"
        assert (
            factory.get_join(db_session_with_containers, tenant=tenant, account=member).role == TenantAccountRole.NORMAL
        )

    def test_update_member_not_found(
        self, flask_app_with_containers: Flask, db_session_with_containers: Session
    ) -> None:
        api = MemberUpdateRoleApi()
        method = unwrap_raises(api.put)
        factory = WorkspaceMembersIntegrationFactory
        tenant, current_user = factory.create_owner_workspace(db_session_with_containers)

        with flask_app_with_containers.test_request_context("/", json={"role": "normal"}):
            with pytest.raises(HTTPException):
                method(api, current_user, str(uuid4()))


class TestOwnerTransferApiWithContainers:
    def test_member_not_in_tenant(self, flask_app_with_containers: Flask, db_session_with_containers: Session) -> None:
        api = OwnerTransfer()
        method = unwrap_raises(api.post)
        factory = WorkspaceMembersIntegrationFactory
        tenant, current_user = factory.create_owner_workspace(db_session_with_containers)
        member = factory.create_account(db_session_with_containers, email_prefix="member")
        token = factory.create_owner_transfer_token(current_user)

        with flask_app_with_containers.test_request_context("/", json={"token": token}):
            with pytest.raises(MemberNotInTenantError):
                method(api, current_user, member.id)

    def test_member_not_found(self, flask_app_with_containers: Flask, db_session_with_containers: Session) -> None:
        api = OwnerTransfer()
        method = unwrap_raises(api.post)
        factory = WorkspaceMembersIntegrationFactory
        tenant, current_user = factory.create_owner_workspace(db_session_with_containers)
        token = factory.create_owner_transfer_token(current_user)

        with flask_app_with_containers.test_request_context("/", json={"token": token}):
            with pytest.raises(HTTPException):
                method(api, current_user, str(uuid4()))

    def test_transfer_success(self, flask_app_with_containers: Flask, db_session_with_containers: Session) -> None:
        api = OwnerTransfer()
        method = unwrap_json_response(api.post)
        factory = WorkspaceMembersIntegrationFactory
        tenant, current_user = factory.create_owner_workspace(db_session_with_containers)
        member = factory.create_account(
            db_session_with_containers,
            email_prefix="member",
            tenant=tenant,
            role=TenantAccountRole.NORMAL,
        )
        token = factory.create_owner_transfer_token(current_user)

        with (
            flask_app_with_containers.test_request_context("/", json={"token": token}),
            patch.object(members_module.AccountService, "send_new_owner_transfer_notify_email") as mock_new_owner_email,
            patch.object(members_module.AccountService, "send_old_owner_transfer_notify_email") as mock_old_owner_email,
        ):
            result = method(api, current_user, member.id)

        assert result["result"] == "success"
        assert (
            factory.get_join(db_session_with_containers, tenant=tenant, account=member).role == TenantAccountRole.OWNER
        )
        assert (
            factory.get_join(db_session_with_containers, tenant=tenant, account=current_user).role
            == TenantAccountRole.ADMIN
        )
        mock_new_owner_email.assert_called_once()
        mock_old_owner_email.assert_called_once()
