from __future__ import annotations

import inspect
from collections.abc import Callable
from typing import cast
from unittest.mock import patch
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import HTTPException

import services.errors.base
import services.errors.workspace
from controllers.console.auth.error import MemberNotInTenantError
from controllers.console.workspace.members import MemberCancelInviteApi, MemberUpdateRoleApi, OwnerTransfer
from extensions.ext_application_services import application_services
from libs.exception import BaseHTTPException
from libs.helper import TokenManager
from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.workspace import WorkspaceOwnerTransferNotification, WorkspaceOwnerTransferOperation
from services.workspace import gateways

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
            account.set_current_tenant_with_session(tenant, session=db_session_with_containers)
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
        token = TokenManager.generate_token(
            account_id=account.id, email=account.email, token_type="owner_transfer", additional_data={"code": "123456"}
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
            patch.object(application_services().workspaces.members, "remove") as mock_remove_member,
        ):
            result, status = method(api, RequestContext("request", None, current_user.id, tenant.id), member.id)

        assert status == 200
        assert result["result"] == "success"
        mock_remove_member.assert_called_once()
        called_tenant, called_member, called_current_user = mock_remove_member.call_args.args
        assert called_tenant == tenant.id
        assert called_member == member.id
        assert called_current_user == current_user.id

    def test_cancel_not_found(self, flask_app_with_containers: Flask, db_session_with_containers: Session) -> None:
        api = MemberCancelInviteApi()
        method = unwrap_raises(api.delete)
        factory = WorkspaceMembersIntegrationFactory
        tenant, current_user = factory.create_owner_workspace(db_session_with_containers)

        with flask_app_with_containers.test_request_context("/"):
            with pytest.raises(HTTPException):
                method(api, RequestContext("request", None, current_user.id, tenant.id), str(uuid4()))

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
                application_services().workspaces.members,
                "remove",
                side_effect=services.errors.workspace.CannotOperateSelfError("x"),
            ),
        ):
            with pytest.raises(BaseHTTPException) as exc_info:
                method(api, RequestContext("request", None, current_user.id, tenant.id), member.id)

        assert exc_info.value.code == 400
        assert exc_info.value.data == {
            "code": "cannot_operate_self",
            "message": exc_info.value.description,
            "status": 400,
        }

    def test_cancel_no_permission(self, flask_app_with_containers: Flask, db_session_with_containers: Session) -> None:
        api = MemberCancelInviteApi()
        method = unwrap_status_response(api.delete)
        factory = WorkspaceMembersIntegrationFactory
        tenant, current_user = factory.create_owner_workspace(db_session_with_containers)
        member = factory.create_account(db_session_with_containers, email_prefix="member")

        with (
            flask_app_with_containers.test_request_context("/"),
            patch.object(
                application_services().workspaces.members,
                "remove",
                side_effect=services.errors.base.NoPermissionError("x"),
            ),
        ):
            with pytest.raises(BaseHTTPException) as exc_info:
                method(api, RequestContext("request", None, current_user.id, tenant.id), member.id)

        assert exc_info.value.code == 403
        assert exc_info.value.data == {"code": "forbidden", "message": exc_info.value.description, "status": 403}

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
                application_services().workspaces.members,
                "remove",
                side_effect=services.errors.workspace.MemberNotInTenantError(),
            ),
        ):
            with pytest.raises(BaseHTTPException) as exc_info:
                method(api, RequestContext("request", None, current_user.id, tenant.id), member.id)

        assert exc_info.value.code == 404
        assert exc_info.value.data == {"code": "member_not_found", "message": exc_info.value.description, "status": 404}


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
            result = method(api, RequestContext("request", None, current_user.id, tenant.id), member.id)

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
                method(api, RequestContext("request", None, current_user.id, tenant.id), str(uuid4()))


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
                method(api, RequestContext("test", None, current_user.id, tenant.id), member.id)

    def test_member_not_found(self, flask_app_with_containers: Flask, db_session_with_containers: Session) -> None:
        api = OwnerTransfer()
        method = unwrap_raises(api.post)
        factory = WorkspaceMembersIntegrationFactory
        tenant, current_user = factory.create_owner_workspace(db_session_with_containers)
        token = factory.create_owner_transfer_token(current_user)

        with flask_app_with_containers.test_request_context("/", json={"token": token}):
            with pytest.raises(HTTPException):
                method(api, RequestContext("test", None, current_user.id, tenant.id), str(uuid4()))

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
        tenant_id = tenant.id
        tenant_name = tenant.name
        current_user_id = current_user.id
        current_user_email = current_user.email
        member_id = member.id
        member_email = member.email

        with (
            flask_app_with_containers.test_request_context("/", json={"token": token}),
            patch.object(gateways.send_new_owner_transfer_notify_email_task, "apply_async") as notify_new,
            patch.object(gateways.send_old_owner_transfer_notify_email_task, "apply_async") as notify_old,
        ):
            result = method(api, RequestContext("test", None, current_user_id, tenant_id), member_id)

        assert result["result"] == "success"
        assert (
            factory.get_join(db_session_with_containers, tenant=tenant, account=member).role == TenantAccountRole.OWNER
        )
        assert (
            factory.get_join(db_session_with_containers, tenant=tenant, account=current_user).role
            == TenantAccountRole.NORMAL
        )

        db_session_with_containers.expire_all()
        operation = db_session_with_containers.get(WorkspaceOwnerTransferOperation, tenant_id)
        assert operation is not None
        assert operation.status == "watch"
        notifications = tuple(
            db_session_with_containers.scalars(
                select(WorkspaceOwnerTransferNotification)
                .where(WorkspaceOwnerTransferNotification.operation_id == operation.operation_id)
                .order_by(WorkspaceOwnerTransferNotification.recipient_type)
            )
        )
        assert {notification.recipient_type for notification in notifications} == {"new_owner", "old_owner"}
        assert all(notification.status == "sent" for notification in notifications)
        assert all(notification.attempts == 1 for notification in notifications)
        assert all(notification.claim_id is None for notification in notifications)
        assert all(notification.sent_at is not None for notification in notifications)
        notifications_by_recipient = {notification.recipient_type: notification for notification in notifications}
        new_owner_notification = notifications_by_recipient["new_owner"]
        old_owner_notification = notifications_by_recipient["old_owner"]

        notify_new.assert_called_once_with(
            kwargs={"language": "en-US", "to": member_email, "workspace": tenant_name},
            task_id=new_owner_notification.notification_id,
            headers={
                "workspace_owner_transfer_operation_id": operation.operation_id,
                "workspace_owner_transfer_recipient": "new_owner",
            },
        )
        notify_old.assert_called_once_with(
            kwargs={
                "language": "en-US",
                "to": current_user_email,
                "workspace": tenant_name,
                "new_owner_email": member_email,
            },
            task_id=old_owner_notification.notification_id,
            headers={
                "workspace_owner_transfer_operation_id": operation.operation_id,
                "workspace_owner_transfer_recipient": "old_owner",
            },
        )
